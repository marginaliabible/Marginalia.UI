import type { FederatedProvider, LinkedCloudAccount, MarginaliaState } from '../models/bible';
import type { FederatedSession } from './federatedAuthService';

const GOOGLE_APPDATA_FILENAME = 'marginalia-config.json';
const MICROSOFT_CONFIG_PATH = 'marginalia-config.json';

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
  >;
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
  const url = `https://www.googleapis.com/drive/v3/files?q=${query}&spaces=appDataFolder&fields=files(id,name)&pageSize=1`;
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

  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
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
  const base = isUpdate
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existingFileId as string)}?uploadType=multipart`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

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
  const url = `https://graph.microsoft.com/v1.0/me/drive/special/approot:/${encodeURIComponent(MICROSOFT_CONFIG_PATH)}:/content`;
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
  const url = `https://graph.microsoft.com/v1.0/me/drive/special/approot:/${encodeURIComponent(MICROSOFT_CONFIG_PATH)}:/content`;
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
