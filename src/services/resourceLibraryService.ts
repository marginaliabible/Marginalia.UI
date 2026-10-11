import type { DBSchema, IDBPDatabase } from 'idb';
import type { BibleTranslationMeta, FederatedProvider } from '../models/bible';
import { BOOK_ALIAS_CONFIG, normalizeBookName } from '../utils/book-aliases';
import {
  DEFAULT_DOCUMENT_STORE_ADDRESS,
  buildDocumentStorePageUrl,
  buildFetchUrlCandidates,
  isPlainObject,
  indexResourceDocuments,
  readCloudSyncProviderFromResourcesUrl,
  readDocumentViewerKind,
  readResourceDocumentEntry,
  readString,
  resolveAddress,
  validateDocumentsFile,
  validateResourcesFile,
  type DocumentViewerKind,
  type ResourceDocumentEntry,
  type ResourcesFileLike,
} from '../utils/resourceLibraryConfig';
import {
  applyResourceTagOverride,
  hasSourcePreferences,
  isResourceDisabled,
  resolveLibraryKey,
  resourceDocumentKey,
  resourcesUrlKey,
  type SourcePreferences,
} from '../utils/sourceSubscriptions';
import { fetchStorageAware } from './storageAuthenticatedFetch';

interface ResourceLibraryDB extends DBSchema {
  resourceShards: {
    key: string;
    value: StoredResourceShard;
  };
  resourceLibraries: {
    key: string;
    value: StoredResourceLibrary;
  };
}

interface StoredResourceShard {
  key: string;
  libraryId: string;
  shardFile: string;
  resourcesUrl: string;
  modifiedOn?: string;
  entries: ResourceVerseEntry[];
  fetchedAt: number;
}

interface StoredResourceLibrary {
  key: string;
  id: string;
  label: string;
  resourcesUrl: string;
  documentManifestAddress: string;
  documentStoreAddress: string;
  documentViewer: DocumentViewerKind | null;
  referencesAddress: string;
  documents: ResourceDocumentEntry[];
  resources: ExportManifestShard[];
  modifiedOn?: string;
  fetchedAt: number;
}

interface FetchSettingsResult {
  artifacts: BibleTranslationMeta[];
  translationLibraryUrls: string[];
}

export interface VerseResourceDocumentLink {
  page: number;
  url: string;
  /** Distinct reference texts citing the verse on this page (e.g. "1 Pet. 2:24" and "1Pe 2:24"). */
  raws?: string[];
  viewer: DocumentViewerKind;
}

export interface VerseResourceDocument {
  libraryId: string;
  libraryLabel: string;
  documentId: string;
  /** Set when the document comes from a Cloud Service Sync library; documentId is then the cloud item id. */
  cloudProvider: FederatedProvider | null;
  title: string;
  tags: string[];
  pages: number[];
  pageLinks: VerseResourceDocumentLink[];
  /** Subscription library this document came from ('builtin' or the saved source URL). */
  libraryKey?: string;
  /** Stable key for per-document subscription preferences (see resourceDocumentKey). */
  resourceKey?: string;
  /** Content hash (SHA-256 of the source file) when the manifest publishes one. */
  hash?: string;
  /** Identifies this document in shareable page links; the same for every user who has it. */
  link: ResourceDocumentLinkKey;
}

/** `doc` is the content hash when known; otherwise the publisher's documentId within the library keyed by `lib`. */
export interface ResourceDocumentLinkKey {
  doc: string;
  lib?: string;
}

export interface ResolvedResourceDocumentLink {
  libraryId: string;
  documentId: string;
  title: string;
  hash?: string;
  cloudProvider: FederatedProvider | null;
  viewer: DocumentViewerKind;
  /** Document store URL for the requested page. */
  url: string;
}

