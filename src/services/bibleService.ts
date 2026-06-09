import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  BibleChapter,
  BibleData,
  BibleTranslationMeta,
  GitBibleState,
  SearchResultSet
} from '../models/bible';
import { SearchMatch } from '../models/bible';

interface BibleDB extends DBSchema {
  translations: {
    key: string;
    value: StoredBible;
  };
}

interface StoredBible {
  id: string;
  data: BibleData;
  source: string;
  fetchedAt: number;
}

interface CachedTranslationMeta {
  items: BibleTranslationMeta[];
  cachedAt: number;
}

interface BibleSettingsFile {
  translations?: TranslationSettingsEntry[];
}

interface TranslationSettingsEntry {
  id?: string;
  label?: string;
  location?: string;
  language?: string | string[];
}

const LOCAL_TRANSLATION_ID = 'KJV';
const BIBLE_DATA_PATH = 'data/bibles';
const SETTINGS_PATH = `${BIBLE_DATA_PATH}/_settings.json`;
const LOCAL_TRANSLATION_SOURCE = `${BIBLE_DATA_PATH}/${LOCAL_TRANSLATION_ID}.json`;
const META_CACHE_KEY = 'gitbible:translation-meta';
const STATE_CACHE_KEY = 'gitbible:state';
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
  language: 'en'
};

