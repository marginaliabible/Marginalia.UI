// Shared helpers for parsing library/resource source files and building document URLs.

import type { FederatedProvider } from '../models/bible';

export const DEFAULT_DOCUMENT_URL_TEMPLATE = '{baseUrl}/documents/{documentId}?page={page}';
export const DEFAULT_DOCUMENT_STORE_ADDRESS = 'documents/{documentId}';

export type SourceFileKind = 'library' | 'resources' | 'translations' | 'documents' | 'translation' | 'hyperlinks';

export type DocumentViewerKind = 'pdf' | 'markup';

export interface LibraryFileLike {
  name?: unknown;
  modifiedOn?: unknown;
  documentStoreAddress?: unknown;
  documentViewer?: unknown;
  source?: unknown;
  sources?: unknown;
}

export interface HyperlinksFileLike {
  modifiedOn?: unknown;
  name?: unknown;
  hyperlinks?: unknown;
}

export interface HyperlinkEntryLike {
  label?: unknown;
  url?: unknown;
}

export interface ResourcesFileLike {
  modifiedOn?: unknown;
  name?: unknown;
  documentStoreAddress?: unknown;
  documentViewer?: unknown;
  documentManifestAddress?: unknown;
  referencesAddress?: unknown;
  shards: unknown[];
}

export interface DocumentsFileLike {
  documents: unknown[];
}

// Canonical shape for a single documents.json entry, shared across parsing, caching, and URL building.
export interface ResourceDocumentEntry {
  documentId: string;
  title: string;
  tags: string[];
  hash?: string;
}

export interface ResourceDocumentEntryLike {
  documentId?: unknown;
  title?: unknown;
  tags?: unknown;
  hash?: unknown;
}

export function readResourceDocumentEntry(item: unknown): ResourceDocumentEntry | null {
  if (!isPlainObject(item)) {
    return null;
  }

  const entry = item as ResourceDocumentEntryLike;
  const documentId = readString(entry.documentId);
  if (!documentId) {
    return null;
  }

  const tags = Array.isArray(entry.tags)
    ? entry.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
    : [];

  return {
    documentId,
    title: readString(entry.title) ?? documentId,
    tags: Array.from(new Set(tags)),
    hash: readString(entry.hash),
  };
}

/** Index by cloud documentId and content hash so Research shard occurrences resolve. */
export function indexResourceDocuments(documents: ResourceDocumentEntry[]): Map<string, ResourceDocumentEntry> {
  const map = new Map<string, ResourceDocumentEntry>();

  for (const entry of documents) {
    map.set(entry.documentId, entry);
    if (entry.hash && entry.hash !== entry.documentId) {
      map.set(entry.hash, entry);
    }
  }

  return map;
}

export interface TranslationsFileLike {
  modifiedOn?: unknown;
  name?: unknown;
  translations?: unknown;
  extraLanguages?: unknown;
}

export interface ExtraLanguage {
  code: string;
  label: string;
}

export interface ResourceSourceConfigLike {
  baseUrl?: unknown;
  documentUrlTemplate?: unknown;
}

