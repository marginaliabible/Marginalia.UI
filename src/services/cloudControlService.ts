import type { FederatedProvider } from '../models/bible';

export interface CloudFolderSelectionRequest {
  userId: string;
  provider: FederatedProvider;
  // Folders deselected on this Apply — one-shot prune hint; selection SoT is marginalia-config.json.
  removed: string[];
  // Transient credential used only to enumerate the selected folders right now; CloudControlService
  // never persists it.
  accessToken?: string;
}

export interface CloudFolderSelectionResponse {
  ok: boolean;
  message?: string;
  libraryUrl?: string | null;
  userId?: string;
  provider?: string;
  selectedFolders?: string[];
}

export interface SyncActivityRequest {
  userId: string;
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
