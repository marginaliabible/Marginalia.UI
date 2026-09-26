import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  BibleChapter,
  BibleBook,
  BibleData,
  ArtifactType,
  ExtraLanguageMeta,
  FederatedProvider,
  RepositoryType,
  BibleTranslationMeta,
  MarginaliaState,
  SearchResultSet
} from '../models/bible';
import { SearchMatch } from '../models/bible';
import { BOOK_ALIAS_CONFIG, normalizeBookName } from '../utils/book-aliases';
import {
  buildGitHubContentsUrl,
  createGitHubAuthHeaders,
  GitHubPrivateSourceError,
  hasValidGitHubAuthSession,
  type GitHubPrivateSourceConfigFile,
  isGitHubPrivateSourcePayload,
  parseGitHubPrivateBibleData,
  resolveGitHubPrivateSourceVersion,
} from './githubPrivateSourceService';
import { ResourceLibraryService } from './resourceLibraryService';
import { fetchStorageAware } from './storageAuthenticatedFetch';
import {
  buildFetchUrlCandidates,
  inferSourceFileKindFromPayload,
  inferSourceFileKindFromUrl,
  readExtraLanguages,
  readLibrarySourceAddresses,
  resolveAddress,
  validateLibraryFile,
  validateResourcesFile,
  validateTranslationsFile,
  validateHyperlinksFile,
  type LibraryFileLike,
  type ResourcesFileLike,
  type SourceFileKind,
  type TranslationsFileLike,
} from '../utils/resourceLibraryConfig';

interface BibleDB extends DBSchema {
  translations: {
    key: string;
    value: StoredBible;
  };
  settingsSnapshots: {
    key: string;
    value: StoredSettingsSnapshot;
  };
  resourceShards: {
    key: string;
    value: StoredResourceShard;
  };
  resourceLibraries: {
    key: string;
    value: StoredResourceLibrary;
  };
  hyperlinkSets: {
    key: string;
    value: StoredHyperlinkSet;
  };
}

interface StoredHyperlinkSet {
  sourceUrl: string;
  entries: Array<{ label: string; url: string }>;
  modifiedOn?: string;
  fetchedAt: number;
}

interface StoredBible {
  id: string;
  data: BibleData;
  source: string;
  fetchedAt: number;
  sourceVersion?: string | null;
}

interface StoredSettingsSnapshot {
  key: string;
  sourceUrls: string[];
  artifacts: BibleTranslationMeta[];
  translationLibraryUrls: string[];
  extraLanguages: ExtraLanguageMeta[];
  settingsUrl?: string;
  kind?: SourceFileKind;
  rawEntries?: TranslationSettingsEntry[];
  modifiedOn?: string;
  fetchedAt: number;
}

interface StoredResourceShard {
  key: string;
  libraryId: string;
  shardFile: string;
  configUrl: string;
  entries: ResourceVerseEntry[];
  fetchedAt: number;
}

interface StoredResourceLibrary {
  key: string;
  id: string;
  label: string;
  configUrl: string;
  baseUrl: string;
  documentUrlTemplate: string;
  documents: Array<{ documentId: string; title: string; tags: string[] }>;
  manifest: ExportManifestShard[];
  fetchedAt: number;
}

interface CachedTranslationMeta {
  items: BibleTranslationMeta[];
  extraLanguages?: ExtraLanguageMeta[];
  cachedAt: number;
}

interface TranslationSettingsEntry {
  id?: string;
  label?: string;
  address?: string;
  repositoryType?: RepositoryType | string;
  artifactType?: ArtifactType | string;
  language?: string | string[];
  owner?: string;
  repo?: string;
  ref?: string;
  path?: string;
  requiredPermissions?: string[];
  authHint?: string;
  orgName?: string;
  publicUrl?: string;
  repoAlias?: string;
  documentStoreAddress?: string;
  documentViewer?: string;
  documentManifestAddress?: string;
  referencesAddress?: string;
  modifiedOn?: string;
}

interface SettingsEntryWithSource {
  entry: TranslationSettingsEntry;
  settingsUrl: string;
}

interface ParsedSourcePayloadResult {
  settingsUrl: string;
  kind: SourceFileKind;
  entries: TranslationSettingsEntry[];
  extraLanguages: ExtraLanguageMeta[];
}

interface FetchSettingsResult {
  artifacts: BibleTranslationMeta[];
  translationLibraryUrls: string[];
  extraLanguages: ExtraLanguageMeta[];
}

export type SourceProbeResult =
  | {
      ok: true;
      kind: SourceFileKind;
      translationCount: number;
      message: string;
    }
  | {
      ok: false;
      code: 'not-authorized' | 'not-found' | 'rate-limited' | 'source-unavailable' | 'invalid-payload' | 'network-or-cors';
      message: string;
    };

const LOCAL_TRANSLATION_ID = 'KJV';
const BIBLE_DATA_PATH = 'data/bibles';
const SETTINGS_PATH = 'data/library.json';
const LOCAL_TRANSLATION_SOURCE = `${BIBLE_DATA_PATH}/${LOCAL_TRANSLATION_ID}.json`;
const META_CACHE_KEY = 'marginalia:translation-meta';
const STATE_CACHE_KEY = 'marginalia:state';
const REMOTE_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const SEARCH_LIMIT = 5000;
const META_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const DEFAULT_FULL_TRANSLATIONS_IN_MEMORY = 2;
const MAX_CHAPTERS_IN_MEMORY = 8;
const MAX_VERSES_IN_MEMORY = 128;
const DEFAULT_LOCAL_TRANSLATION: BibleTranslationMeta = {
  id: LOCAL_TRANSLATION_ID,
  label: 'King James Version (1769)',
  source: LOCAL_TRANSLATION_SOURCE,
  isLocal: true,
  repositoryType: 'local',
  artifactType: 'translation',
  language: 'en'
};

const BOOK_CANONICAL_BY_ALIAS = buildBookCanonicalAliasMap();

export interface SourceArtifactSummary {
  translation: number;
  translationLibrary: number;
  resourceLibrary: number;
}

export interface SourceLibraryRecord {
  id: string;
  label: string;
  source: string;
  configuredSourceUrl?: string;
  repositoryType: RepositoryType;
  artifactType: 'translation-library' | 'resource-library';
}

export interface SourceArtifactStatus {
  summary: SourceArtifactSummary;
  libraries: SourceLibraryRecord[];
}

export interface SourceRepositorySummary {
  hosted: number;
  local: number;
  githubPublic: number;
  githubPrivate: number;
}

export interface SourceArtifactInventoryItem {
  id: string;
  label: string;
  source: string;
  configuredSourceUrl?: string;
  repositoryType: RepositoryType;
  artifactType: ArtifactType;
}

export interface SourceArtifactInventory {
  summary: SourceArtifactSummary;
  repositorySummary: SourceRepositorySummary;
  items: SourceArtifactInventoryItem[];
}

export interface VerseResourceDocumentLink {
  page: number;
  url: string;
  raw?: string;
  viewer?: 'pdf' | 'markup';
}

export interface VerseResourceDocument {
  libraryId: string;
  libraryLabel: string;
  documentId: string;
  cloudProvider?: FederatedProvider | null;
  title: string;
  tags: string[];
  pages: number[];
  pageLinks: VerseResourceDocumentLink[];
}

export interface VerseResourcesPayload {
  reference: {
    book: string;
    chapter: number;
    verse: number;
  };
  tags: string[];
  documents: VerseResourceDocument[];
}

interface ExportManifestShard {
  file: string;
  scope: 'book' | 'chapter' | 'verse';
  refPrefix: string;
}

interface ResourceVerseEntry {
  ref?: unknown;
  raw?: unknown;
  occurrences?: unknown;
}