export interface ResourceLibraryConfigLike {
  source?: unknown;
  baseUrl?: unknown;
  documentUrlTemplate?: unknown;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => readString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

export function readLibrarySourceAddresses(library: LibraryFileLike): string[] {
  const source = readString(library.source);
  const sources = readStringArray(library.sources);

  if (source && sources.length > 0) {
    throw new Error('library.json may define source or sources, but not both.');
  }

  if (source) {
    return [source];
  }

  return sources;
}

export function inferSourceFileKindFromUrl(urlText: string): SourceFileKind | null {
  const filename = getFilename(urlText).toLowerCase();
  if (filename === 'library.json') {
    return 'library';
  }
  if (filename === 'resources.json') {
    return 'resources';
  }
  if (filename === 'translations.json') {
    return 'translations';
  }
  if (filename === 'documents.json') {
    return 'documents';
  }
  if (filename === 'hyperlinks.json') {
    return 'hyperlinks';
  }

  return null;
}

export function inferSourceFileKindFromPayload(payload: unknown): SourceFileKind | null {
  if (!isPlainObject(payload)) {
    return null;
  }

  if (Array.isArray(payload['shards'])) {
    return 'resources';
  }
  if (Array.isArray(payload['translations'])) {
    return 'translations';
  }
  if (Array.isArray(payload['documents'])) {
    return 'documents';
  }
  if (Array.isArray(payload['hyperlinks'])) {
    return 'hyperlinks';
  }
  if (readString(payload['name']) && readString(payload['modifiedOn'])) {
    return 'library';
  }

  return null;
}

export function resolveAddress(address: string, baseUrl: string): string {
  const raw = address.trim();
  const normalizedGitHub = normalizeGitHubUiUrlToRaw(raw);
  if (normalizedGitHub) {
    return normalizedGitHub;
  }

  if (isAbsoluteUrl(raw)) {
    return raw;
  }

  const resolved = resolveRelativeAddress(raw, baseUrl);
  return normalizeGitHubUiUrlToRaw(resolved) ?? resolved;
}

export function buildFetchUrlCandidates(address: string, baseUrl?: string): string[] {
  const resolved = baseUrl ? resolveAddress(address, baseUrl) : (normalizeGitHubUiUrlToRaw(address) ?? address.trim());
  // Relative app paths (e.g. /help-content/manifest.json) should stay local — do not CDN-rewrite.
  if (resolved.startsWith('/') && !resolved.startsWith('//')) {
    return [resolved];
  }
  const gitHubRaw = parseGitHubRawUrl(resolved);
  if (!gitHubRaw) {
    return [resolved];
  }

  const { owner, repo, ref, path } = gitHubRaw;
  const cdnPath = `${owner}/${repo}@${ref}/${path}`;
  return [
    `https://cdn.jsdelivr.net/gh/${cdnPath}`,
    `https://fastly.jsdelivr.net/gh/${cdnPath}`,
    `https://cdn.statically.io/gh/${owner}/${repo}/${ref}/${path}`,
    `https://rawcdn.githack.com/${owner}/${repo}/${ref}/${path}`,
    resolved,
  ];
}

export function validateLibraryFile(payload: unknown, sourceUrl: string): LibraryFileLike {
  if (!isPlainObject(payload)) {
    throw new Error(`library.json payload is invalid at ${sourceUrl}`);
  }

  if (!readString(payload['name'])) {
    throw new Error(`library.json missing required name at ${sourceUrl}`);
  }
  if (!readString(payload['modifiedOn'])) {
    throw new Error(`library.json missing required modifiedOn at ${sourceUrl}`);
  }

  readLibrarySourceAddresses(payload);
  return payload;
}

export function validateResourcesFile(payload: unknown, sourceUrl: string): ResourcesFileLike {
  if (!isPlainObject(payload)) {
    throw new Error(`resources.json payload is invalid at ${sourceUrl}`);
  }

  if (!readString(payload['modifiedOn'])) {
    throw new Error(`resources.json missing required modifiedOn at ${sourceUrl}`);
  }

  const shards = payload['shards'];
  if (!Array.isArray(shards)) {
    throw new Error(`resources.json missing required shards at ${sourceUrl}`);
  }

  return {
    modifiedOn: payload['modifiedOn'],
    name: payload['name'],
    documentStoreAddress: payload['documentStoreAddress'],
    documentViewer: payload['documentViewer'],
    documentManifestAddress: payload['documentManifestAddress'],
    referencesAddress: payload['referencesAddress'],
    shards,
  };
}

export function validateTranslationsFile(payload: unknown, sourceUrl: string): TranslationsFileLike {
  if (!isPlainObject(payload)) {
    throw new Error(`translations.json payload is invalid at ${sourceUrl}`);
  }

  if (!readString(payload['modifiedOn'])) {
    throw new Error(`translations.json missing required modifiedOn at ${sourceUrl}`);
  }
  if (!Array.isArray(payload['translations'])) {
    throw new Error(`translations.json missing required translations at ${sourceUrl}`);
  }

  return payload;
}

export function validateDocumentsFile(payload: unknown, sourceUrl: string): DocumentsFileLike {
  if (!isPlainObject(payload)) {
    throw new Error(`documents.json payload is invalid at ${sourceUrl}`);
  }

  const documents = payload['documents'];
  if (!Array.isArray(documents)) {
    throw new Error(`documents.json missing required documents at ${sourceUrl}`);
  }

  return { documents };
}

export function validateHyperlinksFile(payload: unknown, sourceUrl: string): HyperlinksFileLike {
  if (!isPlainObject(payload)) {
    throw new Error(`hyperlinks.json payload is invalid at ${sourceUrl}`);
  }

  const hyperlinks = payload['hyperlinks'];
  if (!Array.isArray(hyperlinks)) {
    throw new Error(`hyperlinks.json missing required hyperlinks at ${sourceUrl}`);
  }

  hyperlinks.forEach((item, index) => {
    const entry = isPlainObject(item) ? (item as HyperlinkEntryLike) : null;
    if (!entry || !readString(entry.label) || !readString(entry.url)) {
      throw new Error(`hyperlinks.json entry ${index + 1} is missing a required label or url at ${sourceUrl}`);
    }
  });

  return payload;
}

export function readExtraLanguages(value: unknown): ExtraLanguage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const languages: ExtraLanguage[] = [];
  for (const item of value) {
    if (!isPlainObject(item)) {
      continue;
    }

    const code = readString(item['code']);
    const label = readString(item['label']);
    if (!code || !label) {
      continue;
    }

    languages.push({ code, label });
  }

