import type { FederatedProvider, LinkedCloudAccount, MarginaliaState } from '../models/bible';
import type { FederatedSession } from './federatedAuthService';
import { isSupportedMarkupFileName } from '../utils/supportedMarkupFileTypes';

const GOOGLE_APPDATA_FILENAME = 'marginalia-config.json';
const MICROSOFT_CONFIG_PATH = 'marginalia-config.json';

const GOOGLE_DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const GOOGLE_DRIVE_UPLOAD_API_BASE = 'https://www.googleapis.com/upload/drive/v3';
const MICROSOFT_GRAPH_DRIVE_API_BASE = 'https://graph.microsoft.com/v1.0/me/drive';

function googleDriveFilesUrl(query?: URLSearchParams | string): string {
  const suffix = typeof query === 'string'
    ? (query.startsWith('?') || query.startsWith('/') ? query : `?${query}`)
    : query
      ? `?${query.toString()}`
      : '';
  return `${GOOGLE_DRIVE_API_BASE}/files${suffix}`;
}

function googleDriveFileUrl(fileId: string, query?: string): string {
  const encodedId = encodeURIComponent(fileId);
  return query
    ? `${GOOGLE_DRIVE_API_BASE}/files/${encodedId}?${query}`
    : `${GOOGLE_DRIVE_API_BASE}/files/${encodedId}`;
}

function googleDriveUploadFileUrl(fileId?: string): string {
  return fileId
    ? `${GOOGLE_DRIVE_UPLOAD_API_BASE}/files/${encodeURIComponent(fileId)}?uploadType=multipart`
    : `${GOOGLE_DRIVE_UPLOAD_API_BASE}/files?uploadType=multipart`;
}

function microsoftDriveChildrenUrl(parentId: string = 'root', select?: string): string {
  const base = parentId === 'root'
    ? `${MICROSOFT_GRAPH_DRIVE_API_BASE}/root/children`
    : `${MICROSOFT_GRAPH_DRIVE_API_BASE}/items/${encodeURIComponent(parentId)}/children`;
  return select ? `${base}?$select=${select}` : base;
}

function microsoftDriveItemUrl(itemId: string, select?: string): string {
  const base = `${MICROSOFT_GRAPH_DRIVE_API_BASE}/items/${encodeURIComponent(itemId)}`;
  return select ? `${base}?$select=${select}` : base;
}

function microsoftDriveSpecialUrl(specialFolder: string, select?: string): string {
  const base = `${MICROSOFT_GRAPH_DRIVE_API_BASE}/special/${specialFolder}`;
  return select ? `${base}?$select=${select}` : base;
}

function microsoftDriveApprootContentUrl(relativePath: string): string {
  return `${MICROSOFT_GRAPH_DRIVE_API_BASE}/special/approot:/${encodeURIComponent(relativePath)}:/content`;
}

export interface CloudSyncTargetOption {
  id: string;
  kind: 'file' | 'folder';
  name?: string;
}

export interface CloudFolderEntry {
  id: string;
  name: string;
  kind: 'file' | 'folder';
  sizeBytes: number;
  hasChildren: boolean;
}

export interface CloudFolderLineageEntry {
  id: string;
  name: string;
  sizeBytes: number;
  hasChildren: boolean;
}

export interface SyncedCloudFolderSelection {
  id: string;
  kind: 'folder';
  name?: string;
  path?: string;
  sizeBytes?: number;
  sizeKnown?: boolean;
  // Cloud item IDs (folders or files, any depth) explicitly excluded from sync within this selection.
  excludedItemIds?: string[];
  tags?: string[];
  itemTags?: Record<string, string[]>;
  itemTagExclusions?: Record<string, string[]>;
}

export interface SyncedCloudConfig {
  schemaVersion: 1;
  updatedAt: number;
  linkedAccounts: LinkedCloudAccount[];
  config: Pick<
    MarginaliaState,
    | 'lastTranslationId'
    | 'lastTranslationIds'
    | 'translationRecords'
    | 'lastBook'
    | 'lastChapter'
    | 'languages'
    | 'sourceUrls'
    | 'resourceHiddenTags'
    | 'theme'
    | 'userId'
  > & {
    providerFolderSelections?: Partial<Record<FederatedProvider, SyncedCloudFolderSelection[]>>;
  };
}

