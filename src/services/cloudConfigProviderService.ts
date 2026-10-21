import type { FederatedProvider, LinkedCloudAccount, MarginaliaState } from '../models/bible';
import type { FederatedSession } from './federatedAuthService';
import type { SyncedConfigField } from './cloudConfigMerge';
import { isSupportedMarkupFileName } from '../utils/supportedMarkupFileTypes';
import type { ResourceTagColors } from '../utils/resourceTagColors';

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

function microsoftDriveChildrenUrl(
  parentId: string = 'root',
  select?: string,
  driveId?: string
): string {
  // Shared/remote folder stubs must be listed via /drives/{driveId}/items/{id}/children.
  // Using /me/drive/items/{localStubId}/children returns getChildrenOnNonFolder.
  const base = driveId
    ? `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(parentId)}/children`
    : parentId === 'root'
      ? `${MICROSOFT_GRAPH_DRIVE_API_BASE}/root/children`
      : `${MICROSOFT_GRAPH_DRIVE_API_BASE}/items/${encodeURIComponent(parentId)}/children`;
  return select ? `${base}?$select=${select}` : base;
}

function isMicrosoftGetChildrenOnNonFolderError(status: number, bodyText: string): boolean {
  if (status !== 400 && status !== 422) {
    return false;
  }

  return /getChildrenOnNonFolder|Children cannot be listed from an item that is not a folder/i.test(bodyText);
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
  /** Provider last-modified (Google `modifiedTime`, Graph `lastModifiedDateTime`). */
  lastModified?: string;
  /**
   * Microsoft Graph drive id for shared/remote folders that must be listed via
   * `/drives/{driveId}/items/{id}/children` instead of `/me/drive/items/{id}/children`.
   */
  driveId?: string;
}

export interface SupportedFolderFile {
  id: string;
  lastModified?: string;
  ancestorIds: string[];
}

export interface SupportedFolderContents {
  totalBytes: number;
  files: SupportedFolderFile[];
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
  driveId?: string;
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
    | 'sourceUrlAddedAt'
    | 'sourceUrlTombstones'
    | 'disabledSourceItems'
    | 'resourceTagOverrides'
    | 'resourceHiddenTags'
    | 'theme'
    | 'translatorItalics'
    | 'translatorParagraphMarks'
    | 'userId'
  > & {
    providerFolderSelections?: Partial<Record<FederatedProvider, SyncedCloudFolderSelection[]>>;
    resourceTagColors?: ResourceTagColors;
  };
  // Absent on files written by clients that predate per-field stamps.
  fieldUpdatedAt?: Partial<Record<SyncedConfigField, number>>;
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
      fields: 'files(id,name,mimeType,quotaBytesUsed,size,modifiedTime),nextPageToken',
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
        modifiedTime?: string;
      }>;
      nextPageToken?: string;
    };

    const entries = Array.isArray(payload.files) ? payload.files : [];
    for (const entry of entries) {
      if (typeof entry.id !== 'string' || entry.id.trim().length === 0) {
        continue;
      }

      const isFolder = entry.mimeType === 'application/vnd.google-apps.folder';

      const lastModified = typeof entry.modifiedTime === 'string' && entry.modifiedTime.trim()
        ? entry.modifiedTime.trim()
        : undefined;
      allFolders.push({
        id: entry.id,
        name: typeof entry.name === 'string' && entry.name.trim().length > 0 ? entry.name : 'Untitled',
        kind: isFolder ? 'folder' : 'file',
        sizeBytes: isFolder ? Number(entry.quotaBytesUsed || 0) || 0 : Number(entry.size || 0) || 0,
        // Drive v3 does not return child-count metadata in this listing shape.
        // Assume expandable initially; once loaded, downstream UI collapses empty folders.
        hasChildren: isFolder,
        ...(lastModified ? { lastModified } : {}),
      });
    }

    pageToken = typeof payload.nextPageToken === 'string' && payload.nextPageToken.trim().length > 0
      ? payload.nextPageToken
      : null;
  } while (pageToken);

  return allFolders;
}