export function normalizeSourceUrlInput(value: string): string {
  const trimmed = value.trim();
  const blobInfo = parseGitHubBlobUrl(trimmed);
  if (!blobInfo) {
    return trimmed;
  }

  const encodedPath = blobInfo.path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  return `https://raw.githubusercontent.com/${blobInfo.owner}/${blobInfo.repo}/${blobInfo.ref}/${encodedPath}`;
}

function parseGitHubBlobUrl(value: string): {
  owner: string;
  repo: string;
  ref: string;
  path: string;
} | null {
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

    return {
      owner,
      repo,
      ref,
      path: pathParts.join('/'),
    };
  } catch {
    return null;
  }
}

function parseGitHubRawUrl(value: string): {
  owner: string;
  repo: string;
  ref: string;
  path: string;
} | null {
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
      path: pathParts.map((segment: string) => decodeURIComponent(segment)).join('/'),
    };
  } catch {
    return null;
  }
}

function decodeGitHubContentsPayload(payload: unknown): unknown | null {
  if (!isPlainObject(payload)) {
    return null;
  }

  const content = readString(payload['content']);
  const encoding = readString(payload['encoding']);
  if (!content || encoding !== 'base64') {
    return null;
  }

  try {
    const cleaned = content.replace(/\s+/g, '');
    const binary = window.atob(cleaned);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const decoded = new TextDecoder('utf-8').decode(bytes);
    return JSON.parse(decoded) as unknown;
  } catch {
    return null;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function extractFilenameStem(urlText: string): string {
  try {
    const parsed = new URL(urlText);
    const path = parsed.pathname;
    const filename = path.split('/').filter(Boolean).pop() ?? '';
    return filename.replace(/\.[^.]+$/, '');
  } catch {
    return '';
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function prettifyLibraryLabel(urlText: string): string {
  const stem = extractFilenameStem(urlText).trim();
  if (stem) {
    return stem
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  try {
    const parsed = new URL(urlText);
    return parsed.hostname;
  } catch {
    return 'Translation Library';
  }
}

class BibleService {
  private dbPromise: Promise<IDBPDatabase<BibleDB>> | null = null;
  private readonly translationCache = new Map<string, BibleData>();
  private readonly chapterCache = new Map<string, BibleChapter>();
  private readonly verseCache = new Map<string, string>();
  private readonly resourceLibraryService: ResourceLibraryService;
  private fullTranslationCacheLimit = DEFAULT_FULL_TRANSLATIONS_IN_MEMORY;
  private extraLanguages: ExtraLanguageMeta[] = [];
  private translationMetaById = new Map<string, BibleTranslationMeta>([
    [LOCAL_TRANSLATION_ID, DEFAULT_LOCAL_TRANSLATION]
  ]);

  // Cache diagnostics (dev-only counters)
  private cacheStats = {
    chapterHits: 0,
    chapterMisses: 0,
    verseHits: 0,
    verseMisses: 0,
    translationHits: 0,
    translationMisses: 0,
    chapterEvictions: 0,
    verseEvictions: 0
  };

  constructor() {
    this.resourceLibraryService = new ResourceLibraryService({
      fetchSettings: this.fetchSettings.bind(this),
      getDatabase: this.getDatabase.bind(this),
    });

    // Expose stats on window for dev inspection
    if (typeof window !== 'undefined') {
      (window as any).__MARGINALIA_CACHE_STATS__ = () => ({
        ...this.cacheStats,
        chapterCacheSize: this.chapterCache.size,
        verseCacheSize: this.verseCache.size,
        translationCacheSize: this.translationCache.size
      });
    }
  }

  async refreshAvailableTranslations(forceRefresh = false, sourceUrls: string[] = []): Promise<BibleTranslationMeta[]> {
    const cachedMeta = this.readCachedTranslationMeta();
    let result: BibleTranslationMeta[] = [DEFAULT_LOCAL_TRANSLATION];

    if (cachedMeta && !forceRefresh) {
      result = this.mergeTranslations(result, cachedMeta.items);
      this.extraLanguages = cachedMeta.extraLanguages ?? [];
    }

    try {
      const fetched = await this.fetchSettings(sourceUrls, { forceRefresh });
      const translations = fetched.artifacts.filter((entry) => entry.artifactType === 'translation');
      result = this.mergeTranslations(result, translations);
      this.extraLanguages = fetched.extraLanguages;
      this.writeCachedTranslationMeta(translations, fetched.extraLanguages);
    } catch (error) {
      console.error('Failed to refresh translations:', error);
    }

    this.cacheTranslationMeta(result);
    return result;
  }

  getExtraLanguages(): ExtraLanguageMeta[] {
    return [...this.extraLanguages];
  }

  async getSourceArtifactSummary(sourceUrls: string[] = []): Promise<SourceArtifactSummary> {
    return this.resourceLibraryService.getSourceArtifactSummary(sourceUrls);
  }

  // Shared connection so sibling services do not race the version upgrade.
  async openDatabase(): Promise<IDBPDatabase<any>> {
    return this.getDatabase();
  }

  async getSourceArtifactStatus(sourceUrls: string[] = []): Promise<SourceArtifactStatus> {
    return this.resourceLibraryService.getSourceArtifactStatus(sourceUrls);
  }

  async getSourceArtifactInventory(sourceUrls: string[] = []): Promise<SourceArtifactInventory> {
    return this.resourceLibraryService.getSourceArtifactInventory(sourceUrls);
  }

  async hasResourcesForVerse(
    book: string,
    chapter: number,
    verse: number,
    sourceUrls: string[] = []
  ): Promise<boolean> {
    return this.resourceLibraryService.hasResourcesForVerse(book, chapter, verse, sourceUrls);
  }

  async getResourcesForVerse(
    book: string,
    chapter: number,
    verse: number,
    sourceUrls: string[] = []
  ): Promise<VerseResourcesPayload> {
    return this.resourceLibraryService.getResourcesForVerse(book, chapter, verse, sourceUrls);
  }

  async probeSourceUrl(sourceUrl: string): Promise<SourceProbeResult> {
    try {
      const normalizedSourceUrl = normalizeSourceUrlInput(sourceUrl);

      const payloadResult = await this.fetchSourcePayload(normalizedSourceUrl);
      if (!payloadResult.ok) {
        if (payloadResult.status === 401 || payloadResult.status === 403) {
          return {
            ok: false,
            code: 'not-authorized',
            message: `Not authorized (${payloadResult.status}). Connect GitHub and retry for private sources.`,
          };
        }

        if (payloadResult.status === 404) {
          const isGitHubRaw = parseGitHubRawUrl(normalizedSourceUrl) !== null;
          if (isGitHubRaw && !hasValidGitHubAuthSession()) {
            return {
              ok: false,
              code: 'not-authorized',
              message: 'GitHub authorization required for this source. Authenticate with GitHub and retry.',
            };
          }

          return {
            ok: false,
            code: 'not-found',
            message: 'Source not found (404). Verify the URL path and file name.',
          };
        }

        if (payloadResult.status === 429) {
          return {
            ok: false,
            code: 'rate-limited',
            message: 'Rate limited (429). Wait briefly and retry.',
          };
        }

        return {
          ok: false,
          code: 'source-unavailable',
          message: `Source unavailable (${payloadResult.status}). Check host availability and retry.`,
        };
      }

      const parsed = await this.parseSourcePayload(normalizedSourceUrl, payloadResult.payload);

      if (parsed.kind === 'hyperlinks') {
        const hyperlinks = (payloadResult.payload as { hyperlinks?: unknown[] }).hyperlinks ?? [];
        return {
          ok: true,
          kind: parsed.kind,
          translationCount: 0,
          message: `Hyperlinks source accepted (${hyperlinks.length} link template${hyperlinks.length === 1 ? '' : 's'})`,
        };
      }

      if (parsed.kind === 'library' || parsed.kind === 'translations') {
        return {
          ok: true,
          kind: parsed.kind,
          translationCount: parsed.entries.length,
          message: `${parsed.kind === 'library' ? 'Library' : 'Translations'} source accepted (${parsed.entries.length} entr${parsed.entries.length === 1 ? 'y' : 'ies'})`,
        };
      }

      const firstArtifactType = parsed.entries[0]?.artifactType;
      if (firstArtifactType === 'resource-library') {
        return {
          ok: true,
          kind: parsed.kind,
          translationCount: parsed.entries.length,
          message: `Resource library source accepted (${parsed.entries[0]?.label ?? '1 library'})`,
        };
      }

      return {
        ok: true,
        kind: parsed.kind,
        translationCount: 1,
        message: `Translation source accepted (${parsed.entries[0]?.label ?? '1 translation'})`,
      };
    } catch (error) {
      if (error instanceof Error && /not a supported source payload/i.test(error.message)) {
        return {
          ok: false,
          code: 'invalid-payload',
          message: 'Invalid payload format. Use library.json, translations.json, resources.json, hyperlinks.json, or a direct translation JSON.',
        };
      }

      return {
        ok: false,
        code: 'network-or-cors',
        message: 'Source could not be reached (network/CORS). Verify connectivity and CORS policy.',
      };
    }
  }

  setFullTranslationCacheLimit(limit: number): void {
    this.fullTranslationCacheLimit = Math.max(1, Math.floor(limit) || 1);
    this.pruneFullTranslationCache();
  }

  async purgeTranslations(translationIds: string[]): Promise<void> {
    const ids = Array.from(new Set(
      translationIds
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .filter((entry) => entry !== LOCAL_TRANSLATION_ID)
    ));

    if (ids.length === 0) {
      return;
    }

    for (const id of ids) {
      this.translationCache.delete(id);
      this.pruneDerivedCachesForTranslation(id);
      this.translationMetaById.delete(id);
    }

    const db = await this.getDatabase();
    const tx = db.transaction('translations', 'readwrite');
    for (const id of ids) {
      await tx.store.delete(id);
    }
    await tx.done;

    this.purgeCachedTranslationMeta(ids);
  }

  private purgeCachedTranslationMeta(translationIds: string[]): void {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const raw = window.localStorage.getItem(META_CACHE_KEY);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as CachedTranslationMeta;
      if (!parsed || !Array.isArray(parsed.items)) {
        return;
      }

      const blocked = new Set(translationIds);
      const nextItems = parsed.items.filter((entry) => !blocked.has(entry.id));

      if (nextItems.length === parsed.items.length) {
        return;
      }

      const nextPayload: CachedTranslationMeta = {
        ...parsed,
        items: nextItems,
      };

      window.localStorage.setItem(META_CACHE_KEY, JSON.stringify(nextPayload));
    } catch (error) {
      console.warn('Unable to purge cached translation metadata', error);
    }
  }

  private cacheTranslationMeta(entries: BibleTranslationMeta[]): void {
    const map = new Map<string, BibleTranslationMeta>([
      [LOCAL_TRANSLATION_ID, DEFAULT_LOCAL_TRANSLATION]
    ]);

    for (const entry of entries) {
      map.set(entry.id, entry);
    }

    this.translationMetaById = map;
  }

  private async fetchSettings(
    sourceUrls: string[] = [],
    options?: { forceRefresh?: boolean }
  ): Promise<FetchSettingsResult> {
    const normalizedSourceUrls = Array.from(new Set(
      sourceUrls
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    )).sort();

    const snapshotKey = buildSettingsSnapshotDbKey(normalizedSourceUrls);
    const settingsUrls = this.buildSettingsUrlCandidates(normalizedSourceUrls);
    const settled = await Promise.allSettled(settingsUrls.map((url) => this.fetchSettingsAtUrl(url, options)));
    const allEntries: SettingsEntryWithSource[] = [];
    const translationLibraryUrls = new Set<string>();
    const extraLanguages = new Map<string, ExtraLanguageMeta>();

    for (const result of settled) {
      if (result.status !== 'fulfilled') {
        console.warn('Failed to load source settings:', result.reason);
        continue;
      }

      if (result.value.kind === 'library' || result.value.kind === 'translations') {
        translationLibraryUrls.add(result.value.settingsUrl);
      }

      for (const language of result.value.extraLanguages) {
        extraLanguages.set(language.code, language);
      }

      allEntries.push(
        ...result.value.entries.map((entry) => ({
          entry,
          settingsUrl: result.value.settingsUrl,
        }))
      );
    }

    const next: FetchSettingsResult = {
      artifacts: this.normalizeTranslationEntries(allEntries),
      translationLibraryUrls: Array.from(translationLibraryUrls),
      extraLanguages: Array.from(extraLanguages.values()).sort((a, b) => a.code.localeCompare(b.code)),
    };

    if (allEntries.length === 0) {
      const cached = await this.readSettingsSnapshotFromDatabase(snapshotKey);
      if (cached) {
        return {
          artifacts: cached.artifacts,
          translationLibraryUrls: cached.translationLibraryUrls,
          extraLanguages: cached.extraLanguages ?? [],
        };
      }
    }

    await this.writeSettingsSnapshotToDatabase({
      key: snapshotKey,
      sourceUrls: normalizedSourceUrls,
      artifacts: next.artifacts,
      translationLibraryUrls: next.translationLibraryUrls,
      extraLanguages: next.extraLanguages,
      fetchedAt: Date.now(),
    });

    return next;
  }

  private async readSettingsSnapshotFromDatabase(key: string): Promise<StoredSettingsSnapshot | null> {
    const db = await this.getDatabase();
    const stored = await db.get('settingsSnapshots', key);
    return stored ?? null;
  }

  private async writeSettingsSnapshotToDatabase(stored: StoredSettingsSnapshot): Promise<void> {
    const db = await this.getDatabase();
    await db.put('settingsSnapshots', stored, stored.key);
  }

  private async readParsedSourceSnapshot(
    sourceUrl: string,
    modifiedOn: string
  ): Promise<{ kind: SourceFileKind; entries: TranslationSettingsEntry[]; extraLanguages: ExtraLanguageMeta[] } | null> {
    const cached = await this.readSettingsSnapshotFromDatabase(buildSettingsSourceSnapshotDbKey(sourceUrl));
    if (!cached?.kind || !cached.rawEntries || !isStoredModifiedOnCurrent(cached.modifiedOn, modifiedOn)) {
      return null;
    }

    return {
      kind: cached.kind,
      entries: cached.rawEntries,
      extraLanguages: cached.extraLanguages ?? [],
    };
  }

  private async writeParsedSourceSnapshot(
    sourceUrl: string,
    modifiedOn: string,
    parsed: { kind: SourceFileKind; entries: TranslationSettingsEntry[]; extraLanguages: ExtraLanguageMeta[] }
  ): Promise<void> {
    await this.writeSettingsSnapshotToDatabase({
      key: buildSettingsSourceSnapshotDbKey(sourceUrl),
      settingsUrl: sourceUrl,
      sourceUrls: [sourceUrl],
      kind: parsed.kind,
      rawEntries: parsed.entries,
      modifiedOn,
      artifacts: [],
      translationLibraryUrls: [],
      extraLanguages: parsed.extraLanguages,
      fetchedAt: Date.now(),
    });
  }

  private buildSettingsUrlCandidates(sourceUrls: string[]): string[] {
    const candidates = new Set<string>([SETTINGS_PATH]);

    for (const sourceUrl of sourceUrls) {
      const trimmed = sourceUrl.trim();
      if (!trimmed) {
        continue;
      }

      candidates.add(trimmed);
    }

    return Array.from(candidates);
  }

  private async fetchSettingsAtUrl(
    settingsUrl: string,
    options?: { forceRefresh?: boolean }
  ): Promise<ParsedSourcePayloadResult> {
    const payloadResult = await this.fetchSourcePayload(settingsUrl);
    if (!payloadResult.ok) {
      throw new Error(`${settingsUrl} responded with ${payloadResult.status}`);
    }

    const parsed = await this.parseSourcePayload(settingsUrl, payloadResult.payload, options);
    return { settingsUrl, kind: parsed.kind, entries: parsed.entries, extraLanguages: parsed.extraLanguages };
  }

  private async fetchSourcePayload(sourceUrl: string): Promise<{ ok: true; payload: unknown } | { ok: false; status: number }> {
    let lastStatus = 0;

    for (const candidate of buildFetchUrlCandidates(sourceUrl)) {
      const response = await fetchStorageAware(candidate, { cache: 'no-store' });
      if (response.ok) {
        try {
          return { ok: true, payload: (await response.json()) as unknown };
        } catch {
          return { ok: false, status: 422 };
        }
      }

      lastStatus = response.status;

      const gitHubRaw = parseGitHubRawUrl(sourceUrl);
      if (candidate !== sourceUrl || response.status !== 404 || !gitHubRaw) {
        continue;
      }

      const contentsUrl = buildGitHubContentsUrl(gitHubRaw.owner, gitHubRaw.repo, gitHubRaw.ref, gitHubRaw.path);
      const privateResponse = await fetch(contentsUrl, {
        cache: 'no-store',
        headers: createGitHubAuthHeaders(),
      });

      if (!privateResponse.ok) {
        return { ok: false, status: privateResponse.status };
      }

      const payload = await privateResponse.json();
      const decoded = decodeGitHubContentsPayload(payload);
      if (decoded === null) {
        return { ok: false, status: 422 };
      }

      return { ok: true, payload: decoded };
    }

    return { ok: false, status: lastStatus || 404 };
  }

  private async parseSourcePayload(
    sourceUrl: string,
    payload: unknown,
    options?: { forceRefresh?: boolean }
  ): Promise<{ kind: SourceFileKind; entries: TranslationSettingsEntry[]; extraLanguages: ExtraLanguageMeta[] }> {
    const filenameKind = inferSourceFileKindFromUrl(sourceUrl);
    if (filenameKind && filenameKind !== 'translation') {
      return await this.parseKnownSourcePayload(sourceUrl, payload, filenameKind, options);
    }

    const inferredKind = inferSourceFileKindFromPayload(payload);
    if (inferredKind) {
      return await this.parseKnownSourcePayload(sourceUrl, payload, inferredKind, options);
    }

    if (isGitHubPrivateSourcePayload(payload)) {
      return {
        kind: 'translation',
        entries: [buildDirectGitHubPrivateEntry(sourceUrl, payload)],
        extraLanguages: [],
      };
    }

    if (isBibleDataPayload(payload)) {
      return {
        kind: 'translation',
        entries: [buildDirectTranslationEntry(sourceUrl, payload)],
        extraLanguages: [],
      };
    }

    throw new Error(`${sourceUrl} is not a supported source payload`);
  }

  private async parseKnownSourcePayload(
    sourceUrl: string,
    payload: unknown,
    kind: SourceFileKind,
    options?: { forceRefresh?: boolean }
  ): Promise<{ kind: SourceFileKind; entries: TranslationSettingsEntry[]; extraLanguages: ExtraLanguageMeta[] }> {
    if (kind === 'library') {
      const library = validateLibraryFile(payload, sourceUrl);
      const modifiedOn = readString(library.modifiedOn);
      const cached = modifiedOn && !options?.forceRefresh
        ? await this.readParsedSourceSnapshot(sourceUrl, modifiedOn)
        : null;
      if (cached) {
        return cached;
      }

      const parsed = await this.parseLibraryFile(sourceUrl, library, options);
      if (modifiedOn) {
        await this.writeParsedSourceSnapshot(sourceUrl, modifiedOn, parsed);
      }
      return parsed;
    }

    if (kind === 'resources') {
      const resources = validateResourcesFile(payload, sourceUrl);
      const modifiedOn = readString(resources.modifiedOn);
      const cached = modifiedOn && !options?.forceRefresh
        ? await this.readParsedSourceSnapshot(sourceUrl, modifiedOn)
        : null;
      if (cached) {
        return cached;
      }

      const parsed = {
        kind,
        entries: [buildDirectResourceLibraryEntry(sourceUrl, resources)],
        extraLanguages: [],
      };
      if (modifiedOn) {
        await this.writeParsedSourceSnapshot(sourceUrl, modifiedOn, parsed);
      }
      return parsed;
    }

    if (kind === 'translations') {
      const translations = validateTranslationsFile(payload, sourceUrl);
      const modifiedOn = readString(translations.modifiedOn);
      const cached = modifiedOn && !options?.forceRefresh
        ? await this.readParsedSourceSnapshot(sourceUrl, modifiedOn)
        : null;
      if (cached) {
        return cached;
      }

      const parsed = {
        kind,
        entries: this.normalizeTranslationsFileEntries(translations, sourceUrl),
        extraLanguages: readExtraLanguages(translations.extraLanguages),
      };
      if (modifiedOn) {
        await this.writeParsedSourceSnapshot(sourceUrl, modifiedOn, parsed);
      }
      return parsed;
    }

    if (kind === 'hyperlinks') {
      // Templates are cached by hyperlinkService; this path only validates and claims the kind.
      validateHyperlinksFile(payload, sourceUrl);
      return { kind, entries: [], extraLanguages: [] };
    }

    throw new Error(`${sourceUrl} is not a supported source payload`);
  }

  private async parseLibraryFile(
    sourceUrl: string,
    library: LibraryFileLike,
    options?: { forceRefresh?: boolean }
  ): Promise<{ kind: SourceFileKind; entries: TranslationSettingsEntry[]; extraLanguages: ExtraLanguageMeta[] }> {
    const explicitSources = readLibrarySourceAddresses(library);
    const sourceAddresses = explicitSources.length > 0 ? explicitSources : ['resources.json', 'translations.json'];
    const entries: TranslationSettingsEntry[] = [];
    const extraLanguages = new Map<string, ExtraLanguageMeta>();
    let parsedChildCount = 0;

    for (const address of sourceAddresses) {
      const childUrl = resolveAddress(address, sourceUrl);
      const payloadResult = await this.fetchSourcePayload(childUrl);
      if (!payloadResult.ok) {
        if (explicitSources.length > 0) {
          throw new Error(`${childUrl} responded with ${payloadResult.status}`);
        }
        continue;
      }

      const parsed = await this.parseSourcePayload(childUrl, payloadResult.payload, options);
      parsedChildCount += 1;
      const parentDocumentStoreAddress = readString(library.documentStoreAddress);
      const parentDocumentViewer = readString(library.documentViewer);
      entries.push(
        ...parsed.entries.map((entry) => {
          let next = entry;
          if (entry.artifactType === 'resource-library' && parentDocumentStoreAddress && !entry.documentStoreAddress) {
            next = { ...next, documentStoreAddress: parentDocumentStoreAddress };
          }
          if (entry.artifactType === 'resource-library' && parentDocumentViewer && !entry.documentViewer) {
            next = { ...next, documentViewer: parentDocumentViewer };
          }
          return next;
        })
      );
      for (const language of parsed.extraLanguages) {
        extraLanguages.set(language.code, language);
      }
    }

    if (entries.length === 0 && parsedChildCount === 0) {
      throw new Error(`${sourceUrl} did not provide any resources.json or translations.json sources`);
    }

    return {
      kind: 'library',
      entries,
      extraLanguages: Array.from(extraLanguages.values()).sort((a, b) => a.code.localeCompare(b.code)),
    };
  }

  private normalizeTranslationsFileEntries(payload: TranslationsFileLike, settingsUrl: string): TranslationSettingsEntry[] {
    if (!Array.isArray(payload.translations)) {
      return [];
    }

    return payload.translations.map((raw, index) => {
      if (!isTranslationSettingsEntry(raw)) {
        throw new Error(`translations.json entry ${index + 1} is invalid at ${settingsUrl}`);
      }

      const id = readString(raw.id);
      const label = readString(raw.label);
      const language = readString(raw.language);
      const address = readString(raw.address);
      if (!id || !label || !language || !address) {
        throw new Error(`translations.json entry ${index + 1} is missing a required field at ${settingsUrl}`);
      }

      return {
        ...raw,
        id,
        label,
        language,
        address: resolveAddress(address, settingsUrl),
        artifactType: 'translation',
      };
    });
  }

  private normalizeTranslationEntries(entries: SettingsEntryWithSource[]): BibleTranslationMeta[] {
    const merged = new Map<string, BibleTranslationMeta>();

    for (const { entry, settingsUrl } of entries) {
      const id = (entry.id ?? '').trim();
      if (!id) {
        continue;
      }

      const source = this.normalizeSource(entry, id, settingsUrl);
      const isLocal = this.isLocalSource(source);
      const artifactType = normalizeArtifactType(entry.artifactType);
      const meta: BibleTranslationMeta = {
        id,
        label: entry.label?.trim() || prettifyId(id),
        source,
        configuredSourceUrl: settingsUrl,
        isLocal,
        repositoryType: normalizeRepositoryType(entry.repositoryType, source),
        artifactType,
        language: entry.language,
        owner: entry.owner,
        repo: entry.repo,
        ref: entry.ref,
        path: entry.path,
        requiredPermissions: entry.requiredPermissions,
        authHint: entry.authHint,
        orgName: entry.orgName,
        publicUrl: entry.publicUrl,
        repoAlias: entry.repoAlias,
        documentStoreAddress: entry.documentStoreAddress,
        documentViewer: entry.documentViewer,
        documentManifestAddress: entry.documentManifestAddress,
        referencesAddress: entry.referencesAddress,
        modifiedOn: entry.modifiedOn,
      };

      const mergeKey = getArtifactMergeKey(meta);

      const existing = merged.get(mergeKey);
      if (existing) {
        merged.set(mergeKey, this.choosePreferredMeta(existing, meta));
      } else {
        merged.set(mergeKey, meta);
      }
    }

    if (!merged.has(LOCAL_TRANSLATION_ID)) {
      merged.set(LOCAL_TRANSLATION_ID, DEFAULT_LOCAL_TRANSLATION);
    }

    return this.sortTranslations(Array.from(merged.values()));
  }

  private normalizeSource(entry: TranslationSettingsEntry, id: string, settingsUrl?: string): string {
    if (entry.repositoryType === 'github-private') {
      const owner = readString(entry.owner);
      const repo = readString(entry.repo);
      const ref = readString(entry.ref);
      const path = readString(entry.path);

      if (owner && repo && ref && path) {
        return buildGitHubContentsUrl(owner, repo, ref, path);
      }
    }

    const address = entry.address;
    if (address) {
      return settingsUrl ? resolveAddress(address, settingsUrl) : address.trim();
    }

    return this.buildLocalSource(id);
  }

  private isLocalSource(source: string): boolean {
    return !/^https?:\/\//i.test(source);
  }

  private buildLocalSource(id: string): string {
    return `${BIBLE_DATA_PATH}/${id}.json`;
  }

  async loadTranslation(id: string): Promise<BibleData> {
    const existing = this.translationCache.get(id);
    if (existing) {
      this.cacheStats.translationHits++;
      this.rememberFullTranslation(id, existing);
      return existing;
    }

    this.cacheStats.translationMisses++;
    const meta = await this.resolveTranslationMeta(id);
    const loaded = await this.readOrFetchTranslation(meta);
    this.rememberFullTranslation(id, loaded);
    return loaded;
  }

  async loadChapter(translationId: string, book: string, chapter: number): Promise<BibleChapter | null> {
    const cacheKey = this.getChapterCacheKey(translationId, book, chapter);
    const cached = this.chapterCache.get(cacheKey);
    if (cached) {
      this.cacheStats.chapterHits++;
      this.rememberChapter(cacheKey, cached);
      return cached;
    }

    this.cacheStats.chapterMisses++;
    const bible = this.translationCache.get(translationId)
      ?? await this.loadTranslationWithoutMemoryRetention(translationId);
    const bookData = this.findBookForLookup(bible.books, book);
    const chapterData = bookData?.chapters.find((entry) => entry.chapter === chapter);
    if (!chapterData) {
      return null;
    }

    this.rememberChapter(cacheKey, chapterData);
    return chapterData;
  }

  async loadVerseText(translationId: string, book: string, chapter: number, verse: number): Promise<string> {
    const verseKey = this.getVerseCacheKey(translationId, book, chapter, verse);
    const cached = this.verseCache.get(verseKey);
    if (cached !== undefined) {
      this.cacheStats.verseHits++;
      return cached;
    }

    this.cacheStats.verseMisses++;
    const chapterData = await this.loadChapter(translationId, book, chapter);
    const verseData = chapterData?.verses.find((entry) => entry.verse === verse);
    const text = verseData?.text ?? '';
    this.rememberVerse(verseKey, text);
    return text;
  }

  private async resolveTranslationMeta(id: string): Promise<BibleTranslationMeta> {
    const cached = this.translationMetaById.get(id);
    if (cached) {
      return cached;
    }

    const localCachedMeta = this.readCachedTranslationMeta();
    if (localCachedMeta) {
      const merged = this.mergeTranslations([DEFAULT_LOCAL_TRANSLATION], localCachedMeta.items);
      this.cacheTranslationMeta(merged);
      const fromLocalCache = this.translationMetaById.get(id);
      if (fromLocalCache) {
        return fromLocalCache;
      }
    }

    try {
      const sourceUrls = this.readState().sourceUrls ?? [];
      const fetched = await this.fetchSettings(sourceUrls);
      const remoteMeta = fetched.artifacts
        .filter((entry) => entry.artifactType === 'translation');
      const merged = this.mergeTranslations([DEFAULT_LOCAL_TRANSLATION], remoteMeta);
      this.cacheTranslationMeta(merged);
      this.writeCachedTranslationMeta(remoteMeta);
      const fromRemote = this.translationMetaById.get(id);
      if (fromRemote) {
        return fromRemote;
      }
    } catch {
      // Ignore settings fetch errors and fallback to local path below.
    }

    return {
      id,
      label: id,
      source: this.buildLocalSource(id),
      isLocal: true
    };
  }

  runSearch(bible: BibleData, query: string): SearchResultSet | null {
    const normalized = query.trim();

    if (!bible || !normalized) {
      return null;
    }

    const lower = normalized.toLowerCase();
    let totalMatches = 0;
    const matches: SearchMatch[] = [];

    for (const book of bible.books) {
      for (const chapter of book.chapters) {
        for (const verse of chapter.verses) {
          if (!verse.text) {
            continue;
          }

          if (verse.text.toLowerCase().includes(lower)) {
            totalMatches += 1;
            if (matches.length < SEARCH_LIMIT) {
              matches.push(
                new SearchMatch(book.name, chapter.chapter, verse.verse, verse.text)
              );
            }
          }
        }
      }
    }

    return {
      query: normalized,
      matches,
      total: totalMatches,
      limited: matches.length < totalMatches
    };
  }

  readState(): MarginaliaState {
    if (typeof window === 'undefined') {
      return { lastTranslationId: LOCAL_TRANSLATION_ID, lastTranslationIds: [LOCAL_TRANSLATION_ID] };
    }

    try {
      const raw = window.localStorage.getItem(STATE_CACHE_KEY);
      if (!raw) {
        return { lastTranslationId: LOCAL_TRANSLATION_ID, lastTranslationIds: [LOCAL_TRANSLATION_ID] };
      }

      const parsed = JSON.parse(raw) as MarginaliaState;
      if (!parsed.lastTranslationId) {
        parsed.lastTranslationId = LOCAL_TRANSLATION_ID;
      }
      if (!parsed.lastTranslationIds || parsed.lastTranslationIds.length === 0) {
        parsed.lastTranslationIds = [parsed.lastTranslationId];
      } else {
        parsed.lastTranslationIds = parsed.lastTranslationIds
          .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
          .map((entry) => entry.trim());
        if (parsed.lastTranslationIds.length === 0) {
          parsed.lastTranslationIds = [parsed.lastTranslationId];
        }
      }
      if (!parsed.lastTranslationIds.includes(parsed.lastTranslationId)) {
        parsed.lastTranslationId = parsed.lastTranslationIds[0];
      }
      if (parsed.languages) {
        parsed.languages = Array.isArray(parsed.languages)
          ? parsed.languages.filter((entry): entry is string => typeof entry === 'string')
          : undefined;
      }

      if (parsed.sourceUrls) {
        parsed.sourceUrls = Array.isArray(parsed.sourceUrls)
          ? Array.from(new Set(
            parsed.sourceUrls
              .filter((entry): entry is string => typeof entry === 'string')
              .map((entry) => entry.trim())
              .filter((entry) => entry.length > 0)
          ))
          : undefined;
      }

      // Migrate old state to new translationRecords format if needed
      if (!parsed.translationRecords || parsed.translationRecords.length === 0) {
        const idsToUse = parsed.lastTranslationIds && parsed.lastTranslationIds.length > 0
          ? parsed.lastTranslationIds
          : [parsed.lastTranslationId || LOCAL_TRANSLATION_ID];
        
        parsed.translationRecords = idsToUse.map((id) => ({
          id: id.trim(),
          starred: id === (parsed.lastTranslationId || idsToUse[0])
        }));
      } else {
        // Validate and normalize translationRecords
        parsed.translationRecords = (Array.isArray(parsed.translationRecords) ? parsed.translationRecords : [])
          .filter((r): r is { id: string; starred: boolean } => 
            r && typeof r === 'object' && typeof r.id === 'string' && r.id.trim().length > 0
          )
          .map((r) => ({
            id: r.id.trim(),
            starred: Boolean(r.starred)
          }));
        
        if (parsed.translationRecords.length === 0) {
          parsed.translationRecords = [{ id: LOCAL_TRANSLATION_ID, starred: true }];
        }

        // Ensure at least one starred
        if (!parsed.translationRecords.some((r) => r.starred)) {
          parsed.translationRecords[0].starred = true;
        }
      }

      return parsed;
    } catch (error) {
      console.warn('Failed to parse persisted state', error);
      return { lastTranslationId: LOCAL_TRANSLATION_ID, lastTranslationIds: [LOCAL_TRANSLATION_ID] };
    }
  }

  persistState(update: Partial<MarginaliaState>): MarginaliaState {
    if (typeof window === 'undefined') {
      return { lastTranslationId: LOCAL_TRANSLATION_ID, lastTranslationIds: [LOCAL_TRANSLATION_ID] };
    }

    const current = this.readState();
    const next: MarginaliaState = { ...current, ...update };
    // A user ID, once established, must never change - guard here so no call site (present or future) can override it.
    if (current.userId) {
      next.userId = current.userId;
    }
    if (!next.lastTranslationIds || next.lastTranslationIds.length === 0) {
      next.lastTranslationIds = [next.lastTranslationId || LOCAL_TRANSLATION_ID];
    }
    if (!next.lastTranslationId || !next.lastTranslationIds.includes(next.lastTranslationId)) {
      next.lastTranslationId = next.lastTranslationIds[0] || LOCAL_TRANSLATION_ID;
    }

    // Normalize translationRecords if present
    if (next.translationRecords && Array.isArray(next.translationRecords)) {
      next.translationRecords = next.translationRecords
        .filter((r): r is { id: string; starred: boolean } =>
          r && typeof r === 'object' && typeof r.id === 'string' && r.id.trim().length > 0
        )
        .map((r) => ({
          id: r.id.trim(),
          starred: Boolean(r.starred)
        }));
      
      if (next.translationRecords.length === 0) {
        next.translationRecords = [{ id: LOCAL_TRANSLATION_ID, starred: true }];
      }

      if (!next.translationRecords.some((r) => r.starred)) {
        next.translationRecords[0].starred = true;
      }
    }

    if (next.sourceUrls && Array.isArray(next.sourceUrls)) {
      next.sourceUrls = Array.from(new Set(
        next.sourceUrls
          .filter((entry): entry is string => typeof entry === 'string')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
      ));
    }

    try {
      window.localStorage.setItem(STATE_CACHE_KEY, JSON.stringify(next));
    } catch (error) {
      console.warn('Unable to persist state', error);
    }

    return next;
  }

  private mergeTranslations(
    existing: BibleTranslationMeta[],
    incoming: BibleTranslationMeta[]
  ): BibleTranslationMeta[] {
    const mergedMap = new Map<string, BibleTranslationMeta>();

    const apply = (candidate: BibleTranslationMeta): void => {
      const existingMeta = mergedMap.get(candidate.id);
      if (existingMeta) {
        mergedMap.set(candidate.id, this.choosePreferredMeta(existingMeta, candidate));
      } else {
        mergedMap.set(candidate.id, candidate);
      }
    };

    for (const entry of existing) {
      apply(entry);
    }

    for (const entry of incoming) {
      apply(entry);
    }

    if (!mergedMap.has(LOCAL_TRANSLATION_ID)) {
      apply(DEFAULT_LOCAL_TRANSLATION);
    }

    return this.sortTranslations(Array.from(mergedMap.values()));
  }

  private choosePreferredMeta(
    existing: BibleTranslationMeta,
    incoming: BibleTranslationMeta
  ): BibleTranslationMeta {
    const existingIsLocal = existing.isLocal;
    const incomingIsLocal = incoming.isLocal;

    if (incomingIsLocal && !existingIsLocal) {
      return { ...existing, ...incoming };
    }

    if (existingIsLocal && !incomingIsLocal) {
      return { ...incoming, ...existing, isLocal: true, source: existing.source };
    }

    return { ...existing, ...incoming, isLocal: existingIsLocal || incomingIsLocal };
  }

  private sortTranslations(entries: BibleTranslationMeta[]): BibleTranslationMeta[] {
    return entries.sort((a, b) => a.id.localeCompare(b.id));
  }

  private readCachedTranslationMeta(): CachedTranslationMeta | null {
    if (typeof window === 'undefined') {
      return null;
    }

    try {
      const raw = window.localStorage.getItem(META_CACHE_KEY);
      if (!raw) {
        return null;
      }
      const cached = JSON.parse(raw) as CachedTranslationMeta;
      if (!cached.cachedAt || Date.now() - cached.cachedAt > META_TTL_MS) {
        return null;
      }
      return cached;
    } catch {
      return null;
    }
  }

  private writeCachedTranslationMeta(remote: BibleTranslationMeta[], extraLanguages: ExtraLanguageMeta[] = this.extraLanguages): void {
    if (typeof window === 'undefined') {
      return;
    }

    const payload: CachedTranslationMeta = {
      items: remote,
      extraLanguages,
      cachedAt: Date.now()
    };

    try {
      window.localStorage.setItem(META_CACHE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.warn('Unable to cache translation metadata', error);
    }
  }

  private async getDatabase(): Promise<IDBPDatabase<BibleDB>> {
    if (!this.dbPromise) {
      this.dbPromise = openDB<BibleDB>('marginalia-db', 5, {
        upgrade(db) {
          if (!db.objectStoreNames.contains('translations')) {
            db.createObjectStore('translations');
          }

          if (!db.objectStoreNames.contains('settingsSnapshots')) {
            db.createObjectStore('settingsSnapshots');
          }

          if (!db.objectStoreNames.contains('resourceShards')) {
            db.createObjectStore('resourceShards');
          }

          if (!db.objectStoreNames.contains('resourceLibraries')) {
            db.createObjectStore('resourceLibraries');
          }

          if (!db.objectStoreNames.contains('hyperlinkSets')) {
            db.createObjectStore('hyperlinkSets');
          }
        }
      });
    }

    return this.dbPromise;
  }

  private async readFromDatabase(
    meta: BibleTranslationMeta,
    options?: { allowStaleRemote?: boolean; currentSourceVersion?: string | null }
  ): Promise<StoredBible | null> {
    const db = await this.getDatabase();
    const stored = await db.get('translations', meta.id);
    if (!stored) {
      return null;
    }

    if (meta.repositoryType === 'github-private') {
      const currentSourceVersion = options?.currentSourceVersion ?? null;
      if (currentSourceVersion && stored.sourceVersion && stored.sourceVersion !== currentSourceVersion) {
        return null;
      }

      if (currentSourceVersion && stored.sourceVersion === currentSourceVersion) {
        return stored;
      }
    }

    if (!meta.isLocal) {
      const age = Date.now() - stored.fetchedAt;
      if (age > REMOTE_TTL_MS && !options?.allowStaleRemote) {
        return null;
      }
    }

    return stored;
  }

  private async writeToDatabase(meta: BibleTranslationMeta, data: BibleData, sourceVersion?: string | null): Promise<void> {
    const db = await this.getDatabase();
    const stored: StoredBible = {
      id: meta.id,
      data,
      source: meta.source,
      fetchedAt: Date.now(),
      sourceVersion: sourceVersion ?? null,
    };
    await db.put('translations', stored, meta.id);
  }

  private async readOrFetchTranslation(meta: BibleTranslationMeta): Promise<BibleData> {
    const sourceVersion = meta.repositoryType === 'github-private'
      ? await resolveGitHubPrivateSourceVersion(meta.publicUrl, meta.repoAlias)
      : null;

    const fromDb = await this.readFromDatabase(meta, { currentSourceVersion: sourceVersion });
    if (fromDb) {
      return fromDb.data;
    }

    try {
      const fetched = await this.fetchTranslation(meta);
      await this.writeToDatabase(meta, fetched, sourceVersion);
      return fetched;
    } catch (error) {
      const stale = await this.readFromDatabase(meta, { allowStaleRemote: true });
      if (!meta.isLocal && stale && !(error instanceof GitHubPrivateSourceError && error.code === 'not-authorized')) {
        console.warn(`Falling back to stale cached translation for ${meta.id}`, error);
        return stale.data;
      }
      throw error;
    }
  }

  private async loadTranslationWithoutMemoryRetention(id: string): Promise<BibleData> {
    const meta = await this.resolveTranslationMeta(id);
    return this.readOrFetchTranslation(meta);
  }

  private rememberFullTranslation(id: string, bible: BibleData): void {
    if (this.translationCache.has(id)) {
      this.translationCache.delete(id);
    }
    this.translationCache.set(id, bible);

    this.pruneFullTranslationCache();
  }

  private pruneFullTranslationCache(): void {
    while (this.translationCache.size > this.fullTranslationCacheLimit) {
      const oldestId = this.translationCache.keys().next().value as string | undefined;
      if (!oldestId) {
        break;
      }
      this.translationCache.delete(oldestId);
      this.pruneDerivedCachesForTranslation(oldestId);
    }
  }

  private rememberChapter(cacheKey: string, chapter: BibleChapter): void {
    if (this.chapterCache.has(cacheKey)) {
      this.chapterCache.delete(cacheKey);
    }
    this.chapterCache.set(cacheKey, chapter);

    while (this.chapterCache.size > MAX_CHAPTERS_IN_MEMORY) {
      const oldestKey = this.chapterCache.keys().next().value as string | undefined;
      if (!oldestKey) {
        break;
      }
      this.cacheStats.chapterEvictions++;
      this.chapterCache.delete(oldestKey);
    }
  }

  private rememberVerse(cacheKey: string, text: string): void {
    if (this.verseCache.has(cacheKey)) {
      this.verseCache.delete(cacheKey);
    }
    this.verseCache.set(cacheKey, text);

    while (this.verseCache.size > MAX_VERSES_IN_MEMORY) {
      const oldestKey = this.verseCache.keys().next().value as string | undefined;
      if (!oldestKey) {
        break;
      }
      this.cacheStats.verseEvictions++;
      this.verseCache.delete(oldestKey);
    }
  }

  private pruneDerivedCachesForTranslation(translationId: string): void {
    const prefix = `${translationId}\x00`;

    for (const key of this.chapterCache.keys()) {
      if (key.startsWith(prefix)) {
        this.chapterCache.delete(key);
      }
    }

    for (const key of this.verseCache.keys()) {
      if (key.startsWith(prefix)) {
        this.verseCache.delete(key);
      }
    }
  }

  private getChapterCacheKey(translationId: string, book: string, chapter: number): string {
    return `${translationId}\x00${book}\x00${chapter}`;
  }

  private getVerseCacheKey(translationId: string, book: string, chapter: number, verse: number): string {
    return `${translationId}\x00${book}\x00${chapter}\x00${verse}`;
  }

  private findBookForLookup(books: BibleBook[], requestedBook: string): BibleBook | undefined {
    const exact = books.find((entry) => entry.name === requestedBook);
    if (exact) {
      return exact;
    }

    const normalizedRequested = normalizeLookupBookName(requestedBook);
    const normalizedMatch = books.find((entry) => normalizeLookupBookName(entry.name) === normalizedRequested);
    if (normalizedMatch) {
      return normalizedMatch;
    }

    const canonicalRequested = BOOK_CANONICAL_BY_ALIAS.get(normalizedRequested);
    if (!canonicalRequested) {
      return undefined;
    }

    return books.find((entry) => {
      const canonicalCandidate = BOOK_CANONICAL_BY_ALIAS.get(normalizeLookupBookName(entry.name));
      return canonicalCandidate === canonicalRequested;
    });
  }

  private async fetchTranslation(meta: BibleTranslationMeta): Promise<BibleData> {
    const repositoryType = meta.repositoryType ?? normalizeRepositoryType(undefined, meta.source);
    if (repositoryType !== 'local' && !isHttpsUrl(meta.source)) {
      throw new Error(`Remote source for ${meta.id} must use HTTPS`);
    }

    const sources = this.buildSourceCandidates(meta);
    const failures: string[] = [];

    for (const source of sources) {
      try {
        const response = await fetchStorageAware(source, {
          cache: 'no-store',
          headers: repositoryType === 'github-private'
            ? createGitHubAuthHeaders()
            : undefined,
        });

        if (!response.ok) {
          if (repositoryType === 'github-private' && (response.status === 401 || response.status === 403)) {
            throw new GitHubPrivateSourceError('GitHub authorization required or expired. Reauthorize to access this private source.', 'not-authorized');
          }

          if (repositoryType === 'github-private' && response.status === 404) {
            throw new GitHubPrivateSourceError(`Private source not found for ${meta.id}. Verify the owner, repo, ref, and path.`, 'not-found');
          }

          failures.push(`${source} -> ${response.status}`);
          continue;
        }

        if (repositoryType === 'github-private') {
          return parseGitHubPrivateBibleData(await response.json(), meta.id);
        }

        return (await response.json()) as BibleData;
      } catch (error) {
        if (error instanceof GitHubPrivateSourceError) {
          throw error;
        }

        const message = error instanceof Error ? error.message : 'unknown error';
        failures.push(`${source} -> ${message}`);
      }
    }

    throw new Error(
      failures.length > 0
        ? `Failed to fetch ${meta.id}: ${failures.join('; ')}`
        : `Failed to fetch ${meta.id}`
    );
  }

  private buildSourceCandidates(meta: BibleTranslationMeta): string[] {
    const candidates = new Set<string>();
    const repositoryType = meta.repositoryType ?? normalizeRepositoryType(undefined, meta.source);

    if (repositoryType === 'local') {
      candidates.add(this.buildLocalSource(meta.id));
      if (this.isLocalSource(meta.source)) {
        candidates.add(meta.source);
      }
      return Array.from(candidates);
    }

    // Private GitHub artifacts must use direct authenticated endpoints only.
    if (repositoryType === 'github-private') {
      candidates.add(meta.source);
      return Array.from(candidates);
    }

    if (repositoryType === 'hosted') {
      candidates.add(meta.source);
      return Array.from(candidates);
    }

    const repoInfo = this.extractRepoInfo(meta);
    if (repoInfo) {
      const { owner, repo, branch, path } = repoInfo;
      const cdnPath = `${owner}/${repo}@${branch}/${path}`;
      candidates.add(`https://cdn.jsdelivr.net/gh/${cdnPath}`);
      candidates.add(`https://fastly.jsdelivr.net/gh/${cdnPath}`);
      candidates.add(`https://cdn.statically.io/gh/${owner}/${repo}/${branch}/${path}`);
      candidates.add(`https://rawcdn.githack.com/${owner}/${repo}/${branch}/${path}`);
    }
    candidates.add(meta.source);

    return Array.from(candidates);
  }

  private extractRepoInfo(meta: BibleTranslationMeta): {
    owner: string;
    repo: string;
    branch: string;
    path: string;
  } | null {
    if (!meta.source.startsWith('https://raw.githubusercontent.com/')) {
      return null;
    }

    const trimmed = meta.source.replace('https://raw.githubusercontent.com/', '');
    const segments = trimmed.split('/');
    if (segments.length < 4) {
      return null;
    }

    const [owner, repo, branch, ...rest] = segments;
    const path = rest.join('/');

    if (!owner || !repo || !branch || !path) {
      return null;
    }

    return { owner, repo, branch, path };
  }
}

function prettifyId(id: string): string {
  const upper = id.toUpperCase();
  if (upper === 'KJV') {
    return 'KJV (King James Version)';
  }

  if (upper.length <= 5) {
    return upper;
  }

  return id
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHttpsUrl(value: string): boolean {
  return /^https:\/\//i.test(value.trim());
}

function isTranslationSettingsEntry(value: unknown): value is TranslationSettingsEntry {
  return isPlainObject(value);
}

function buildBookCanonicalAliasMap(): Map<string, string> {
  const map = new Map<string, string>();

  for (const [canonicalBook, aliases] of Object.entries(BOOK_ALIAS_CONFIG)) {
    const canonicalNormalized = normalizeLookupBookName(canonicalBook);
    map.set(canonicalNormalized, canonicalBook);

    for (const alias of aliases) {
      map.set(normalizeLookupBookName(alias), canonicalBook);
    }
  }

  return map;
}

function normalizeLookupBookName(value: string): string {
  const compact = normalizeBookName(value)
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return compact;
}

function isBibleDataPayload(value: unknown): value is BibleData {
  if (!isPlainObject(value)) {
    return false;
  }

  return typeof value['translation'] === 'string' && Array.isArray(value['books']);
}

function buildDirectTranslationEntry(sourceUrl: string, bibleData: BibleData): TranslationSettingsEntry {
  const label = bibleData.translation?.trim() || extractFilenameStem(sourceUrl) || 'Remote Translation';
  const slug = slugify(label) || 'translation';
  const suffix = hashText(sourceUrl).slice(0, 8);

  return {
    id: `${slug}-${suffix}`,
    label,
    address: sourceUrl,
    repositoryType: normalizeRepositoryType(undefined, sourceUrl),
    artifactType: 'translation',
  };
}

function buildDirectResourceLibraryEntry(sourceUrl: string, resourcesPayload: ResourcesFileLike): TranslationSettingsEntry {
  const sourceType = readString(resourcesPayload.name);
  const stem = extractFilenameStem(sourceUrl);
  const baseLabel = sourceType ?? (stem ? prettifyLibraryLabel(sourceUrl) : 'Resource Library');
  const label = /resource library/i.test(baseLabel) ? baseLabel : `${baseLabel} Resource Library`;
  const slugBase = slugify(sourceType ?? stem ?? 'resource-library') || 'resource-library';
  const suffix = hashText(sourceUrl).slice(0, 8);

  return {
    id: `${slugBase}-${suffix}`,
    label,
    address: sourceUrl,
    repositoryType: normalizeRepositoryType(undefined, sourceUrl),
    artifactType: 'resource-library',
    documentStoreAddress: readString(resourcesPayload.documentStoreAddress),
    documentViewer: readString(resourcesPayload.documentViewer),
    documentManifestAddress: readString(resourcesPayload.documentManifestAddress),
    referencesAddress: readString(resourcesPayload.referencesAddress),
    modifiedOn: readString(resourcesPayload.modifiedOn),
  };
}

function buildDirectGitHubPrivateEntry(sourceUrl: string, configPayload: GitHubPrivateSourceConfigFile): TranslationSettingsEntry {
  const owner = readString(configPayload.owner);
  const repo = readString(configPayload.repo);
  const ref = readString(configPayload.ref);
  const path = readString(configPayload.path);
  const id = readString(configPayload.id) ?? slugify(path ?? `${owner}-${repo}`) ?? 'github-private-source';
  const labelSource = readString(configPayload.label) ?? readString(configPayload.repoAlias) ?? path ?? id;
  const label = prettifyLibraryLabel(labelSource) || id;

  return {
    id,
    label,
    address: sourceUrl,
    repositoryType: 'github-private',
    artifactType: 'translation',
    owner,
    repo,
    ref,
    path,
    requiredPermissions: Array.isArray(configPayload.requiredPermissions)
      ? configPayload.requiredPermissions.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      : undefined,
    authHint: readString(configPayload.authHint),
    orgName: readString(configPayload.orgName),
    publicUrl: readString(configPayload.publicUrl),
    repoAlias: readString(configPayload.repoAlias),
  };
}

function normalizeRepositoryType(
  value: unknown,
  source: string
): RepositoryType {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'local' || normalized === 'hosted' || normalized === 'github-public' || normalized === 'github-private') {
      return normalized;
    }

    // Backward compatibility for earlier values.
    if (normalized === 'github') {
      return 'github-public';
    }

    if (normalized === 'generic-http') {
      return 'hosted';
    }
  }

  if (!/^https?:\/\//i.test(source)) {
    return 'local';
  }

  if (/^https?:\/\/raw\.githubusercontent\.com\//i.test(source)) {
    return 'github-public';
  }

  return 'hosted';
}

function normalizeArtifactType(value: unknown): ArtifactType {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'translation' || normalized === 'translation-library' || normalized === 'resource-library') {
      return normalized;
    }

    // Backward compatibility for earlier values.
    if (normalized === 'translation-json' || normalized === 'settings-json') {
      return 'translation';
    }
  }

  return 'translation';
}

function getArtifactMergeKey(entry: Pick<BibleTranslationMeta, 'id' | 'artifactType'>): string {
  const kind = entry.artifactType ?? 'translation';
  if (kind === 'translation') {
    return entry.id;
  }

  return `${kind}:${entry.id}`;
}

function hashText(value: string): string {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}
function buildSettingsSnapshotDbKey(sourceUrls: string[]): string {
  return hashText(`settings|${sourceUrls.join('|')}`);
}

function buildSettingsSourceSnapshotDbKey(sourceUrl: string): string {
  return hashText(`settings-source|${sourceUrl}`);
}

function isStoredModifiedOnCurrent(storedModifiedOn: string | undefined, nextModifiedOn: string): boolean {
  if (!storedModifiedOn) {
    return false;
  }

  const storedTime = Date.parse(storedModifiedOn);
  const nextTime = Date.parse(nextModifiedOn);
  if (Number.isFinite(storedTime) && Number.isFinite(nextTime)) {
    return storedTime >= nextTime;
  }

  return storedModifiedOn === nextModifiedOn;
}

export const bibleService = new BibleService();
