import { Injectable, signal } from '@angular/core';
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
const GITHUB_OWNER = 'scrollmapper';
const GITHUB_REPO = 'bible_databases';
const GITHUB_BRANCH = 'master';

@Injectable({ providedIn: 'root' })
export class BibleService {
  private readonly _availableTranslations = signal<BibleTranslationMeta[]>([
    DEFAULT_LOCAL_TRANSLATION
  ]);

  private readonly _currentBible = signal<BibleData | null>(null);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _searchResults = signal<SearchResultSet | null>(null);

  readonly availableTranslations = this._availableTranslations.asReadonly();
  readonly currentBible = this._currentBible.asReadonly();
  readonly isLoading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly searchResults = this._searchResults.asReadonly();

  private dbPromise: Promise<IDBPDatabase<BibleDB>> | null = null;
  private readonly translationCache = new Map<string, BibleData>();

  async refreshAvailableTranslations(forceRefresh = false): Promise<void> {
    const cachedMeta = this.readCachedTranslationMeta();
    if (cachedMeta && !forceRefresh) {
      this.mergeAndSetTranslations(cachedMeta.items);
    }

    try {
      const settings = await this.fetchSettings();
      this.mergeAndSetTranslations(settings);
      this.writeCachedTranslationMeta(settings);
    } catch (error) {
      console.error('Failed to refresh translations:', error);
    }
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

  private normalizeSettingsPayload(
    payload?: BibleSettingsFile
  ): TranslationSettingsEntry[] {
    if (!payload || typeof payload !== 'object') {
      return [];
    }

    const translations = this.normalizeSettingsEntries(payload.translations);
    return translations;
  }

  private normalizeSettingsEntries(
    entries?: TranslationSettingsEntry[]
  ): TranslationSettingsEntry[] {
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
    this._loading.set(true);
    this._error.set(null);

    try {
      const existing = this.translationCache.get(id);
      if (existing) {
        this._currentBible.set(existing);
        this.updateLabelFromBible(id, existing);
        return existing;
      }

      const meta = this._availableTranslations().find((entry) => entry.id === id);
      if (!meta) {
        throw new Error(`Unknown translation: ${id}`);
      }

      const fromDb = await this.readFromDatabase(meta);
      if (fromDb) {
        this.translationCache.set(id, fromDb.data);
        this._currentBible.set(fromDb.data);
        this.updateLabelFromBible(id, fromDb.data);
        return fromDb.data;
      }
      
      const fetched = await this.fetchTranslation(meta);
      await this.writeToDatabase(meta, fetched);
      this.translationCache.set(id, fetched);
      this._currentBible.set(fetched);
      this.updateLabelFromBible(id, fetched);
      return fetched;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load translation';
      this._error.set(message);
      throw error;
    } finally {
      this._loading.set(false);
    }
  }

  runSearch(query: string): SearchResultSet | null {
    const bible = this._currentBible();
    const normalized = query.trim();

    if (!bible || !normalized) {
      this._searchResults.set(null);
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
              matches.push(new SearchMatch(
                book.name,
                chapter.chapter,
                verse.verse,
                verse.text
              ));
            }
          }
        }
      }
    }

    const result: SearchResultSet = {
      query: normalized,
      matches,
      total: totalMatches,
      limited: matches.length < totalMatches
    };

    this._searchResults.set(result);
    return result;
  }

  clearSearch(): void {
    this._searchResults.set(null);
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

  /**
   * Persists the application state by merging the provided update with the current state
   * and storing it in localStorage.
   * 
   * @param update - Partial state object containing the properties to update
   * @returns The merged state object after persistence attempt
   * 
   * @remarks
   * - Returns a default state with LOCAL_TRANSLATION_ID if running in a server environment (window is undefined)
   * - Gracefully handles localStorage errors by logging a warning and continuing execution
   * - The returned state reflects the intended merge regardless of localStorage success/failure
   */
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

  private mergeAndSetTranslations(entries: BibleTranslationMeta[]): void {
    const mergedMap = new Map<string, BibleTranslationMeta>();

    const apply = (candidate: BibleTranslationMeta): void => {
      const existing = mergedMap.get(candidate.id);
      if (existing) {
        mergedMap.set(candidate.id, this.choosePreferredMeta(existing, candidate));
      } else {
        mergedMap.set(candidate.id, candidate);
      }
    };

    for (const entry of this._availableTranslations()) {
      apply(entry);
    }

    for (const entry of entries) {
      apply(entry);
    }

    if (!mergedMap.has(LOCAL_TRANSLATION_ID)) {
      apply(DEFAULT_LOCAL_TRANSLATION);
    }

    this._availableTranslations.set(this.sortTranslations(Array.from(mergedMap.values())));
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

  private updateLabelFromBible(id: string, bible: BibleData): void {
    const current = this._availableTranslations();
    const target = current.find((entry) => entry.id === id);
    if (!target) {
      return;
    }

    const translationLabel = bible.translation?.trim();
    if (!translationLabel || translationLabel === target.label) {
      return;
    }

    const updated = current.map((entry) =>
      entry.id === id
        ? {
            ...entry,
            label: translationLabel,
            lastFetched: Date.now()
          }
        : entry
    );

    this._availableTranslations.set(updated);
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
