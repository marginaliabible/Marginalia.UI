import type { FederatedProvider } from '../models/bible';

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

export interface CloudProviderSyncStatus {
  state: CloudSyncState;
  startsAt?: string;
  lastCompletedAt?: string;
  failedCount?: number;
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
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...request,
      provider,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
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
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: request.userId, providers: request.providers }),
    signal: request.signal,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`CloudControlService sync status failed (${response.status}): ${message}`);
  }

  return (await response.json()) as CloudSyncStatus;
}

/** Fire-and-forget presence ping so CCS can use the active (5m) File Sync debounce. */
export async function reportSyncActivity(request: SyncActivityRequest): Promise<void> {
  const baseUrl = getCloudControlServiceUrl();
  const userId = String(request.userId ?? '').trim();
  if (!baseUrl || !userId) {
    return;
  }

  try {
    await fetch(`${baseUrl}/sync/activity`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
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
