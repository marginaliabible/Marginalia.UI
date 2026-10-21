import type { FederatedProvider } from '../models/bible';

export type PublicanCommittedType = 'mod' | 'del' | 'scan';

export interface PublicanCommittedEntry {
  addedOn?: string;
  provider?: string;
  type: PublicanCommittedType | string;
  size: number;
  documentId: string;
  hash: string;
}

export interface SyncPlanDocumentRef {
  documentId: string;
  hash: string;
  /** Cloud file size when known (for half-size del preview). */
  sizeBytes?: number;
  provider: FederatedProvider;
}

/** A live Drive/OneDrive file under the current staged selection (from the folder size walk). */
export interface SyncPlanLiveFile {
  documentId: string;
  lastModified?: string;
  provider: FederatedProvider;
}

export interface SyncPlanUsageInput {
  committed: PublicanCommittedEntry[];
  /** documentId → published hash (from documents.json). */
  publishedByDocumentId: ReadonlyMap<string, string>;
  /** documentIds currently selected for sync (staged), with optional sizes. */
  stagedSelectedDocs: SyncPlanDocumentRef[];
  /**
   * Previously applied (synced) file docs still under a staged root — used for per-file
   * exclusion/del preview. Roots that were fully deselected are handled via
   * `deselectedAppliedRootBytes` instead (tree children are often not loaded).
   */
  appliedSelectedDocs: SyncPlanDocumentRef[];
  /**
   * Supported-byte totals for applied selection roots that are no longer staged.
   * Each entry is charged as floor(size/2) toward Committed Processing.
   */
  deselectedAppliedRootBytes: number[];
  /** Sum of selected supported cloud file bytes (exclusions already applied). */
  selectedBytes: number;
  /**
   * Live files under staged selected folders. Used with `membershipKnown` to decide which
   * disconnect (stowed) publican mod/del rows to keep on the blue bar.
   */
  liveSelectedDocs?: readonly SyncPlanLiveFile[];
  /**
   * True when every reconnecting provider's staged folders have been listed.
   * When false, stowed disconnect dels are hidden (same bar as never disconnected).
   */
  membershipKnown?: boolean;
  /** ISO timestamps from `/sync/status` for providers awaiting reconnect Apply. */
  disconnectedAtByProvider?: Partial<Record<FederatedProvider, string>>;
}

export interface SyncPlanUsageResult {
  committedBaseBytes: number;
  committedAdjustedBytes: number;
  selectedBytes: number;
  billableBytes: number;
  /** Bytes removed from committed because staged selection matches mod/del rows. */
  clearedCommittedBytes: number;
  /** Bytes added for deselected uploaded docs (half size). */
  pendingDelChargeBytes: number;
}

function normalizeHash(hash: string | undefined): string {
  return String(hash ?? '').trim().toLowerCase();
}

function entrySize(entry: PublicanCommittedEntry): number {
  return Math.max(0, Math.floor(Number(entry.size) || 0));
}

export function sumCommittedSizes(committed: readonly PublicanCommittedEntry[]): number {
  return committed.reduce((sum, entry) => sum + entrySize(entry), 0);
}