export interface ResourceLibraryDocumentList {
  libraryId: string;
  label: string;
  resourcesUrl: string;
  configuredSourceUrl?: string;
  documents: ResourceDocumentEntry[];
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

interface ResourceOccurrence {
  documentId: string;
  page: number;
  raw?: string;
}

/** Parsed shard verse row — validated at the JSON/IDB boundary before caching. */
interface ResourceVerseEntry {
  ref: string;
  raw?: string;
  occurrences: Array<{ documentId: string; page: number }>;
}

interface ResolvedResourceLibrary {
  id: string;
  label: string;
  resourcesUrl: string;
  configuredSourceUrl?: string;
  documentManifestAddress: string;
  documentStoreAddress: string;
  documentViewer: DocumentViewerKind | null;
  referencesAddress: string;
  modifiedOn?: string;
  documentsById: Map<string, ResourceDocumentEntry>;
  resources: ExportManifestShard[];
  shardCache: Map<string, ResourceVerseEntry[]>;
}

interface ResourceLibraryServiceDependencies {
  fetchSettings: (
    sourceUrls: string[],
    options?: { forceRefresh?: boolean }
  ) => Promise<FetchSettingsResult>;
  getDatabase: () => Promise<IDBPDatabase<any>>;
}

/** Soft TTL so cloud sync updates (empty → sharded resources.json) are noticed without a hard refresh. */
const RESOURCE_LIBRARY_REVALIDATE_MS = 60_000;

const BOOK_CANONICAL_BY_ALIAS = buildBookCanonicalAliasMap();

export class ResourceLibraryService {
  private readonly fetchSettings: ResourceLibraryServiceDependencies['fetchSettings'];
  private readonly getDatabase: ResourceLibraryServiceDependencies['getDatabase'];
  private resourceLibraryCacheKey: string | null = null;
  private resourceLibrarySourceKey: string | null = null;
  private resourceLibrariesLoadedAt = 0;
  private hasLoadedResourceLibraries = false;
  private resourceLibrariesLoadSourceKey: string | null = null;
  private resourceLibrariesLoadPromise: Promise<ResolvedResourceLibrary[]> | null = null;
  private resourceLibraries: ResolvedResourceLibrary[] = [];
  private verseResourceCache = new Map<string, VerseResourcesPayload>();

  constructor(dependencies: ResourceLibraryServiceDependencies) {
    this.fetchSettings = dependencies.fetchSettings;
    this.getDatabase = dependencies.getDatabase;
  }

  async hasResourcesForVerse(
    book: string,
    chapter: number,
    verse: number,
    sourceUrls: string[] = [],
    preferences?: SourcePreferences
  ): Promise<boolean> {
    try {
      const payload = await this.getResourcesForVerse(book, chapter, verse, sourceUrls, preferences);
      return payload.documents.length > 0;
    } catch {
      return false;
    }
  }

  async getResourcesForVerse(
    book: string,
    chapter: number,
    verse: number,
    sourceUrls: string[] = [],
    preferences?: SourcePreferences
  ): Promise<VerseResourcesPayload> {
    const payload = await this.getUnfilteredResourcesForVerse(book, chapter, verse, sourceUrls);
    return applySourcePreferencesToVersePayload(payload, preferences);
  }

  /** Every document of every resource library reachable from the given sources (built-in included). */
  async listResourceLibraryDocuments(sourceUrls: string[] = []): Promise<ResourceLibraryDocumentList[]> {
    const libraries = await this.loadResourceLibraries(sourceUrls);
    return libraries.map((library) => ({
      libraryId: library.id,
      label: library.label,
      resourcesUrl: library.resourcesUrl,
      configuredSourceUrl: library.configuredSourceUrl,
      // documentsById also indexes each entry under its content hash.
      documents: Array.from(new Set(library.documentsById.values())).sort((a, b) => a.title.localeCompare(b.title)),
    }));
  }

  /** Finds a shared page link's document among the caller's own libraries; null when they don't have it. */
  async findDocumentByLink(
    link: ResourceDocumentLinkKey & { page: number },
    sourceUrls: string[] = []
  ): Promise<ResolvedResourceDocumentLink | null> {
    const libraries = await this.loadResourceLibraries(sourceUrls);

    for (const library of libraries) {
      if (link.lib && resourcesUrlKey(library.resourcesUrl) !== link.lib) {
        continue;
      }

      const document = library.documentsById.get(link.doc);
      if (!document || (!link.lib && document.hash !== link.doc)) {
        continue;
      }

      return {
        libraryId: library.id,
        documentId: document.documentId,
        title: document.title,
        ...(document.hash ? { hash: document.hash } : {}),
        cloudProvider: readCloudSyncProviderFromResourcesUrl(library.resourcesUrl),
        viewer: library.documentViewer === 'markup' ? 'markup' : 'pdf',
        url: buildDocumentStorePageUrl(library.documentStoreAddress, library.resourcesUrl, document, link.page),
      };
    }

    return null;
  }