function isLinkedCloudAccount(value: unknown): value is LinkedCloudAccount {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<LinkedCloudAccount>;
  return (
    (candidate.provider === 'google' || candidate.provider === 'microsoft')
    && typeof candidate.providerAccountId === 'string'
    && candidate.providerAccountId.trim().length > 0
    && typeof candidate.linkedAt === 'number'
  );
}

function isSyncedCloudConfig(value: unknown): value is SyncedCloudConfig {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<SyncedCloudConfig>;
  return (
    candidate.schemaVersion === 1
    && typeof candidate.updatedAt === 'number'
    && Array.isArray(candidate.linkedAccounts)
    && candidate.linkedAccounts.every((entry) => isLinkedCloudAccount(entry))
    && Boolean(candidate.config)
  );
}

function toUniqueLinkedAccounts(accounts: LinkedCloudAccount[]): LinkedCloudAccount[] {
  const map = new Map<string, LinkedCloudAccount>();

  for (const account of accounts) {
    const key = `${account.provider}:${account.providerAccountId}`;
    map.set(key, account);
  }

  return Array.from(map.values()).sort((left, right) => left.linkedAt - right.linkedAt);
}

async function fetchGoogleConfigFileId(accessToken: string): Promise<string | null> {
  const query = encodeURIComponent(`name = '${GOOGLE_APPDATA_FILENAME}' and trashed = false`);
  const url = googleDriveFilesUrl(`q=${query}&spaces=appDataFolder&fields=files(id,name)&pageSize=1`);
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Google Drive file lookup failed (${response.status}).`);
  }

  const payload = (await response.json()) as { files?: Array<{ id?: string }> };
  const fileId = payload.files?.[0]?.id;
  return typeof fileId === 'string' && fileId.trim().length > 0 ? fileId : null;
}

async function readGoogleConfig(session: FederatedSession): Promise<SyncedCloudConfig | null> {
  const fileId = await fetchGoogleConfigFileId(session.accessToken);
  if (!fileId) {
    return null;
  }

  const response = await fetch(googleDriveFileUrl(fileId, 'alt=media'), {
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Google Drive config read failed (${response.status}).`);
  }

  const payload = (await response.json()) as unknown;
  if (!isSyncedCloudConfig(payload)) {
    return null;
  }

  return {
    ...payload,
    linkedAccounts: toUniqueLinkedAccounts(payload.linkedAccounts),
  };
}

function createGoogleMultipartBody(
  payload: SyncedCloudConfig,
  boundary: string,
  options?: { includeParents?: boolean }
): string {
  const metadata: {
    name: string;
    mimeType: string;
    parents?: string[];
  } = {
    name: GOOGLE_APPDATA_FILENAME,
    mimeType: 'application/json',
  };

  // Google Drive forbids writing parents directly during update (PATCH).
  if (options?.includeParents) {
    metadata.parents = ['appDataFolder'];
  }

  const contentJson = JSON.stringify(payload);
  return [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    contentJson,
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

async function writeGoogleConfig(session: FederatedSession, payload: SyncedCloudConfig): Promise<void> {
  const existingFileId = await fetchGoogleConfigFileId(session.accessToken);
  const boundary = `marginalia_${Date.now().toString(16)}`;

  const isUpdate = Boolean(existingFileId);
  const body = createGoogleMultipartBody(payload, boundary, { includeParents: !isUpdate });
  const method = isUpdate ? 'PATCH' : 'POST';
  const base = googleDriveUploadFileUrl(isUpdate ? existingFileId as string : undefined);

  const response = await fetch(base, {
    method,
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Drive config write failed (${response.status}): ${text}`);
  }
}

async function readMicrosoftConfig(session: FederatedSession): Promise<SyncedCloudConfig | null> {
  const url = microsoftDriveApprootContentUrl(MICROSOFT_CONFIG_PATH);
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Microsoft config read failed (${response.status}).`);
  }

  const payload = (await response.json()) as unknown;
  if (!isSyncedCloudConfig(payload)) {
    return null;
  }

  return {
    ...payload,
    linkedAccounts: toUniqueLinkedAccounts(payload.linkedAccounts),
  };
}

async function writeMicrosoftConfig(session: FederatedSession, payload: SyncedCloudConfig): Promise<void> {
  const url = microsoftDriveApprootContentUrl(MICROSOFT_CONFIG_PATH);
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Microsoft config write failed (${response.status}): ${text}`);
  }
}

async function listGoogleCloudSyncTargets(session: FederatedSession): Promise<CloudSyncTargetOption[]> {
  const url = googleDriveFilesUrl('fields=files(id,name,mimeType)&q=trashed=false&pageSize=100');
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Drive target listing failed (${response.status}): ${text}`);
  }

  const payload = (await response.json()) as {
    files?: Array<{ id?: string; name?: string; mimeType?: string }>;
  };

  const files = Array.isArray(payload.files) ? payload.files : [];
  return files
    .filter((entry) => typeof entry.id === 'string' && entry.id.trim().length > 0)
    .map((entry) => ({
      id: entry.id as string,
      name: typeof entry.name === 'string' ? entry.name : undefined,
      kind: entry.mimeType === 'application/vnd.google-apps.folder' ? 'folder' : 'file',
    }));
}