class BibleService {
  private dbPromise: Promise<IDBPDatabase<BibleDB>> | null = null;
  private readonly translationCache = new Map<string, BibleData>();
  private readonly chapterCache = new Map<string, BibleChapter>();
  private readonly verseCache = new Map<string, string>();
  private fullTranslationCacheLimit = DEFAULT_FULL_TRANSLATIONS_IN_MEMORY;
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
    // Expose stats on window for dev inspection
    if (typeof window !== 'undefined') {
      (window as any).__GITBIBLE_CACHE_STATS__ = () => ({
        ...this.cacheStats,
        chapterCacheSize: this.chapterCache.size,
        verseCacheSize: this.verseCache.size,
        translationCacheSize: this.translationCache.size
      });
    }
  }

  async refreshAvailableTranslations(forceRefresh = false): Promise<BibleTranslationMeta[]> {
    const cachedMeta = this.readCachedTranslationMeta();
    let result: BibleTranslationMeta[] = [DEFAULT_LOCAL_TRANSLATION];

    if (cachedMeta && !forceRefresh) {
      result = this.mergeTranslations(result, cachedMeta.items);
    }

    try {
      const settings = await this.fetchSettings();
      result = this.mergeTranslations(result, settings);
      this.writeCachedTranslationMeta(settings);
    } catch (error) {
      console.error('Failed to refresh translations:', error);
    }

    this.cacheTranslationMeta(result);
    return result;
  }

  setFullTranslationCacheLimit(limit: number): void {
    this.fullTranslationCacheLimit = Math.max(1, Math.floor(limit) || 1);
    this.pruneFullTranslationCache();
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

  private async fetchSettings(): Promise<BibleTranslationMeta[]> {
    const response = await fetch(SETTINGS_PATH, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Settings responded with ${response.status}`);
    }

    const payload = (await response.json()) as BibleSettingsFile | null;
    const entries = this.normalizeSettingsPayload(payload ?? undefined);
    return this.normalizeTranslationEntries(entries);
  }

  private normalizeSettingsPayload(payload?: BibleSettingsFile): TranslationSettingsEntry[] {
    if (!payload || typeof payload !== 'object') {
      return [];
    }

    return this.normalizeSettingsEntries(payload.translations);
  }

  private normalizeSettingsEntries(entries?: TranslationSettingsEntry[]): TranslationSettingsEntry[] {
    if (!entries) {
      return [];
    }

    if (Array.isArray(entries)) {
      return entries.filter(isTranslationSettingsEntry).map((entry) => ({ ...entry }));
    }

    if (isPlainObject(entries)) {
      return Object.entries(entries).map(([id, raw]) => {
        const entry = isTranslationSettingsEntry(raw) ? raw : {};
        return {
          ...entry,
          id: entry.id ?? id
        };
      });
    }

    return [];
  }

  private normalizeTranslationEntries(entries: TranslationSettingsEntry[]): BibleTranslationMeta[] {
    const merged = new Map<string, BibleTranslationMeta>();

    for (const entry of entries) {
      const id = (entry.id ?? '').trim();
      if (!id) {
        continue;
      }

      const source = this.normalizeSource(entry.location, id);
      const isLocal = this.isLocalSource(source);
      const meta: BibleTranslationMeta = {
        id,
        label: entry.label?.trim() || prettifyId(id),
        source,
        isLocal,
        language: entry.language
      };

      const existing = merged.get(id);
      if (existing) {
        merged.set(id, this.choosePreferredMeta(existing, meta));
      } else {
        merged.set(id, meta);
      }
    }

    if (!merged.has(LOCAL_TRANSLATION_ID)) {
      merged.set(LOCAL_TRANSLATION_ID, DEFAULT_LOCAL_TRANSLATION);
    }

    return this.sortTranslations(Array.from(merged.values()));
  }

  private normalizeSource(location: string | undefined, id: string): string {
    if (location && /^https?:\/\//i.test(location)) {
      return location;
    }

    if (location) {
      const trimmed = location.replace(/^\//, '');
      if (trimmed.startsWith(BIBLE_DATA_PATH)) {
        return trimmed;
      }
      return `${BIBLE_DATA_PATH}/${trimmed}`;
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
    const bookData = bible.books.find((entry) => entry.name === book);
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
      const remoteMeta = await this.fetchSettings();
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

  readState(): GitBibleState {
    if (typeof window === 'undefined') {
      return { lastTranslationId: LOCAL_TRANSLATION_ID, lastTranslationIds: [LOCAL_TRANSLATION_ID] };
    }

    try {
      const raw = window.localStorage.getItem(STATE_CACHE_KEY);
      if (!raw) {
        return { lastTranslationId: LOCAL_TRANSLATION_ID, lastTranslationIds: [LOCAL_TRANSLATION_ID] };
      }

      const parsed = JSON.parse(raw) as GitBibleState;
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

  persistState(update: Partial<GitBibleState>): GitBibleState {
    if (typeof window === 'undefined') {
      return { lastTranslationId: LOCAL_TRANSLATION_ID, lastTranslationIds: [LOCAL_TRANSLATION_ID] };
    }

    const current = this.readState();
    const next: GitBibleState = { ...current, ...update };
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

  private writeCachedTranslationMeta(remote: BibleTranslationMeta[]): void {
    if (typeof window === 'undefined') {
      return;
    }

    const payload: CachedTranslationMeta = {
      items: remote,
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
      this.dbPromise = openDB<BibleDB>('gitbible-db', 1, {
        upgrade(db) {
          if (!db.objectStoreNames.contains('translations')) {
            db.createObjectStore('translations');
          }
        }
      });
    }

    return this.dbPromise;
  }

  private async readFromDatabase(meta: BibleTranslationMeta): Promise<StoredBible | null> {
    const db = await this.getDatabase();
    const stored = await db.get('translations', meta.id);
    if (!stored) {
      return null;
    }

    if (!meta.isLocal) {
      const age = Date.now() - stored.fetchedAt;
      if (age > REMOTE_TTL_MS) {
        return null;
      }
    }

    return stored;
  }

  private async writeToDatabase(meta: BibleTranslationMeta, data: BibleData): Promise<void> {
    const db = await this.getDatabase();
    const stored: StoredBible = {
      id: meta.id,
      data,
      source: meta.source,
      fetchedAt: Date.now()
    };
    await db.put('translations', stored, meta.id);
  }

  private async readOrFetchTranslation(meta: BibleTranslationMeta): Promise<BibleData> {
    const fromDb = await this.readFromDatabase(meta);
    if (fromDb) {
      return fromDb.data;
    }

    const fetched = await this.fetchTranslation(meta);
    await this.writeToDatabase(meta, fetched);
    return fetched;
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

  private async fetchTranslation(meta: BibleTranslationMeta): Promise<BibleData> {
    const sources = this.buildSourceCandidates(meta);
    const failures: string[] = [];

    for (const source of sources) {
      try {
        const response = await fetch(source, {
          cache: 'no-store'
        });

        if (!response.ok) {
          failures.push(`${source} -> ${response.status}`);
          continue;
        }

        return (await response.json()) as BibleData;
      } catch (error) {
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
    candidates.add(this.buildLocalSource(meta.id));

    if (this.isLocalSource(meta.source)) {
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

function isTranslationSettingsEntry(value: unknown): value is TranslationSettingsEntry {
  return isPlainObject(value);
}

export const bibleService = new BibleService();
