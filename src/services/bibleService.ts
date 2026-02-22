import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
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
const SEARCH_LIMIT = 100;
const META_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const DEFAULT_LOCAL_TRANSLATION: BibleTranslationMeta = {
  id: LOCAL_TRANSLATION_ID,
  label: 'KJV (King James Version)',
  source: LOCAL_TRANSLATION_SOURCE,
  isLocal: true,
  language: 'en'
};

class BibleService {
  private dbPromise: Promise<IDBPDatabase<BibleDB>> | null = null;
  private readonly translationCache = new Map<string, BibleData>();

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

    return result;
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
    try {
      const existing = this.translationCache.get(id);
      if (existing) {
        return existing;
      }

      const meta: BibleTranslationMeta = {
        id,
        label: id,
        source: this.buildLocalSource(id),
        isLocal: true
      };

      const fromDb = await this.readFromDatabase(meta);
      if (fromDb) {
        this.translationCache.set(id, fromDb.data);
        return fromDb.data;
      }

      const fetched = await this.fetchTranslation(meta);
      await this.writeToDatabase(meta, fetched);
      this.translationCache.set(id, fetched);
      return fetched;
    } catch (error) {
      throw error;
    }
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
      return { lastTranslationId: LOCAL_TRANSLATION_ID };
    }

    try {
      const raw = window.localStorage.getItem(STATE_CACHE_KEY);
      if (!raw) {
        return { lastTranslationId: LOCAL_TRANSLATION_ID };
      }

      const parsed = JSON.parse(raw) as GitBibleState;
      if (!parsed.lastTranslationId) {
        parsed.lastTranslationId = LOCAL_TRANSLATION_ID;
      }
      if (parsed.languages) {
        parsed.languages = Array.isArray(parsed.languages)
          ? parsed.languages.filter((entry): entry is string => typeof entry === 'string')
          : undefined;
      }
      return parsed;
    } catch (error) {
      console.warn('Failed to parse persisted state', error);
      return { lastTranslationId: LOCAL_TRANSLATION_ID };
    }
  }

  persistState(update: Partial<GitBibleState>): GitBibleState {
    if (typeof window === 'undefined') {
      return { lastTranslationId: LOCAL_TRANSLATION_ID };
    }

    const current = this.readState();
    const next: GitBibleState = { ...current, ...update };

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
