import { getConfiguredStorageBaseUrl, getDocumentRenderEpochOverride } from './storageEnv';

const DEFAULT_STORAGE_HOST = 'storage.marginaliabible.com';

/**
 * The gateway serves `/documents/` files as immutable for a year when this epoch is in
 * the URL. Bump it only after re-rendered output is in R2, or browsers will cache the
 * old render under the new epoch.
 */
export const DOCUMENT_RENDER_EPOCH = '2';
const DOCUMENT_RENDER_EPOCH_PARAM = 'r';

let cachedStorageUserId = '';

function getDocumentRenderEpoch(): string {
  return getDocumentRenderEpochOverride() || DOCUMENT_RENDER_EPOCH;
}

/** Add the render epoch query parameter to gateway `/documents/` URLs; other URLs are returned unchanged. */
export function withDocumentRenderEpoch(url: string): string {
  if (!isStorageGatewayUrl(url)) {
    return url;
  }
  try {
    const parsed = new URL(url);
    if (!parsed.pathname.startsWith('/documents/')) {
      return url;
    }
    parsed.searchParams.set(DOCUMENT_RENDER_EPOCH_PARAM, getDocumentRenderEpoch());
    return parsed.toString();
  } catch {
    return url;
  }
}

/** Keep the signed-in user id available for 401 session refresh retries. */
export function setStorageSessionUserId(userId: string | null | undefined): void {
  cachedStorageUserId = String(userId ?? '').trim();
}

export function getStorageSessionUserId(): string {
  return cachedStorageUserId;
}

/** Hostname(s) that require the HttpOnly storage session cookie. */
export function getStorageGatewayHosts(): Set<string> {
  const hosts = new Set<string>([DEFAULT_STORAGE_HOST]);
  const configured = getConfiguredStorageBaseUrl();
  if (configured) {
    try {
      hosts.add(new URL(configured).hostname.toLowerCase());
    } catch {
      // Ignore malformed env values.
    }
  }
  return hosts;
}

export function isStorageGatewayUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return getStorageGatewayHosts().has(hostname);
  } catch {
    return false;
  }
}

type StorageSessionRefresher = (userId?: string) => Promise<boolean>;

let refreshStorageSession: StorageSessionRefresher = async () => false;

/** Sanctum registers CCS storage-session minting; the open-source build leaves this as a no-op. */
export function setStorageSessionRefresher(refresher: StorageSessionRefresher | null): void {
  refreshStorageSession = refresher ?? (async () => false);
}

type FetchInit = RequestInit & { cache?: RequestCache };

/**
 * fetch() that sends credentials for storage-gateway URLs and retries once after
 * refreshing the storage session when the Worker returns 401. Caching follows the
 * gateway's Cache-Control unless the caller passes `cache`.
 */
export async function fetchStorageAware(input: string, init: FetchInit = {}): Promise<Response> {
  const original = String(input);
  if (!isStorageGatewayUrl(original)) {
    return fetch(original, init);
  }

  const url = withDocumentRenderEpoch(original);
  const nextInit: FetchInit = {
    ...init,
    credentials: 'include',
  };

  let response = await fetch(url, nextInit);
  if (response.status !== 401) {
    return response;
  }

  const refreshed = await refreshStorageSession();
  if (!refreshed) {
    return response;
  }

  return fetch(url, nextInit);
}
