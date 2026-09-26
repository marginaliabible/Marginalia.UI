import type { FederatedProvider } from '../models/bible';
import {
  mergeLinkedAccounts,
  type SyncedCloudConfig,
  type SyncedCloudFolderSelection,
} from './cloudConfigProviderService';

type SyncedConfig = SyncedCloudConfig['config'];

// sourceUrls is intentionally absent: it merges as a union and carries no timestamp.
export const SYNCED_CONFIG_FIELDS = [
  'lastTranslationId',
  'lastTranslationIds',
  'translationRecords',
  'position',
  'languages',
  'resourceHiddenTags',
  'theme',
  'translatorItalics',
  'translatorParagraphMarks',
  'userId',
  'folders.google',
  'folders.microsoft',
] as const;

export type SyncedConfigField = (typeof SYNCED_CONFIG_FIELDS)[number];
export type SyncedFieldStamps = Record<SyncedConfigField, number>;

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }

  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source)
        .filter((key) => source[key] !== undefined)
        .sort()
        .map((key) => [key, sortKeysDeep(source[key])])
    );
  }

  return value;
}

/** JSON with sorted object keys, so copies written by different devices compare equal. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value === undefined ? null : sortKeysDeep(value));
}

function readField(config: SyncedConfig, field: SyncedConfigField): unknown {
  switch (field) {
    case 'position':
      return { lastBook: config.lastBook, lastChapter: config.lastChapter };
    case 'folders.google':
      return config.providerFolderSelections?.google;
    case 'folders.microsoft':
      return config.providerFolderSelections?.microsoft;
    default:
      return config[field];
  }
}

function writeField(target: SyncedConfig, field: SyncedConfigField, value: unknown): void {
  switch (field) {
    case 'position': {
      const position = (value ?? {}) as Pick<SyncedConfig, 'lastBook' | 'lastChapter'>;
      target.lastBook = position.lastBook;
      target.lastChapter = position.lastChapter;
      return;
    }
    case 'folders.google':
    case 'folders.microsoft': {
      const provider: FederatedProvider = field === 'folders.google' ? 'google' : 'microsoft';
      target.providerFolderSelections = {
        ...target.providerFolderSelections,
        [provider]: value as SyncedCloudFolderSelection[] | undefined,
      };
      return;
    }
    default:
      (target as unknown as Record<string, unknown>)[field] = value;
  }
}

export function createFieldStamps(value: number): SyncedFieldStamps {
  return Object.fromEntries(SYNCED_CONFIG_FIELDS.map((field) => [field, value])) as SyncedFieldStamps;
}

export function normalizeFieldStamps(value: unknown, fallback: number): SyncedFieldStamps {
  const stamps = createFieldStamps(fallback);
  if (!value || typeof value !== 'object') {
    return stamps;
  }

  const source = value as Record<string, unknown>;
  for (const field of SYNCED_CONFIG_FIELDS) {
    const candidate = source[field];
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      stamps[field] = candidate;
    }
  }

  return stamps;
}

export function maxFieldStamp(stamps: Partial<SyncedFieldStamps>): number {
  return Math.max(0, ...Object.values(stamps).filter((entry): entry is number => typeof entry === 'number'));
}

/** Monotonic stamp: never behind data this device has already seen, even with a slow clock. */
export function nextStamp(knownMax: number): number {
  return Math.max(Date.now(), knownMax + 1);
}

/** Per-field fingerprints used to detect which synced fields a local edit touched. */
export function fieldFingerprints(config: SyncedConfig): Record<SyncedConfigField, string> {
  return Object.fromEntries(
    SYNCED_CONFIG_FIELDS.map((field) => [field, stableStringify(readField(config, field))])
  ) as Record<SyncedConfigField, string>;
}

function fieldStamp(doc: SyncedCloudConfig, field: SyncedConfigField): number {
  // Files written by clients that predate per-field stamps: every field is as new as the file.
  if (!doc.fieldUpdatedAt) {
    return doc.updatedAt;
  }

  const stamp = doc.fieldUpdatedAt[field];
  return typeof stamp === 'number' && Number.isFinite(stamp) ? stamp : 0;
}