  private async getUnfilteredResourcesForVerse(
    book: string,
    chapter: number,
    verse: number,
    sourceUrls: string[]
  ): Promise<VerseResourcesPayload> {
    const normalizedSourceUrls = Array.from(new Set(sourceUrls.map((entry) => entry.trim()).filter((entry) => entry.length > 0))).sort();
    const cacheKey = `${normalizedSourceUrls.join('|')}::${normalizeReferenceBookToken(book)}.${chapter}.${verse}`;
    const cached = this.verseResourceCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const libraries = await this.loadResourceLibraries(normalizedSourceUrls);
    const aggregated = new Map<string, VerseResourceDocument>();
    const tagSet = new Set<string>();

    for (const library of libraries) {
      const matches = await this.findResourceOccurrences(library, book, chapter, verse);
      for (const match of matches) {
        // Research shards tag occurrences by content hash; documents.json keys by cloud id
        // (with hash as a sibling field). Resolve either form to the same manifest entry.
        const document = library.documentsById.get(match.documentId);
        if (!document) {
          continue;
        }

        const key = `${library.id}:${document.documentId}`;
        const existing = aggregated.get(key);
        const nextPages = existing
          ? Array.from(new Set([...existing.pages, match.page])).sort((a, b) => a - b)
          : [match.page];
        const tags = existing
          ? Array.from(new Set([...existing.tags, ...document.tags]))
          : document.tags;

        for (const tag of tags) {
          tagSet.add(tag);
        }

        const rawsByPage = new Map<number, string[]>();
        for (const pageNumber of nextPages) {
          const existingRaws = existing?.pageLinks.find((link) => link.page === pageNumber)?.raws ?? [];
          const matchRaw = pageNumber === match.page ? match.raw?.trim() : undefined;
          const raws = matchRaw && !existingRaws.includes(matchRaw) ? [...existingRaws, matchRaw] : existingRaws;
          if (raws.length > 0) {
            rawsByPage.set(pageNumber, raws);
          }
        }

        const nextDoc: VerseResourceDocument = {
          libraryId: library.id,
          libraryLabel: library.label,
          documentId: document.documentId,
          cloudProvider: readCloudSyncProviderFromResourcesUrl(library.resourcesUrl),
          title: document.title,
          tags,
          pages: nextPages,
          pageLinks: nextPages.map((page) => ({
            page,
            url: buildDocumentStorePageUrl(library.documentStoreAddress, library.resourcesUrl, document, page),
            raws: rawsByPage.get(page),
            viewer: library.documentViewer === 'markup' ? 'markup' : 'pdf',
          })),
          libraryKey: resolveLibraryKey(library.configuredSourceUrl, normalizedSourceUrls),
          resourceKey: resourceDocumentKey(library.resourcesUrl, document.documentId),
          ...(document.hash ? { hash: document.hash } : {}),
          link: buildResourceDocumentLinkKey(library.resourcesUrl, document),
        };

        aggregated.set(key, nextDoc);
      }
    }

    const payload: VerseResourcesPayload = {
      reference: { book, chapter, verse },
      tags: Array.from(tagSet).sort((a, b) => a.localeCompare(b)),
      documents: Array.from(aggregated.values()).sort((a, b) => a.title.localeCompare(b.title)),
    };

    this.verseResourceCache.set(cacheKey, payload);
    return payload;
  }