type MicrosoftDriveListItem = {
  id?: string;
  name?: string;
  size?: number;
  lastModifiedDateTime?: string;
  folder?: { childCount?: number };
  file?: unknown;
  remoteItem?: {
    id?: string;
    name?: string;
    size?: number;
    lastModifiedDateTime?: string;
    folder?: { childCount?: number };
    file?: unknown;
    parentReference?: {
      driveId?: string;
    };
  };
};

function mapMicrosoftDriveListItem(item: MicrosoftDriveListItem): CloudFolderEntry | null {
  const localFolder = item.folder;
  const remoteFolder = item.remoteItem?.folder;
  const folderFacet = localFolder ?? remoteFolder;
  const fileFacet = item.file ?? item.remoteItem?.file;

  // Shared folder stubs often lack a local `folder` facet and only expose `remoteItem.folder`.
  // Listing `/me/drive/items/{localStubId}/children` then fails with getChildrenOnNonFolder; use the
  // remote drive id + remote item id instead.
  const remoteDriveId = typeof item.remoteItem?.parentReference?.driveId === 'string'
    ? item.remoteItem.parentReference.driveId.trim()
    : '';
  const remoteItemId = typeof item.remoteItem?.id === 'string' ? item.remoteItem.id.trim() : '';
  const isRemoteOnlyFolder = !localFolder && Boolean(remoteFolder) && Boolean(remoteItemId) && Boolean(remoteDriveId);

  const itemId = isRemoteOnlyFolder
    ? remoteItemId
    : (item.id ?? item.remoteItem?.id);
  const itemName = item.name ?? item.remoteItem?.name;
  const itemSize = item.size ?? item.remoteItem?.size;

  if ((!folderFacet && !fileFacet) || typeof itemId !== 'string' || itemId.trim().length === 0) {
    return null;
  }

  const lastModifiedRaw = item.lastModifiedDateTime ?? item.remoteItem?.lastModifiedDateTime;
  const lastModified = typeof lastModifiedRaw === 'string' && lastModifiedRaw.trim()
    ? lastModifiedRaw.trim()
    : undefined;
  const entry: CloudFolderEntry = {
    id: itemId,
    name: typeof itemName === 'string' && itemName.trim().length > 0 ? itemName : 'Untitled',
    kind: folderFacet ? 'folder' : 'file',
    sizeBytes: typeof itemSize === 'number' && Number.isFinite(itemSize) ? itemSize : 0,
    hasChildren: folderFacet ? Number(folderFacet.childCount || 0) > 0 : false,
    ...(lastModified ? { lastModified } : {}),
  };

  if (isRemoteOnlyFolder) {
    entry.driveId = remoteDriveId;
  }

  return entry;
}

async function resolveMicrosoftRemoteFolderListingTarget(
  session: FederatedSession,
  itemId: string
): Promise<{ id: string; driveId: string } | null> {
  const response = await fetch(
    microsoftDriveItemUrl(itemId, 'id,folder,remoteItem'),
    {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
      },
    }
  );

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as MicrosoftDriveListItem;
  if (payload.folder) {
    // Local folder facet is present; /children should have worked. Treat as non-listable.
    return null;
  }

  const remoteId = typeof payload.remoteItem?.id === 'string' ? payload.remoteItem.id.trim() : '';
  const remoteDriveId = typeof payload.remoteItem?.parentReference?.driveId === 'string'
    ? payload.remoteItem.parentReference.driveId.trim()
    : '';

  if (!payload.remoteItem?.folder || !remoteId || !remoteDriveId) {
    return null;
  }

  return { id: remoteId, driveId: remoteDriveId };
}

async function listMicrosoftFolderChildrenFromUrl(
  session: FederatedSession,
  startUrl: string
): Promise<{ entries: CloudFolderEntry[]; status: number; bodyText: string }> {
  const seenById = new Set<string>();
  let nextUrl = startUrl;
  const allFolders: CloudFolderEntry[] = [];

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      return { entries: [], status: response.status, bodyText: text };
    }

    const payload = (await response.json()) as {
      value?: MicrosoftDriveListItem[];
      '@odata.nextLink'?: string;
    };

    const items = Array.isArray(payload.value) ? payload.value : [];
    for (const item of items) {
      const mapped = mapMicrosoftDriveListItem(item);
      if (!mapped || seenById.has(mapped.id)) {
        continue;
      }

      seenById.add(mapped.id);
      allFolders.push(mapped);
    }

    nextUrl = typeof payload['@odata.nextLink'] === 'string' && payload['@odata.nextLink'].trim().length > 0
      ? payload['@odata.nextLink']
      : '';
  }

  return { entries: allFolders, status: 200, bodyText: '' };
}