function unionSourceUrls(docs: SyncedCloudConfig[]): string[] {
  const seen = new Set<string>();
  for (const doc of docs) {
    for (const entry of Array.isArray(doc.config.sourceUrls) ? doc.config.sourceUrls : []) {
      const url = String(entry ?? '').trim();
      if (url) {
        seen.add(url);
      }
    }
  }

  return Array.from(seen);
}

/**
 * Commutative, idempotent merge: each field takes the value with the newest stamp (ties broken by
 * value so every device picks the same winner), userId keeps the earliest owner, and sourceUrls is
 * the union of all copies.
 */
export function mergeSyncedCloudConfigs(docs: SyncedCloudConfig[]): SyncedCloudConfig {
  if (docs.length === 0) {
    throw new Error('mergeSyncedCloudConfigs requires at least one config.');
  }

  const config = {} as SyncedConfig;
  const stamps = createFieldStamps(0);

  for (const field of SYNCED_CONFIG_FIELDS) {
    if (field === 'userId') {
      continue;
    }

    let winnerValue = readField(docs[0].config, field);
    let winnerStamp = fieldStamp(docs[0], field);
    let winnerKey = stableStringify(winnerValue);

    for (const doc of docs.slice(1)) {
      const value = readField(doc.config, field);
      const stamp = fieldStamp(doc, field);
      const key = stableStringify(value);
      if (stamp > winnerStamp || (stamp === winnerStamp && key > winnerKey)) {
        winnerValue = value;
        winnerStamp = stamp;
        winnerKey = key;
      }
    }

    writeField(config, field, winnerValue);
    stamps[field] = winnerStamp;
  }

  const owners = docs
    .map((doc) => ({ userId: String(doc.config.userId ?? '').trim(), stamp: fieldStamp(doc, 'userId') }))
    .filter((entry) => entry.userId.length > 0)
    .sort((left, right) => left.stamp - right.stamp || left.userId.localeCompare(right.userId));
  if (owners.length > 0) {
    config.userId = owners[0].userId;
    stamps.userId = owners[0].stamp;
  }

  config.sourceUrls = unionSourceUrls(docs);

  const linkedAccounts = docs.reduce(
    (accounts, doc) => mergeLinkedAccounts(accounts, doc.linkedAccounts),
    [] as SyncedCloudConfig['linkedAccounts']
  );

  return {
    schemaVersion: 1,
    updatedAt: Math.max(maxFieldStamp(stamps), ...docs.map((doc) => doc.updatedAt)),
    linkedAccounts,
    config,
    fieldUpdatedAt: stamps,
  };
}

export function syncedConfigsEqual(left: SyncedCloudConfig | null, right: SyncedCloudConfig | null): boolean {
  if (!left || !right) {
    return left === right;
  }

  return stableStringify({
    config: left.config,
    fieldUpdatedAt: left.fieldUpdatedAt,
    linkedAccounts: left.linkedAccounts,
  }) === stableStringify({
    config: right.config,
    fieldUpdatedAt: right.fieldUpdatedAt,
    linkedAccounts: right.linkedAccounts,
  });
}

function folderSelectionSignature(targets: SyncedCloudFolderSelection[] | undefined): string {
  // Only what CloudControlService consumes; renames and size refreshes don't need re-enumeration.
  return stableStringify((targets ?? []).map((target) => ({
    id: target.id,
    excludedItemIds: [...(target.excludedItemIds || [])].sort(),
    tags: [...(target.tags || [])].sort(),
    itemTags: target.itemTags || {},
  })));
}

export function folderSelectionChanged(
  before: SyncedCloudFolderSelection[] | undefined,
  after: SyncedCloudFolderSelection[] | undefined
): boolean {
  return folderSelectionSignature(before) !== folderSelectionSignature(after);
}

export function removedFolderIds(
  before: SyncedCloudFolderSelection[] | undefined,
  after: SyncedCloudFolderSelection[] | undefined
): string[] {
  const afterIds = new Set((after ?? []).map((target) => target.id));
  return (before ?? []).map((target) => target.id).filter((id) => !afterIds.has(id));
}