async function listMicrosoftCloudSyncTargets(
  session: FederatedSession,
  parentId: string = 'root'
): Promise<CloudSyncTargetOption[]> {
  const url = microsoftDriveChildrenUrl(parentId, 'id,name,folder,file');
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Microsoft target listing failed (${response.status}): ${text}`);
  }

  const payload = (await response.json()) as {
    value?: Array<{ id?: string; name?: string; folder?: unknown }>;
  };

  const items = Array.isArray(payload.value) ? payload.value : [];
  return items
    .filter((entry) => typeof entry.id === 'string' && entry.id.trim().length > 0)
    .map((entry) => ({
      id: entry.id as string,
      name: typeof entry.name === 'string' ? entry.name : undefined,
      kind: entry.folder ? 'folder' : 'file',
    }));
}

async function listGoogleFolderChildren(
  session: FederatedSession,
  parentId: string
): Promise<CloudFolderEntry[]> {
  let pageToken: string | null = null;
  const allFolders: CloudFolderEntry[] = [];

  do {
    const params = new URLSearchParams({
      q: `'${parentId}' in parents and trashed=false`,
      fields: 'files(id,name,mimeType,quotaBytesUsed,size),nextPageToken',
      pageSize: '200',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });

    if (pageToken) {
      params.set('pageToken', pageToken);
    }

    const response = await fetch(googleDriveFilesUrl(params), {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google Drive folder listing failed (${response.status}): ${text}`);
    }

    const payload = (await response.json()) as {
      files?: Array<{
        id?: string;
        name?: string;
        mimeType?: string;
        quotaBytesUsed?: string;
        size?: string;
      }>;
      nextPageToken?: string;
    };

    const entries = Array.isArray(payload.files) ? payload.files : [];
    for (const entry of entries) {
      if (typeof entry.id !== 'string' || entry.id.trim().length === 0) {
        continue;
      }

      const isFolder = entry.mimeType === 'application/vnd.google-apps.folder';

      allFolders.push({
        id: entry.id,
        name: typeof entry.name === 'string' && entry.name.trim().length > 0 ? entry.name : 'Untitled',
        kind: isFolder ? 'folder' : 'file',
        sizeBytes: isFolder ? Number(entry.quotaBytesUsed || 0) || 0 : Number(entry.size || 0) || 0,
        // Drive v3 does not return child-count metadata in this listing shape.
        // Assume expandable initially; once loaded, downstream UI collapses empty folders.
        hasChildren: isFolder,
      });
    }

    pageToken = typeof payload.nextPageToken === 'string' && payload.nextPageToken.trim().length > 0
      ? payload.nextPageToken
      : null;
  } while (pageToken);

  return allFolders;
}

