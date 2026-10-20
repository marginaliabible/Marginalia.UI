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

/**
 * Preview publican adjustments before Apply:
 * - Selecting a doc whose published hash matches a mod/del row clears that row's size from blue.
 * - Deselecting an already-uploaded doc adds floor(fileSize/2) to blue.
 */
export function computeSyncPlanUsage(input: SyncPlanUsageInput): SyncPlanUsageResult {
  const committedBaseBytes = sumCommittedSizes(input.committed);
  const stagedIds = new Set(input.stagedSelectedDocs.map((doc) => doc.documentId));
  const appliedById = new Map(input.appliedSelectedDocs.map((doc) => [doc.documentId, doc]));

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
  for (const doc of input.stagedSelectedDocs) {
    const publishedHash = normalizeHash(
      input.publishedByDocumentId.get(doc.documentId) ?? doc.hash
    );
    if (!publishedHash || clearedHashes.has(publishedHash)) {
      continue;
    }
    const amount = modDelByHash.get(publishedHash);
    if (amount && amount > 0) {
      clearedCommittedBytes += amount;
      clearedHashes.add(publishedHash);
    }
  }

  let pendingDelChargeBytes = 0;
  for (const rootBytes of input.deselectedAppliedRootBytes ?? []) {
    const sizeBytes = Math.max(0, Math.floor(Number(rootBytes) || 0));
    if (sizeBytes > 0) {
      pendingDelChargeBytes += Math.floor(sizeBytes / 2);
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