  private async loadResourceLibraries(sourceUrls: string[] = []): Promise<ResolvedResourceLibrary[]> {
    const normalizedSourceUrls = Array.from(new Set(
      sourceUrls
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    )).sort();
    const sourceKey = normalizedSourceUrls.join('|');
    const cacheAgeMs = Date.now() - this.resourceLibrariesLoadedAt;
    const cacheFresh = this.hasLoadedResourceLibraries
      && this.resourceLibrarySourceKey === sourceKey
      && cacheAgeMs < RESOURCE_LIBRARY_REVALIDATE_MS;

    if (cacheFresh) {
      return this.resourceLibraries;
    }

    if (this.resourceLibrariesLoadPromise && this.resourceLibrariesLoadSourceKey === sourceKey) {
      return this.resourceLibrariesLoadPromise;
    }

    const loadPromise = (async (): Promise<ResolvedResourceLibrary[]> => {
      // forceRefresh so library.json snapshot cache does not stick with empty child resources
      // after cloud sync fills resources.json (library.modifiedOn may be unchanged).
      const fetched = await this.fetchSettings(normalizedSourceUrls, { forceRefresh: true });

      const resourceEntries = fetched.artifacts
        .filter((entry) => entry.artifactType === 'resource-library')
        .sort((a, b) => a.source.localeCompare(b.source));

      const nextKey = resourceEntries.map((entry) => `${entry.id}:${entry.source}:${entry.modifiedOn ?? ''}`).join('|');
      if (this.resourceLibraryCacheKey === nextKey && this.resourceLibraries.length > 0) {
        this.resourceLibrarySourceKey = sourceKey;
        this.resourceLibrariesLoadedAt = Date.now();
        this.hasLoadedResourceLibraries = true;
        return this.resourceLibraries;
      }

      const settled = await Promise.allSettled(resourceEntries.map((entry) => this.resolveResourceLibrary(entry)));
      const resolved: ResolvedResourceLibrary[] = [];

      for (const result of settled) {
        if (result.status === 'fulfilled') {
          resolved.push(result.value);
        } else {
          console.warn('Failed to load resource library:', result.reason);
        }
      }

      this.resourceLibrarySourceKey = sourceKey;
      this.resourceLibraryCacheKey = nextKey;
      this.resourceLibrariesLoadedAt = Date.now();
      this.hasLoadedResourceLibraries = true;
      this.resourceLibraries = resolved;
      this.verseResourceCache.clear();
      return resolved;
    })();

    this.resourceLibrariesLoadSourceKey = sourceKey;
    this.resourceLibrariesLoadPromise = loadPromise;

    try {
      return await loadPromise;
    } finally {
      if (this.resourceLibrariesLoadPromise === loadPromise) {
        this.resourceLibrariesLoadPromise = null;
        this.resourceLibrariesLoadSourceKey = null;
      }
    }
  }

  private async resolveResourceLibrary(meta: BibleTranslationMeta): Promise<ResolvedResourceLibrary> {
    const resourcesUrl = meta.source;
    const dbKey = buildResourceLibraryDbKey(meta.id, resourcesUrl);
    const fromDb = await this.readResourceLibraryFromDatabase(dbKey);
    if (fromDb && isStoredModifiedOnCurrent(fromDb.modifiedOn, meta.modifiedOn)) {
      return {
        id: fromDb.id,
        label: fromDb.label,
        resourcesUrl: fromDb.resourcesUrl,
        configuredSourceUrl: meta.configuredSourceUrl,
        documentManifestAddress: fromDb.documentManifestAddress,
        documentStoreAddress: fromDb.documentStoreAddress,
        documentViewer: fromDb.documentViewer ?? null,
        referencesAddress: fromDb.referencesAddress,
        modifiedOn: fromDb.modifiedOn,
        documentsById: indexResourceDocuments(fromDb.documents),
        resources: fromDb.resources,
        shardCache: new Map<string, ResourceVerseEntry[]>(),
      };
    }

    const resourcesPayload = await fetchJsonPayload(resourcesUrl);
    const resourcesFile = validateResourcesFile(resourcesPayload, resourcesUrl);

    const documentManifestAddress = resolveAddress(
      readString(resourcesFile.documentManifestAddress) ?? meta.documentManifestAddress ?? 'documents.json',
      resourcesUrl
    );
    const documentStoreAddress = readString(resourcesFile.documentStoreAddress)
      ?? meta.documentStoreAddress
      ?? DEFAULT_DOCUMENT_STORE_ADDRESS;
    const documentViewer = readDocumentViewerKind(resourcesFile.documentViewer)
      ?? readDocumentViewerKind(meta.documentViewer);
    const referencesAddress = resolveAddress(readString(resourcesFile.referencesAddress) ?? meta.referencesAddress ?? 'references/', resourcesUrl);

    const documentsPayload = await fetchJsonPayload(documentManifestAddress);
    const documentsFile = validateDocumentsFile(documentsPayload, documentManifestAddress);
    const documents = parseResourceDocuments(documentsFile.documents);
    const documentsById = indexResourceDocuments(documents);
    const resources = parseManifestShards(resourcesFile);

    await this.writeResourceLibraryToDatabase({
      key: dbKey,
      id: meta.id,
      label: meta.label,
      resourcesUrl,
      documentManifestAddress,
      documentStoreAddress,
      documentViewer,
      referencesAddress,
      documents,
      resources,
      modifiedOn: meta.modifiedOn,
      fetchedAt: Date.now(),
    });

    return {
      id: meta.id,
      label: meta.label,
      resourcesUrl,
      configuredSourceUrl: meta.configuredSourceUrl,
      documentManifestAddress,
      documentStoreAddress,
      documentViewer,
      referencesAddress,
      modifiedOn: meta.modifiedOn,
      documentsById,
      resources,
      shardCache: new Map<string, ResourceVerseEntry[]>(),
    };
  }

