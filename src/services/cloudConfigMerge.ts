import type { FederatedProvider } from '../models/bible';
import {
  mergeLinkedAccounts,
  type SyncedCloudConfig,
  type SyncedCloudFolderSelection,
} from './cloudConfigProviderService';
import { mergeResourceTagColors } from '../utils/resourceTagColors';

type SyncedConfig = SyncedCloudConfig['config'];

// sourceUrls (with its sourceUrlAddedAt / sourceUrlTombstones stamps) and resourceTagColors are
// intentionally absent: they merge per URL / per tag instead of per field.
export const SYNCED_CONFIG_FIELDS = [
  'lastTranslationId',
  'lastTranslationIds',
  'translationRecords',
  'position',
  'languages',
  'disabledSourceItems',
  'resourceTagOverrides',
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

/**
 * Orders userId stamps oldest first. A zero stamp means the establishment time was never recorded, so
 * it ranks after every recorded one rather than passing for the oldest.
 */
export function compareOwnerStamps(left: number, right: number): number {
  const known = (stamp: number) => (stamp > 0 ? stamp : Number.POSITIVE_INFINITY);
  const leftKnown = known(left);
  const rightKnown = known(right);
  return leftKnown === rightKnown ? 0 : leftKnown < rightKnown ? -1 : 1;
}

function fieldStamp(doc: SyncedCloudConfig, field: SyncedConfigField): number {
  // Files written by clients that predate per-field stamps: every field is as new as the file.
  if (!doc.fieldUpdatedAt) {
    return doc.updatedAt;
  }

  const stamp = doc.fieldUpdatedAt[field];
  return typeof stamp === 'number' && Number.isFinite(stamp) ? stamp : 0;
}

/** The User ID a copy names as the account owner, with its establishment stamp. */
export function readConfigOwner(doc: SyncedCloudConfig): { userId: string; stamp: number } | null {
  const userId = String(doc.config.userId ?? '').trim();
  return userId ? { userId, stamp: fieldStamp(doc, 'userId') } : null;
}

function maxStampsByUrl(docs: SyncedCloudConfig[], read: (doc: SyncedCloudConfig) => unknown): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const doc of docs) {
    const stamps = read(doc);
    if (!stamps || typeof stamps !== 'object') {
      continue;
    }

    for (const [url, stamp] of Object.entries(stamps as Record<string, unknown>)) {
      if (typeof stamp === 'number' && Number.isFinite(stamp) && url.trim()) {
        merged[url.trim()] = Math.max(merged[url.trim()] ?? 0, stamp);
      }
    }
  }

  return merged;
}

/**
 * Union of every copy's sourceUrls, minus URLs whose newest removal is newer than their newest add.
 * URLs saved before add stamps existed count as added at time 0, so any recorded removal wins.
 */
function mergeSourceUrls(docs: SyncedCloudConfig[]): Pick<SyncedConfig, 'sourceUrls' | 'sourceUrlAddedAt' | 'sourceUrlTombstones'> {
  const addedAt = maxStampsByUrl(docs, (doc) => doc.config.sourceUrlAddedAt);
  const tombstones = maxStampsByUrl(docs, (doc) => doc.config.sourceUrlTombstones);
  const seen = new Set<string>();
  for (const doc of docs) {
    for (const entry of Array.isArray(doc.config.sourceUrls) ? doc.config.sourceUrls : []) {
      const url = String(entry ?? '').trim();
      if (url && !((tombstones[url] ?? -1) >= (addedAt[url] ?? 0))) {
        seen.add(url);
      }
    }
  }

  return {
    sourceUrls: Array.from(seen),
    sourceUrlAddedAt: addedAt,
    sourceUrlTombstones: tombstones,
  };
}

/** Everything merged per entry rather than per field (sourceUrls, tag colors); a change to any of it must be synced. */
export function entryMergedFingerprint(config: SyncedConfig): string {
  return stableStringify({
    sourceUrls: config.sourceUrls ?? [],
    sourceUrlAddedAt: config.sourceUrlAddedAt ?? {},
    sourceUrlTombstones: config.sourceUrlTombstones ?? {},
    resourceTagColors: config.resourceTagColors ?? {},
  });
}

/**
 * Commutative, idempotent merge: each field takes the value with the newest stamp (ties broken by
 * value so every device picks the same winner), userId keeps the earliest owner, sourceUrls is
 * the union of all copies minus URLs removed after they were last added, and each tag keeps the
 * color it was first given on any device.
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
    .map(readConfigOwner)
    .filter((entry): entry is { userId: string; stamp: number } => entry !== null)
    .sort((left, right) => compareOwnerStamps(left.stamp, right.stamp) || left.userId.localeCompare(right.userId));
  if (owners.length > 0) {
    config.userId = owners[0].userId;
    stamps.userId = owners[0].stamp;
  }

  Object.assign(config, mergeSourceUrls(docs));
  config.resourceTagColors = mergeResourceTagColors(docs.map((doc) => doc.config.resourceTagColors));

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