function parseTimeMs(value: string | undefined): number | null {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function committedProvider(entry: PublicanCommittedEntry): FederatedProvider | undefined {
  const code = String(entry.provider ?? '').trim().toLowerCase();
  if (code === 'g' || code === 'google' || code === 'googledrive' || code === 'google-drive') {
    return 'google';
  }
  if (code === 'o' || code === 'microsoft' || code === 'onedrive' || code === 'one-drive') {
    return 'microsoft';
  }
  return undefined;
}

/**
 * A publican mod/del whose hash is still in documents.json is a disconnect (stowed-library) charge,
 * not a historical one. Clear it when the live file is still selected and was not touched after
 * disconnectedAt, or when membership is not known yet.
 */
function shouldClearStowedHash(
  documentIds: readonly string[],
  liveById: ReadonlyMap<string, SyncPlanLiveFile>,
  membershipKnown: boolean,
  disconnectedAtByProvider: Partial<Record<FederatedProvider, string>>,
  providerByDocumentId: ReadonlyMap<string, FederatedProvider>
): boolean {
  if (!membershipKnown) {
    return true;
  }

  for (const documentId of documentIds) {
    const live = liveById.get(documentId);
    if (!live) {
      continue;
    }
    const lastModifiedMs = parseTimeMs(live.lastModified);
    if (lastModifiedMs == null) {
      return true;
    }
    const provider = live.provider || providerByDocumentId.get(documentId);
    const disconnectedAtMs = provider ? parseTimeMs(disconnectedAtByProvider[provider]) : null;
    if (disconnectedAtMs == null || lastModifiedMs <= disconnectedAtMs) {
      return true;
    }
  }
  return false;
}

/**
 * Preview publican adjustments before Apply:
 * - Selecting a doc whose published hash matches a mod/del row clears that row's size from blue.
 * - Deselecting an already-uploaded doc adds floor(fileSize/2) to blue.
 * - Disconnect stowed dels (hash still published) follow live membership and last-modified vs disconnectedAt.
 */
export function computeSyncPlanUsage(input: SyncPlanUsageInput): SyncPlanUsageResult {
  const committedBaseBytes = sumCommittedSizes(input.committed);
  const stagedIds = new Set(input.stagedSelectedDocs.map((doc) => doc.documentId));
  const appliedById = new Map(input.appliedSelectedDocs.map((doc) => [doc.documentId, doc]));
  const liveById = new Map((input.liveSelectedDocs ?? []).map((doc) => [doc.documentId, doc]));
  const membershipKnown = Boolean(input.membershipKnown);
  const disconnectedAtByProvider = input.disconnectedAtByProvider ?? {};

  const providerByDocumentId = new Map<string, FederatedProvider>();
  for (const entry of input.committed) {
    const provider = committedProvider(entry);
    const documentId = String(entry.documentId ?? '').trim();
    if (provider && documentId && !providerByDocumentId.has(documentId)) {
      providerByDocumentId.set(documentId, provider);
    }
  }
  for (const doc of [...input.stagedSelectedDocs, ...input.appliedSelectedDocs, ...(input.liveSelectedDocs ?? [])]) {
    if (doc.documentId && !providerByDocumentId.has(doc.documentId)) {
      providerByDocumentId.set(doc.documentId, doc.provider);
    }
  }

  const publishedHashes = new Set<string>();
  const documentIdsByPublishedHash = new Map<string, string[]>();
  for (const [documentId, rawHash] of input.publishedByDocumentId) {
    const hash = normalizeHash(rawHash);
    if (!hash) {
      continue;
    }
    publishedHashes.add(hash);
    const ids = documentIdsByPublishedHash.get(hash) ?? [];
    ids.push(documentId);
    documentIdsByPublishedHash.set(hash, ids);
  }

  const modDelByHash = new Map<string, number>();
  for (const entry of input.committed) {
    const type = String(entry.type ?? '');
    if (type !== 'mod' && type !== 'del') {
      continue;
    }
    const hash = normalizeHash(entry.hash);
    if (!hash) {
      continue;
    }
    modDelByHash.set(hash, (modDelByHash.get(hash) ?? 0) + entrySize(entry));
  }

  let clearedCommittedBytes = 0;
  const clearedHashes = new Set<string>();
  const unclearedStowedHashes = new Set<string>();

  for (const [hash, amount] of modDelByHash) {
    if (!publishedHashes.has(hash) || !(amount > 0)) {
      continue;
    }
    const documentIds = documentIdsByPublishedHash.get(hash) ?? [];
    if (shouldClearStowedHash(
      documentIds,
      liveById,
      membershipKnown,
      disconnectedAtByProvider,
      providerByDocumentId
    )) {
      clearedCommittedBytes += amount;
      clearedHashes.add(hash);
    } else {
      unclearedStowedHashes.add(hash);
    }
  }

  for (const doc of input.stagedSelectedDocs) {
    const publishedHash = normalizeHash(
      input.publishedByDocumentId.get(doc.documentId) ?? doc.hash
    );
    if (!publishedHash || clearedHashes.has(publishedHash) || publishedHashes.has(publishedHash)) {
      continue;
    }
    const amount = modDelByHash.get(publishedHash);
    if (amount && amount > 0) {
      clearedCommittedBytes += amount;
      clearedHashes.add(publishedHash);
    }
  }

  let pendingDelChargeBytes = 0;
  const skipFolderPendingDels = membershipKnown && unclearedStowedHashes.size > 0
    && [...input.publishedByDocumentId.keys()].some((documentId) => !liveById.has(documentId));
  if (!skipFolderPendingDels) {
    for (const rootBytes of input.deselectedAppliedRootBytes ?? []) {
      const sizeBytes = Math.max(0, Math.floor(Number(rootBytes) || 0));
      if (sizeBytes > 0) {
        pendingDelChargeBytes += Math.floor(sizeBytes / 2);
      }
    }
  }
  for (const [documentId, applied] of appliedById) {
    if (stagedIds.has(documentId)) {
      continue;
    }
    const publishedHash = normalizeHash(
      input.publishedByDocumentId.get(documentId) ?? applied.hash
    );
    if (!publishedHash) {
      continue;
    }
    if (unclearedStowedHashes.has(publishedHash)) {
      continue;
    }
    const sizeBytes = Math.max(0, Math.floor(Number(applied.sizeBytes) || 0));
    if (sizeBytes > 0) {
      pendingDelChargeBytes += Math.floor(sizeBytes / 2);
    }
  }

  const committedAdjustedBytes = Math.max(
    0,
    committedBaseBytes - clearedCommittedBytes + pendingDelChargeBytes
  );
  const selectedBytes = Math.max(0, Math.floor(Number(input.selectedBytes) || 0));

  return {
    committedBaseBytes,
    committedAdjustedBytes,
    selectedBytes,
    billableBytes: committedAdjustedBytes + selectedBytes,
    clearedCommittedBytes,
    pendingDelChargeBytes,
  };
}

/** Split bar segments at the active plan cap for under/over coloring. */
export function splitUsageAtCap(
  committedBytes: number,
  selectedBytes: number,
  activeCapBytes: number
): {
  committedUnder: number;
  committedOver: number;
  selectedUnder: number;
  selectedOver: number;
} {
  const cap = Math.max(0, activeCapBytes);
  const committed = Math.max(0, committedBytes);
  const selected = Math.max(0, selectedBytes);

  const committedUnder = Math.min(committed, cap);
  const committedOver = Math.max(0, committed - cap);
  const remainingCap = Math.max(0, cap - committedUnder);
  const selectedUnder = Math.min(selected, remainingCap);
  const selectedOver = Math.max(0, selected - selectedUnder);

  return { committedUnder, committedOver, selectedUnder, selectedOver };
}