  private async readResourceLibraryFromDatabase(key: string): Promise<StoredResourceLibrary | null> {
    const db = await this.getDatabase() as IDBPDatabase<ResourceLibraryDB>;
    const stored = await db.get('resourceLibraries', key);
    return stored ?? null;
  }

  private async writeResourceLibraryToDatabase(stored: StoredResourceLibrary): Promise<void> {
    const db = await this.getDatabase() as IDBPDatabase<ResourceLibraryDB>;
    await db.put('resourceLibraries', stored, stored.key);
  }

  private async findResourceOccurrences(
    library: ResolvedResourceLibrary,
    book: string,
    chapter: number,
    verse: number
  ): Promise<ResourceOccurrence[]> {
    const bookTokens = buildReferenceBookCandidates(book);

    const shard = findBestManifestShard(library.resources, bookTokens, chapter, verse);
    if (!shard) {
      return [];
    }

    const entries = await this.readResourceShard(library, shard.file);
    const occurrences: ResourceOccurrence[] = [];

    for (const entry of entries) {
      const parsedRef = parseReferenceRef(entry.ref);
      if (!parsedRef) {
        continue;
      }

      if (parsedRef.chapter !== chapter || parsedRef.verse !== verse) {
        continue;
      }

      const parsedBookToken = normalizeReferenceBookToken(parsedRef.bookToken);
      if (!bookTokens.some((token) => normalizeReferenceBookToken(token) === parsedBookToken)) {
        continue;
      }

      for (const hit of entry.occurrences) {
        occurrences.push({
          documentId: hit.documentId,
          page: hit.page,
          raw: entry.raw,
        });
      }
    }

    return occurrences;
  }

  private async readResourceShard(library: ResolvedResourceLibrary, shardFile: string): Promise<ResourceVerseEntry[]> {
    const cached = library.shardCache.get(shardFile);
    if (cached) {
      return cached;
    }

    const dbKey = buildResourceShardDbKey(library, shardFile);
    const fromDb = await this.readResourceShardFromDatabase(dbKey);
    if (fromDb) {
      library.shardCache.set(shardFile, fromDb.entries);
      return fromDb.entries;
    }

    const referencesBase = library.referencesAddress.endsWith('/')
      ? library.referencesAddress
      : `${library.referencesAddress}/`;
    const shardUrl = resolveAddress(shardFile, referencesBase);
    const payload = await fetchJsonPayload(shardUrl);
    const entries = parseResourceVerseEntries(payload);

    library.shardCache.set(shardFile, entries);
    await this.writeResourceShardToDatabase({
      key: dbKey,
      libraryId: library.id,
      shardFile,
      resourcesUrl: library.resourcesUrl,
      modifiedOn: library.modifiedOn,
      entries,
      fetchedAt: Date.now(),
    });
    return entries;
  }

  private async readResourceShardFromDatabase(key: string): Promise<StoredResourceShard | null> {
    const db = await this.getDatabase() as IDBPDatabase<ResourceLibraryDB>;
    const stored = await db.get('resourceShards', key);
    if (!stored) {
      return null;
    }

    // Re-parse so legacy IndexedDB rows with loose shapes stay type-safe at runtime.
    return {
      ...stored,
      entries: parseResourceVerseEntries(stored.entries),
    };
  }

