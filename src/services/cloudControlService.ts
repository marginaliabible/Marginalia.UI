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

function getCloudControlServiceUrl(): string {
  return (import.meta.env['VITE_AUTH_SERVICE_URL'] || '').trim().replace(/\/$/, '');
}

export async function queueCloudFolderSelection(request: CloudFolderSelectionRequest): Promise<void> {
  const baseUrl = getCloudControlServiceUrl();
  if (!baseUrl) {
    return;
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
}