async function listMicrosoftFolderChildren(
  session: FederatedSession,
  parentId: string
): Promise<CloudFolderEntry[]> {
  const seenById = new Set<string>();
  let nextUrl = microsoftDriveChildrenUrl(parentId, 'id,name,folder,file,size,remoteItem');
  const allFolders: CloudFolderEntry[] = [];

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Microsoft folder listing failed (${response.status}): ${text}`);
    }

    const payload = (await response.json()) as {
      value?: Array<{
        id?: string;
        name?: string;
        size?: number;
        folder?: { childCount?: number };
        file?: unknown;
        remoteItem?: {
          id?: string;
          name?: string;
          size?: number;
          folder?: { childCount?: number };
          file?: unknown;
        };
      }>;
      '@odata.nextLink'?: string;
    };

    const items = Array.isArray(payload.value) ? payload.value : [];
    for (const item of items) {
      const folderFacet = item.folder ?? item.remoteItem?.folder;
      const fileFacet = item.file ?? item.remoteItem?.file;
      const itemId = item.id ?? item.remoteItem?.id;
      const itemName = item.name ?? item.remoteItem?.name;
      const itemSize = item.size ?? item.remoteItem?.size;

      if ((!folderFacet && !fileFacet) || typeof itemId !== 'string' || itemId.trim().length === 0) {
        continue;
      }

      if (seenById.has(itemId)) {
        continue;
      }

      seenById.add(itemId);

      allFolders.push({
        id: itemId,
        name: typeof itemName === 'string' && itemName.trim().length > 0 ? itemName : 'Untitled',
        kind: folderFacet ? 'folder' : 'file',
        sizeBytes: typeof itemSize === 'number' && Number.isFinite(itemSize) ? itemSize : 0,
        hasChildren: folderFacet ? Number(folderFacet.childCount || 0) > 0 : false,
      });
    }

    nextUrl = typeof payload['@odata.nextLink'] === 'string' && payload['@odata.nextLink'].trim().length > 0
      ? payload['@odata.nextLink']
      : '';
  }

  if (parentId === 'root' && !allFolders.some((entry) => entry.kind === 'folder' && entry.name.trim().toLowerCase() === 'documents')) {
    const specialDocumentsResponse = await fetch(microsoftDriveSpecialUrl('documents', 'id,name,folder,size'), {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
      },
    });

    if (specialDocumentsResponse.ok) {
      const specialDocuments = (await specialDocumentsResponse.json()) as {
        id?: string;
        name?: string;
        size?: number;
        folder?: { childCount?: number };
      };

      if (
        specialDocuments.folder
        && typeof specialDocuments.id === 'string'
        && specialDocuments.id.trim().length > 0
        && !seenById.has(specialDocuments.id)
      ) {
        allFolders.push({
          id: specialDocuments.id,
          name: typeof specialDocuments.name === 'string' && specialDocuments.name.trim().length > 0
            ? specialDocuments.name
            : 'Documents',
          kind: 'folder',
          sizeBytes: typeof specialDocuments.size === 'number' && Number.isFinite(specialDocuments.size)
            ? specialDocuments.size
            : 0,
          hasChildren: Number(specialDocuments.folder.childCount || 0) > 0,
        });
      }
    }
  }

  return allFolders;
}

async function readMicrosoftFolderLineage(
  session: FederatedSession,
  folderId: string
): Promise<CloudFolderLineageEntry[]> {
  const lineageFromLeaf: CloudFolderLineageEntry[] = [];
  const seenIds = new Set<string>();
  let currentId = folderId;

  while (typeof currentId === 'string' && currentId.trim().length > 0 && !seenIds.has(currentId)) {
    seenIds.add(currentId);

    const response = await fetch(
      microsoftDriveItemUrl(currentId, 'id,name,size,folder,parentReference'),
      {
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
        },
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Microsoft folder lineage read failed (${response.status}): ${text}`);
    }

    const payload = (await response.json()) as {
      id?: string;
      name?: string;
      size?: number;
      folder?: { childCount?: number };
      parentReference?: {
        id?: string;
        path?: string;
      };
    };

    if (!payload.folder || typeof payload.id !== 'string' || payload.id.trim().length === 0) {
      break;
    }

    lineageFromLeaf.push({
      id: payload.id,
      name: typeof payload.name === 'string' && payload.name.trim().length > 0 ? payload.name : 'Untitled folder',
      sizeBytes: typeof payload.size === 'number' && Number.isFinite(payload.size) ? payload.size : 0,
      hasChildren: Number(payload.folder.childCount || 0) > 0,
    });

    const parentId = typeof payload.parentReference?.id === 'string' ? payload.parentReference.id : '';
    const parentPath = typeof payload.parentReference?.path === 'string' ? payload.parentReference.path : '';

    if (!parentId || parentPath === '/drive/root:') {
      break;
    }

    currentId = parentId;
  }

  return lineageFromLeaf.reverse();
}