  private async writeResourceShardToDatabase(stored: StoredResourceShard): Promise<void> {
    const db = await this.getDatabase() as IDBPDatabase<ResourceLibraryDB>;
    await db.put('resourceShards', stored, stored.key);
  }
}

/** Drops disabled documents and applies the user's tag edits; returns the payload untouched when neither applies. */
export function applySourcePreferencesToVersePayload(
  payload: VerseResourcesPayload,
  preferences: SourcePreferences | undefined
): VerseResourcesPayload {
  if (!hasSourcePreferences(preferences)) {
    return payload;
  }

  const disabled = new Set(preferences.disabledSourceItems);
  const documents = payload.documents
    .filter((document) => !(document.libraryKey && document.resourceKey
      && isResourceDisabled(disabled, document.libraryKey, document.resourceKey)))
    .map((document) => {
      const override = document.resourceKey ? preferences.resourceTagOverrides[document.resourceKey] : undefined;
      return override ? { ...document, tags: applyResourceTagOverride(document.tags, override) } : document;
    });

  const tags = new Set<string>();
  for (const document of documents) {
    for (const tag of document.tags) {
      tags.add(tag);
    }
  }

  return {
    ...payload,
    tags: Array.from(tags).sort((a, b) => a.localeCompare(b)),
    documents,
  };
}

export function buildResourceDocumentLinkKey(
  resourcesUrl: string,
  document: Pick<ResourceDocumentEntry, 'documentId' | 'hash'>
): ResourceDocumentLinkKey {
  return document.hash
    ? { doc: document.hash }
    : { doc: document.documentId, lib: resourcesUrlKey(resourcesUrl) };
}

async function fetchJsonPayload(sourceUrl: string): Promise<unknown> {
  const failures: string[] = [];

  for (const candidate of buildFetchUrlCandidates(sourceUrl)) {
    try {
      const response = await fetchStorageAware(candidate, { cache: 'no-cache' });
      if (!response.ok) {
        failures.push(`${candidate} -> ${response.status}`);
        continue;
      }

      return (await response.json()) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      failures.push(`${candidate} -> ${message}`);
    }
  }

  throw new Error(`Resource JSON unavailable at ${sourceUrl}: ${failures.join('; ')}`);
}

function buildReferenceBookCandidates(book: string): string[] {
  const normalizedBook = normalizeLookupBookName(book);
  const canonical = BOOK_CANONICAL_BY_ALIAS.get(normalizedBook) ?? book;
  const aliases = BOOK_ALIAS_CONFIG[canonical] ?? [];

  const candidates = new Set<string>([book, canonical, ...aliases]);

  const derived = new Set<string>();
  for (const candidate of candidates) {
    const compact = normalizeLookupBookName(candidate).replace(/\s+/g, '').toLowerCase();
    if (!compact) {
      continue;
    }

    derived.add(compact);
    if (compact.endsWith('s') && compact.length > 3) {
      derived.add(compact.slice(0, -1));
    }
    if (compact.length >= 3) {
      derived.add(compact.slice(0, 3));
    }
  }

  for (const token of derived) {
    candidates.add(token);
  }

  return Array.from(candidates).filter((entry) => entry.trim().length > 0);
}

function normalizeReferenceBookToken(bookToken: string): string {
  return normalizeLookupBookName(bookToken).replace(/\s+/g, '').toLowerCase();
}

function normalizeRefPrefix(value: string): string {
  const parts = value.split('.');
  if (parts.length === 0) {
    return '';
  }

  const [bookToken, chapter, verse] = parts;
  const normalizedBook = normalizeReferenceBookToken(bookToken ?? '');
  if (parts.length === 1) {
    return normalizedBook;
  }
  if (parts.length === 2) {
    return `${normalizedBook}.${chapter}`;
  }
  return `${normalizedBook}.${chapter}.${verse}`;
}

function findBestManifestShard(
  shards: ExportManifestShard[],
  bookTokens: string[],
  chapter: number,
  verse: number
): ExportManifestShard | undefined {
  const normalizedBookTokens = bookTokens.map((token) => normalizeReferenceBookToken(token));

  const verseTargets = normalizedBookTokens.map((token) => `${token}.${chapter}.${verse}`);
  const chapterTargets = normalizedBookTokens.map((token) => `${token}.${chapter}`);
  const bookTargets = normalizedBookTokens.map((token) => token);

  const byScope = new Map<string, ExportManifestShard>();
  for (const shard of shards) {
    byScope.set(`${shard.scope}:${normalizeRefPrefix(shard.refPrefix)}`, shard);
  }

  for (const target of verseTargets) {
    const candidate = byScope.get(`verse:${target}`);
    if (candidate) {
      return candidate;
    }
  }

  for (const target of chapterTargets) {
    const candidate = byScope.get(`chapter:${target}`);
    if (candidate) {
      return candidate;
    }
  }

  for (const target of bookTargets) {
    const candidate = byScope.get(`book:${target}`);
    if (candidate) {
      return candidate;
    }
  }

  return undefined;
}

function parseReferenceRef(ref: string): { bookToken: string; chapter: number; verse: number } | null {
  const parts = ref.split('.');
  if (parts.length < 3) {
    return null;
  }

  const verseRaw = parts.pop();
  const chapterRaw = parts.pop();
  const bookToken = parts.join('.');
  const chapter = Number(chapterRaw);
  const verse = Number(verseRaw);

  if (!bookToken || !Number.isInteger(chapter) || !Number.isInteger(verse)) {
    return null;
  }

  return { bookToken, chapter, verse };
}

function parseResourceVerseEntries(payload: unknown): ResourceVerseEntry[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  const entries: ResourceVerseEntry[] = [];
  for (const item of payload) {
    if (!isPlainObject(item)) {
      continue;
    }

    const ref = readString(item['ref']);
    if (!ref) {
      continue;
    }

    entries.push({
      ref,
      raw: readString(item['raw']),
      occurrences: parseOccurrenceItems(item['occurrences']),
    });
  }

  return entries;
}

function parseOccurrenceItems(value: unknown): Array<{ documentId: string; page: number }> {
  if (!Array.isArray(value)) {
    return [];
  }

  const occurrences: Array<{ documentId: string; page: number }> = [];
  for (const item of value) {
    if (!isPlainObject(item)) {
      continue;
    }

    const documentId = readString(item['documentId']);
    const page = Number(item['page']);
    if (!documentId || !Number.isFinite(page)) {
      continue;
    }

    occurrences.push({
      documentId,
      page: Math.floor(page),
    });
  }

  return occurrences;
}

function parseResourceDocuments(documents: unknown[]): ResourceDocumentEntry[] {
  const entries: ResourceDocumentEntry[] = [];
  const seen = new Set<string>();

  for (const item of documents) {
    const entry = readResourceDocumentEntry(item);
    if (!entry || seen.has(entry.documentId)) {
      continue;
    }

    seen.add(entry.documentId);
    entries.push(entry);
  }

  return entries;
}

function parseManifestShards(resourcesFile: ResourcesFileLike): ExportManifestShard[] {
  const shards: ExportManifestShard[] = [];
  for (const item of resourcesFile.shards) {
    if (!isPlainObject(item)) {
      continue;
    }

    const file = readString(item['file']);
    const scope = readString(item['scope']);
    const refPrefix = readString(item['refPrefix']);
    if (!file || !refPrefix || (scope !== 'book' && scope !== 'chapter' && scope !== 'verse')) {
      continue;
    }

    shards.push({ file, scope, refPrefix });
  }

  return shards;
}

function buildResourceShardDbKey(library: ResolvedResourceLibrary, shardFile: string): string {
  const sourceHash = hashText(`${library.id}|${library.resourcesUrl}|${library.modifiedOn ?? ''}`);
  return `${sourceHash}:${shardFile}`;
}

function buildResourceLibraryDbKey(libraryId: string, resourcesUrl: string): string {
  return hashText(`${libraryId}|${resourcesUrl}`);
}

function isStoredModifiedOnCurrent(storedModifiedOn: string | undefined, nextModifiedOn: string | undefined): boolean {
  if (!storedModifiedOn || !nextModifiedOn) {
    return false;
  }

  const storedTime = Date.parse(storedModifiedOn);
  const nextTime = Date.parse(nextModifiedOn);
  if (Number.isFinite(storedTime) && Number.isFinite(nextTime)) {
    return storedTime >= nextTime;
  }

  return storedModifiedOn === nextModifiedOn;
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
  return normalizeBookName(value)
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashText(value: string): string {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}
