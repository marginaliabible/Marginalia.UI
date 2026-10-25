import type { FederatedProvider } from '../models/bible';
import { noteCcsAuthFailure } from './brokerSessionPrompt';

export interface CloudFolderSelectionRequest {
  userId: string;
  provider: FederatedProvider;
  // Folders deselected on this Apply — one-shot prune hint; selection SoT is marginalia-config.json.
  removed: string[];
  // Transient credential used only to enumerate the selected folders right now; CloudControlService
  // never persists it.
  accessToken?: string;
  // 'background' marks a settings reconcile rather than the user's Apply; it never resumes a
  // provider that was signed out.
  trigger: 'apply' | 'background';
}

export interface CloudFolderSelectionResponse {
  ok: boolean;
  message?: string;
  // The provider is still awaiting the user's first Apply after signing back in; nothing was queued.
  awaitingApply?: boolean;
  libraryUrl?: string | null;
  userId?: string;
  provider?: string;
  selectedFolders?: string[];
}

export interface SyncActivityRequest {
  userId: string;
}

export type CloudSyncState = 'idle' | 'queued' | 'syncing' | 'attention';

// A selected file MarkupServer kept out of the library for averaging under one verse reference per page.
export interface CloudRejectedDocument {
  documentId: string;
  fileName: string;
  verseRatio?: number;
}

/** Folder-inherited file skipped for exceeding the page limit; not rejected — the user can still select it. */
export interface CloudSkippedDocument {
  documentId: string;
  fileName: string;
  pages?: number;
}

// A selected file that failed to convert and still has no published hash, so it is not viewable.
export interface CloudFailedDocument {
  documentId: string;
  fileName: string;
  /** Raw converter error; the SPA maps this to a friendly message. Admin shows it as-is. */
  error?: string;
}

export interface CloudProviderSyncStatus {
  state: CloudSyncState;
  startsAt?: string;
  lastCompletedAt?: string;
  failedCount?: number;
  rejectedDocuments?: CloudRejectedDocument[];
  skippedDocuments?: CloudSkippedDocument[];
  failedDocuments?: CloudFailedDocument[];
  // Set (with state 'attention') while the provider was signed out and its restored selection
  // has not been applied since signing back in.
  disconnectedAt?: string;
}

export interface CloudSyncStatus {
  ok: boolean;
  userId: string;
  // Most active non-attention provider state; null when every provider needs attention.
  overall: Exclude<CloudSyncState, 'attention'> | null;
  pollAfterMs: number;
  providers: Partial<Record<FederatedProvider, CloudProviderSyncStatus>>;
}

export interface CloudSyncStatusRequest {
  userId: string;
  providers: FederatedProvider[];
  signal?: AbortSignal;
}

function getCloudControlServiceUrl(): string {
  return (import.meta.env['VITE_AUTH_SERVICE_URL'] || '').trim().replace(/\/$/, '');
}

async function readCcsFailure(response: Response): Promise<string> {
  const text = await response.text();
  noteCcsAuthFailure(response.status, text);
  return text;
}

export async function queueCloudFolderSelection(
  request: CloudFolderSelectionRequest
): Promise<CloudFolderSelectionResponse | null> {
  const baseUrl = getCloudControlServiceUrl();
  if (!baseUrl) {
    return null;
  }

  const provider = request.provider === 'google' ? 'GoogleDrive' : 'OneDrive';
  const response = await fetch(`${baseUrl}/sync/folder-selection`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...request,
      provider,
    }),
  });

  if (!response.ok) {
    const message = await readCcsFailure(response);
    throw new Error(`CloudControlService folder selection failed (${response.status}): ${message}`);
  }

  try {
    return (await response.json()) as CloudFolderSelectionResponse;
  } catch {
    return { ok: true };
  }
}

export async function fetchCloudSyncStatus(request: CloudSyncStatusRequest): Promise<CloudSyncStatus | null> {
  const baseUrl = getCloudControlServiceUrl();
  if (!baseUrl) {
    return null;
  }

  const response = await fetch(`${baseUrl}/sync/status`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: request.userId, providers: request.providers }),
    signal: request.signal,
  });

  if (!response.ok) {
    const message = await readCcsFailure(response);
    throw new Error(`CloudControlService sync status failed (${response.status}): ${message}`);
  }

  return (await response.json()) as CloudSyncStatus;
}

export interface DeveloperCapabilities {
  ok: boolean;
  isDeveloper: boolean;
}

export async function fetchDeveloperCapabilities(userId?: string | null): Promise<DeveloperCapabilities | null> {
  const baseUrl = getCloudControlServiceUrl();
  if (!baseUrl) {
    return null;
  }

  const response = await fetch(`${baseUrl}/dev/capabilities`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(userId ? { userId } : {}),
  });
  if (!response.ok) {
    await readCcsFailure(response);
    return { ok: false, isDeveloper: false };
  }
  try {
    const payload = (await response.json()) as DeveloperCapabilities;
    return { ok: payload.ok !== false, isDeveloper: payload.isDeveloper === true };
  } catch {
    return { ok: false, isDeveloper: false };
  }
}

export interface ReprocessDocumentRequest {
  userId: string;
  provider: FederatedProvider;
  documentId: string;
  fileName?: string;
}

export async function requestDocumentReprocess(request: ReprocessDocumentRequest): Promise<void> {
  const baseUrl = getCloudControlServiceUrl();
  if (!baseUrl) {
    throw new Error('CloudControlService is not configured.');
  }

  const provider = request.provider === 'google' ? 'GoogleDrive' : 'OneDrive';
  const response = await fetch(`${baseUrl}/sync/reprocess-document`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      userId: request.userId,
      provider,
      documentId: request.documentId,
      ...(request.fileName ? { fileName: request.fileName } : {}),
    }),
  });
  if (!response.ok) {
    const message = await readCcsFailure(response);
    throw new Error(`Couldn't blow away and reprocess this document (${response.status}): ${message}`);
  }
}

/** Fire-and-forget presence ping so CCS can use the active (5m) File Sync debounce. */
export async function reportSyncActivity(request: SyncActivityRequest): Promise<void> {
  const baseUrl = getCloudControlServiceUrl();
  const userId = String(request.userId ?? '').trim();
  if (!baseUrl || !userId) {
    return;
  }

  try {
    const response = await fetch(`${baseUrl}/sync/activity`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    if (!response.ok) {
      await readCcsFailure(response);
    }
  } catch {
    // Presence is best-effort; never block the UI on network errors.
  }
}

export {
  clearStorageSession,
  establishStorageSession,
  fetchStorageAware,
  isStorageGatewayUrl,
} from './storageAuthenticatedFetch';
