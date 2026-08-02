import type { BibleData } from '../models/bible';

const PRIVATE_SOURCE_VERSION_CACHE_KEY = 'marginalia:github-private-source-versions';
const GITHUB_AUTH_STORAGE_KEY = 'marginalia:github-auth';
const PRIVATE_SOURCE_VERSION_TTL_MS = 1000 * 60 * 60 * 24;

export interface GitHubPrivateSourceConfigFile {
  id?: unknown;
  label?: unknown;
  repositoryType?: unknown;
  owner?: unknown;
  repo?: unknown;
  ref?: unknown;
  path?: unknown;
  requiredPermissions?: unknown;
  authHint?: unknown;
  orgName?: unknown;
  publicUrl?: unknown;
  repoAlias?: unknown;
}

export type GitHubPrivateSourceErrorCode = 'not-authorized' | 'not-found' | 'invalid-payload';

export class GitHubPrivateSourceError extends Error {
  code: GitHubPrivateSourceErrorCode;

  constructor(message: string, code: GitHubPrivateSourceErrorCode) {
    super(message);
    this.name = 'GitHubPrivateSourceError';
    this.code = code;
  }
}

export function isGitHubPrivateSourcePayload(value: unknown): value is GitHubPrivateSourceConfigFile {
  if (!isPlainObject(value)) {
    return false;
  }

  return (
    readString(value['repositoryType']) === 'github-private'
    && readString(value['id']) !== undefined
    && readString(value['owner']) !== undefined
    && readString(value['repo']) !== undefined
    && readString(value['ref']) !== undefined
    && readString(value['path']) !== undefined
  );
}

export function buildGitHubContentsUrl(owner: string, repo: string, ref: string, path: string): string {
  const encodedPath = path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`;
}

export function createGitHubAuthHeaders(): HeadersInit {
  const token = readGitHubAccessToken();
  if (!token) {
    return {};
  }

  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

export function hasValidGitHubAuthSession(): boolean {
  return readGitHubAccessToken() !== null;
}

export function parseGitHubPrivateBibleData(payload: unknown, translationId: string): BibleData {
  if (isPlainObject(payload)) {
    const content = readString(payload['content']);
    const encoding = readString(payload['encoding']);

    if (content && encoding === 'base64') {
      const decoded = decodeBase64Utf8(content);
      const parsed = JSON.parse(decoded) as unknown;
      if (isBibleDataPayload(parsed)) {
        return parsed;
      }

      throw new GitHubPrivateSourceError(
        `Private source payload for ${translationId} did not contain valid Bible JSON.`,
        'invalid-payload'
      );
    }
  }

  if (isBibleDataPayload(payload)) {
    return payload;
  }

  throw new GitHubPrivateSourceError(`Private source payload for ${translationId} is invalid.`, 'invalid-payload');
}

export async function resolveGitHubPrivateSourceVersion(publicUrl?: string, repoAlias?: string): Promise<string | null> {
  const normalizedPublicUrl = readString(publicUrl);
  const normalizedRepoAlias = readString(repoAlias);
  if (!normalizedPublicUrl || !normalizedRepoAlias) {
    return null;
  }

  const cache = readPrivateSourceVersionCache();
  const cacheKey = buildPrivateSourceVersionCacheKey(normalizedPublicUrl, normalizedRepoAlias);
  const cached = cache[cacheKey];
  if (cached && Date.now() - cached.checkedAt < PRIVATE_SOURCE_VERSION_TTL_MS) {
    return cached.version;
  }

  try {
    const response = await fetch(normalizedPublicUrl, { cache: 'no-store' });
    if (!response.ok) {
      return cached?.version ?? null;
    }

    const payload = (await response.json()) as unknown;
    if (!isPlainObject(payload)) {
      return cached?.version ?? null;
    }

    const versionValue = payload[normalizedRepoAlias];
    const version = readString(versionValue);
    if (!version) {
      return cached?.version ?? null;
    }

    cache[cacheKey] = { version, checkedAt: Date.now() };
    writePrivateSourceVersionCache(cache);
    return version;
  } catch {
    return cached?.version ?? null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBibleDataPayload(value: unknown): value is BibleData {
  if (!isPlainObject(value)) {
    return false;
  }

  return typeof value['translation'] === 'string' && Array.isArray(value['books']);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readGitHubAccessToken(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const stored = window.sessionStorage.getItem(GITHUB_AUTH_STORAGE_KEY);
  if (!stored) {
    return null;
  }

  try {
    const parsed = JSON.parse(stored) as { token?: unknown; expiresAt?: unknown };
    const token = readString(parsed.token);
    const expiresAt = typeof parsed.expiresAt === 'number' ? parsed.expiresAt : Number(parsed.expiresAt);

    if (!token || !Number.isFinite(expiresAt)) {
      window.sessionStorage.removeItem(GITHUB_AUTH_STORAGE_KEY);
      return null;
    }

    if (Date.now() >= expiresAt) {
      window.sessionStorage.removeItem(GITHUB_AUTH_STORAGE_KEY);
      return null;
    }

    return token;
  } catch {
    if (stored.trim().length > 0 && !stored.trim().startsWith('{')) {
      return stored.trim();
    }

    window.sessionStorage.removeItem(GITHUB_AUTH_STORAGE_KEY);
    return null;
  }
}

function readPrivateSourceVersionCache(): Record<string, { version: string | null; checkedAt: number }> {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(PRIVATE_SOURCE_VERSION_CACHE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<string, { version?: unknown; checkedAt?: unknown }>;
    const result: Record<string, { version: string | null; checkedAt: number }> = {};

    for (const [key, value] of Object.entries(parsed)) {
      const version = readString(value?.version);
      const checkedAt = typeof value?.checkedAt === 'number' ? value.checkedAt : Number(value?.checkedAt);
      if (!Number.isFinite(checkedAt)) {
        continue;
      }

      result[key] = { version: version ?? null, checkedAt };
    }

    return result;
  } catch {
    return {};
  }
}

function writePrivateSourceVersionCache(cache: Record<string, { version: string | null; checkedAt: number }>): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(PRIVATE_SOURCE_VERSION_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.warn('Unable to persist private source version cache', error);
  }
}

function buildPrivateSourceVersionCacheKey(publicUrl: string, repoAlias: string): string {
  return `${publicUrl.trim()}::${repoAlias.trim()}`;
}

function decodeBase64Utf8(value: string): string {
  if (typeof window === 'undefined') {
    return value;
  }

  const cleaned = value.replace(/\s+/g, '');
  const binary = window.atob(cleaned);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}
