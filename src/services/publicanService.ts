import type { FederatedProvider } from '../models/bible';
import { readResourceDocumentEntry, type ResourceDocumentEntry } from '../utils/resourceLibraryConfig';
import type { PublicanCommittedEntry } from '../utils/syncPlanUsage';
import {
  fetchStorageAware,
  getStorageSessionUserId,
} from './storageAuthenticatedFetch';
import { getConfiguredStorageBaseUrl } from './storageEnv';

const DEFAULT_STORAGE_BASE_URL = 'https://storage.marginaliabible.com';

const PROVIDER_FOLDER: Record<FederatedProvider, string> = {
  google: 'GoogleDrive',
  microsoft: 'OneDrive',
};

export interface PublicanManifest {
  modifiedOn?: string;
  committed: PublicanCommittedEntry[];
}

export interface SyncPlanLedgerSnapshot {
  committed: PublicanCommittedEntry[];
  /** documentId → content hash from provider documents.json. */
  publishedByDocumentId: Map<string, string>;
  /** documentId → size from documents when present (usually absent). */
  documentsById: Map<string, ResourceDocumentEntry>;
}

function storageBaseUrl(): string {
  return getConfiguredStorageBaseUrl() || DEFAULT_STORAGE_BASE_URL;
}

function encodeUserId(userId: string): string {
  // Storage object keys use a literal `@` in the email. encodeURIComponent turns it into
  // `%40`, and the gateway looks up that encoded key as a different object (404).
  return encodeURIComponent(userId).replaceAll('%40', '@');
}

async function fetchJsonIfPresent(url: string): Promise<unknown | null> {
  try {
    const response = await fetchStorageAware(url, { cache: 'no-cache' });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

function parsePublican(payload: unknown): PublicanCommittedEntry[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  const committed = (payload as { committed?: unknown }).committed;
  if (!Array.isArray(committed)) {
    return [];
  }
  const entries: PublicanCommittedEntry[] = [];
  for (const raw of committed) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    const entry = raw as Record<string, unknown>;
    const documentId = typeof entry.documentId === 'string' ? entry.documentId.trim() : '';
    const hash = typeof entry.hash === 'string' ? entry.hash.trim().toLowerCase() : '';
    const type = typeof entry.type === 'string' ? entry.type : '';
    const size = Math.max(0, Math.floor(Number(entry.size) || 0));
    if (!documentId && !hash) {
      continue;
    }
    entries.push({
      addedOn: typeof entry.addedOn === 'string' ? entry.addedOn : undefined,
      provider: typeof entry.provider === 'string' ? entry.provider : undefined,
      type,
      size,
      documentId,
      hash,
    });
  }
  return entries;
}

export async function loadPublicanCommitted(userId?: string): Promise<PublicanCommittedEntry[]> {
  const resolvedUserId = String(userId ?? getStorageSessionUserId()).trim();
  if (!resolvedUserId) {
    return [];
  }
  const url = `${storageBaseUrl()}/users/${encodeUserId(resolvedUserId)}/publican.json`;
  const payload = await fetchJsonIfPresent(url);
  return parsePublican(payload);
}

export async function loadProviderDocumentsMap(
  provider: FederatedProvider,
  userId?: string
): Promise<Map<string, ResourceDocumentEntry>> {
  const resolvedUserId = String(userId ?? getStorageSessionUserId()).trim();
  const map = new Map<string, ResourceDocumentEntry>();
  if (!resolvedUserId) {
    return map;
  }
  const folder = PROVIDER_FOLDER[provider];
  const url = `${storageBaseUrl()}/users/${encodeUserId(resolvedUserId)}/${folder}/documents.json`;
  const payload = await fetchJsonIfPresent(url);
  if (!payload || typeof payload !== 'object') {
    return map;
  }
  const documents = (payload as { documents?: unknown }).documents;
  if (!Array.isArray(documents)) {
    return map;
  }
  for (const item of documents) {
    const entry = readResourceDocumentEntry(item);
    if (entry) {
      map.set(entry.documentId, entry);
    }
  }
  return map;
}

/** Load publican + both provider document maps for Account Sync usage preview. */
export async function loadSyncPlanLedger(
  providers: FederatedProvider[],
  userId?: string
): Promise<SyncPlanLedgerSnapshot> {
  const resolvedUserId = String(userId ?? getStorageSessionUserId()).trim();
  const committed = await loadPublicanCommitted(resolvedUserId);
  const publishedByDocumentId = new Map<string, string>();
  const documentsById = new Map<string, ResourceDocumentEntry>();

  await Promise.all(providers.map(async (provider) => {
    const docs = await loadProviderDocumentsMap(provider, resolvedUserId);
    for (const [documentId, entry] of docs) {
      documentsById.set(documentId, entry);
      if (entry.hash) {
        publishedByDocumentId.set(documentId, entry.hash.trim().toLowerCase());
      }
    }
  }));

  return { committed, publishedByDocumentId, documentsById };
}