  return languages;
}

export function normalizeBaseUrl(value: string | undefined, fallbackFromConfigUrl: string): string {
  const fromValue = readString(value);
  if (fromValue) {
    try {
      return new URL(fromValue).toString().replace(/\/$/, '');
    } catch {
      try {
        return new URL(fromValue, fallbackFromConfigUrl).toString().replace(/\/$/, '');
      } catch {
        // Fall back below.
      }
    }
  }

  return fallbackFromConfigUrl.replace(/\/$/, '');
}

// Resolves { baseUrl, documentUrlTemplate } from a config payload, preferring config.source over top-level fields.
export function readResourceLibraryConnection(
  config: ResourceLibraryConfigLike,
  configUrl: string
): { baseUrl: string; documentUrlTemplate: string } {
  const sourceConfig = isPlainObject(config.source) ? config.source as ResourceSourceConfigLike : undefined;
  const configFolderUrl = new URL('.', configUrl).toString();
  const baseUrl = normalizeBaseUrl(readString(sourceConfig?.baseUrl) ?? readString(config.baseUrl), configFolderUrl);
  const documentUrlTemplate =
    readString(sourceConfig?.documentUrlTemplate)
    ?? readString(config.documentUrlTemplate)
    ?? DEFAULT_DOCUMENT_URL_TEMPLATE;

  return { baseUrl, documentUrlTemplate };
}

// Substitutes {name}, {{name}}, and array-slice tokens like {name[0..1]} (inclusive substring) in a template.
export function applyUrlTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{?(\w+)(?:\[(\d+)\.\.(\d+)\])?\}\}?/g, (match, key: string, start?: string, end?: string) => {
    const value = values[key];
    if (value === undefined) {
      return match;
    }

    return start !== undefined && end !== undefined ? value.slice(Number(start), Number(end) + 1) : value;
  });
}

export function buildDocumentPageUrl(template: string, baseUrl: string, document: Pick<ResourceDocumentEntry, 'documentId' | 'hash'>, page: number): string {
  const output = applyUrlTemplate(template, {
    baseUrl,
    documentId: document.documentId,
    page: String(page),
    pageNumber: String(page),
    ...(document.hash ? { hash: document.hash } : {}),
  });

  try {
    return new URL(output, `${baseUrl}/`).toString();
  } catch {
    return output;
  }
}

export function buildDocumentStorePageUrl(address: string, sourceUrl: string, document: Pick<ResourceDocumentEntry, 'documentId' | 'hash'>, page: number): string {
  const output = applyUrlTemplate(address || DEFAULT_DOCUMENT_STORE_ADDRESS, {
    documentId: document.documentId,
    page: String(page),
    pageNumber: String(page),
    ...(document.hash ? { hash: document.hash } : {}),
  });

  return resolveAddress(output, sourceUrl);
}