export async function listFolderChildrenForSession(
  session: FederatedSession,
  parentId: string
): Promise<CloudFolderEntry[]> {
  if (session.provider === 'google') {
    return listGoogleFolderChildren(session, parentId);
  }

  return listMicrosoftFolderChildren(session, parentId);
}

export async function computeSupportedFolderSizeForSession(
  session: FederatedSession,
  folderId: string
): Promise<number> {
  const visitedFolderIds = new Set<string>([folderId]);
  let currentLevelIds: string[] = [folderId];
  let totalBytes = 0;

  // Fetch each BFS level concurrently instead of one folder at a time so large trees resolve quickly.
  while (currentLevelIds.length > 0) {
    const levelChildren = await Promise.all(
      currentLevelIds.map((currentFolderId) => listFolderChildrenForSession(session, currentFolderId))
    );

    const nextLevelIds: string[] = [];
    for (const children of levelChildren) {
      for (const child of children) {
        if (child.kind === 'folder') {
          if (!visitedFolderIds.has(child.id)) {
            visitedFolderIds.add(child.id);
            nextLevelIds.push(child.id);
          }

          continue;
        }

        if (isSupportedMarkupFileName(child.name)) {
          totalBytes += child.sizeBytes;
        }
      }
    }

    currentLevelIds = nextLevelIds;
  }

  return totalBytes;
}

export async function readFolderLineageForSession(
  session: FederatedSession,
  folderId: string
): Promise<CloudFolderLineageEntry[]> {
  if (session.provider === 'microsoft') {
    return readMicrosoftFolderLineage(session, folderId);
  }

  return [];
}

export async function readCloudConfigForSession(session: FederatedSession): Promise<SyncedCloudConfig | null> {
  if (session.provider === 'google') {
    return readGoogleConfig(session);
  }

  return readMicrosoftConfig(session);
}

export async function writeCloudConfigForSession(session: FederatedSession, payload: SyncedCloudConfig): Promise<void> {
  if (session.provider === 'google') {
    await writeGoogleConfig(session, payload);
    return;
  }

  await writeMicrosoftConfig(session, payload);
}

export async function listCloudSyncTargetsForSession(session: FederatedSession): Promise<CloudSyncTargetOption[]> {
  if (session.provider === 'google') {
    return listGoogleCloudSyncTargets(session);
  }

  return listMicrosoftCloudSyncTargets(session);
}

export async function listMicrosoftCloudSyncTargetsForSession(
  session: FederatedSession,
  parentId: string = 'root'
): Promise<CloudSyncTargetOption[]> {
  if (session.provider !== 'microsoft') {
    throw new Error('Microsoft target listing requires a Microsoft session.');
  }

  return listMicrosoftCloudSyncTargets(session, parentId);
}

export function mergeLinkedAccounts(
  existing: LinkedCloudAccount[],
  next: LinkedCloudAccount[]
): LinkedCloudAccount[] {
  return toUniqueLinkedAccounts([...existing, ...next]);
}

export function hasLinkedProvider(
  linkedAccounts: LinkedCloudAccount[],
  provider: FederatedProvider
): boolean {
  return linkedAccounts.some((entry) => entry.provider === provider);
}