async function listMicrosoftFolderChildren(
  session: FederatedSession,
  parentId: string,
  driveId?: string
): Promise<CloudFolderEntry[]> {
  const select = 'id,name,folder,file,size,lastModifiedDateTime,remoteItem';
  const initial = await listMicrosoftFolderChildrenFromUrl(
    session,
    microsoftDriveChildrenUrl(parentId, select, driveId)
  );

  if (initial.status === 200) {
    const allFolders = initial.entries;

    if (parentId === 'root' && !driveId && !allFolders.some((entry) => entry.kind === 'folder' && entry.name.trim().toLowerCase() === 'documents')) {
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
          && !allFolders.some((entry) => entry.id === specialDocuments.id)
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

  // Left-panel subfolder peeks and shared-folder stubs can hit this for non-folder / remote items.
  // Prefer resolving via remoteItem; otherwise return [] so UI probing stays quiet.
  if (!driveId && isMicrosoftGetChildrenOnNonFolderError(initial.status, initial.bodyText)) {
    const remoteTarget = await resolveMicrosoftRemoteFolderListingTarget(session, parentId);
    if (remoteTarget) {
      const retry = await listMicrosoftFolderChildrenFromUrl(
        session,
        microsoftDriveChildrenUrl(remoteTarget.id, select, remoteTarget.driveId)
      );
      if (retry.status === 200) {
        return retry.entries;
      }

      throw new Error(`Microsoft folder listing failed (${retry.status}): ${retry.bodyText}`);
    }

    return [];
  }

  throw new Error(`Microsoft folder listing failed (${initial.status}): ${initial.bodyText}`);
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
  parentId: string,
  driveId?: string
): Promise<CloudFolderEntry[]> {
  if (session.provider === 'google') {
    return listGoogleFolderChildren(session, parentId);
  }

  return listMicrosoftFolderChildren(session, parentId, driveId);
}

export async function listSupportedFolderContentsForSession(
  session: FederatedSession,
  folderId: string,
  driveId?: string
): Promise<SupportedFolderContents> {
  const visitedFolderIds = new Set<string>([folderId]);
  let currentLevel: Array<{ id: string; driveId?: string; ancestorIds: string[] }> = [
    { id: folderId, driveId, ancestorIds: [folderId] },
  ];
  let totalBytes = 0;
  const files: SupportedFolderFile[] = [];

  // Fetch each BFS level concurrently instead of one folder at a time so large trees resolve quickly.
  while (currentLevel.length > 0) {
    const levelChildren = await Promise.all(
      currentLevel.map(async (currentFolder) => ({
        currentFolder,
        children: await listFolderChildrenForSession(session, currentFolder.id, currentFolder.driveId),
      }))
    );

    const nextLevel: Array<{ id: string; driveId?: string; ancestorIds: string[] }> = [];
    for (const { currentFolder, children } of levelChildren) {
      for (const child of children) {
        if (child.kind === 'folder') {
          if (!visitedFolderIds.has(child.id)) {
            visitedFolderIds.add(child.id);
            nextLevel.push({
              id: child.id,
              driveId: child.driveId,
              ancestorIds: [...currentFolder.ancestorIds, child.id],
            });
          }

          continue;
        }

        if (isSupportedMarkupFileName(child.name)) {
          totalBytes += child.sizeBytes;
          files.push({
            id: child.id,
            ancestorIds: currentFolder.ancestorIds,
            ...(child.lastModified ? { lastModified: child.lastModified } : {}),
          });
        }
      }
    }

    currentLevel = nextLevel;
  }

  return { totalBytes, files };
}

export async function computeSupportedFolderSizeForSession(
  session: FederatedSession,
  folderId: string,
  driveId?: string
): Promise<number> {
  const { totalBytes } = await listSupportedFolderContentsForSession(session, folderId, driveId);
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