/** Resolve the Markup pages shell URL (…/pages/ → …/pages/index.html). */
export function buildMarkupDocumentShellUrl(pagesStoreUrl: string): string {
  const trimmed = pagesStoreUrl.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (/\/index\.html(?:[?#]|$)/i.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.endsWith('/')) {
    return `${trimmed}index.html`;
  }
  if (/\/pages$/i.test(trimmed)) {
    return `${trimmed}/index.html`;
  }
  return trimmed;
}

const CLOUD_SYNC_PROVIDER_BY_FOLDER: Record<string, FederatedProvider> = {
  googledrive: 'google',
  onedrive: 'microsoft',
};

/**
 * Cloud Service Sync publishes one resources.json per provider at
 * `users/{userId}/{GoogleDrive|OneDrive}/resources.json`; any other layout is not a synced library.
 */
export function readCloudSyncProviderFromResourcesUrl(resourcesUrl: string): FederatedProvider | null {
  let pathname: string;
  try {
    pathname = new URL(resourcesUrl).pathname;
  } catch {
    pathname = resourcesUrl.split(/[?#]/)[0] ?? '';
  }

  const segments = pathname.split('/').filter(Boolean);
  if (segments.length < 4) {
    return null;
  }

  const [usersSegment, , providerFolder, fileName] = segments.slice(-4);
  if (usersSegment !== 'users' || fileName.toLowerCase() !== 'resources.json') {
    return null;
  }

  return CLOUD_SYNC_PROVIDER_BY_FOLDER[providerFolder.toLowerCase()] ?? null;
}

export function readDocumentViewerKind(value: unknown): DocumentViewerKind | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'markup') {
    return 'markup';
  }
  if (normalized === 'pdf') {
    return 'pdf';
  }
  return null;
}

function isAbsoluteUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function getFilename(urlText: string): string {
  try {
    const parsed = new URL(urlText);
    return parsed.pathname.split('/').filter(Boolean).pop() ?? '';
  } catch {
    return urlText.split(/[\\/]/).filter(Boolean).pop() ?? '';
  }
}

function resolveRelativeAddress(address: string, baseUrl: string): string {
  if (isAbsoluteUrl(baseUrl)) {
    return new URL(address, baseUrl).toString();
  }

  if (baseUrl.startsWith('/')) {
    return new URL(address, `https://marginalia.local${baseUrl}`).pathname.replace(/^\//, '');
  }

  const baseParts = baseUrl.split('/').filter((part) => part.length > 0);
  if (baseParts.length > 0 && /\.[^/.]+$/.test(baseParts[baseParts.length - 1])) {
    baseParts.pop();
  }

  for (const part of address.split('/')) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      baseParts.pop();
      continue;
    }
    baseParts.push(part);
  }

  return baseParts.join('/');
}

function normalizeGitHubUiUrlToRaw(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.hostname.toLowerCase() !== 'github.com') {
      return null;
    }

    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 5) {
      return null;
    }

    const [owner, repo, marker, ref, ...pathParts] = parts;
    if (marker !== 'blob' || !owner || !repo || !ref || pathParts.length === 0) {
      return null;
    }

    const encodedPath = pathParts.map((part) => encodeURIComponent(decodeURIComponent(part))).join('/');
    return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${encodedPath}`;
  } catch {
    return null;
  }
}

function parseGitHubRawUrl(value: string): { owner: string; repo: string; ref: string; path: string } | null {
  try {
    const parsed = new URL(value);
    if (parsed.hostname.toLowerCase() !== 'raw.githubusercontent.com') {
      return null;
    }

    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 4) {
      return null;
    }

    const [owner, repo, ref, ...pathParts] = parts;
    if (!owner || !repo || !ref || pathParts.length === 0) {
      return null;
    }

    return {
      owner: decodeURIComponent(owner),
      repo: decodeURIComponent(repo),
      ref: decodeURIComponent(ref),
      path: pathParts.map((part) => decodeURIComponent(part)).join('/'),
    };
  } catch {
    return null;
  }
}
