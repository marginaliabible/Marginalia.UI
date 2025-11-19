import { Injectable, signal } from '@angular/core';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  BibleData,
  BibleTranslationMeta,
  GitBibleState,
  SearchMatch,
  SearchResultSet
} from '../models/bible';

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

const LOCAL_TRANSLATION_ID = 'KJV';
const LOCAL_TRANSLATION_SOURCE = 'data/KJV.json';
const META_CACHE_KEY = 'gitbible:translation-meta';
const STATE_CACHE_KEY = 'gitbible:state';
const REMOTE_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const SEARCH_LIMIT = 100;
const META_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const GITHUB_OWNER = 'scrollmapper';
const GITHUB_REPO = 'bible_databases';
const GITHUB_BRANCH = 'master';

@Injectable({ providedIn: 'root' })
export class BibleService {
  private readonly _availableTranslations = signal<BibleTranslationMeta[]>([
    {
      id: LOCAL_TRANSLATION_ID,
      label: 'KJV (King James Version)',
      source: LOCAL_TRANSLATION_SOURCE,
      isLocal: true
    }
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
      const response = await fetch(
        'https://api.github.com/repos/scrollmapper/bible_databases/contents/formats/json',
        {
          headers: {
            Accept: 'application/vnd.github.v3+json'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`GitHub responded with ${response.status}`);
      }

      const payload = (await response.json()) as GithubContentItem[];
      const remoteTranslations = payload
        .filter((item) => item.type === 'file' && item.name.toLowerCase().endsWith('.json'))
        .map((item) => {
          const id = item.name.replace(/\.json$/i, '');
          return {
            id,
            label: prettifyId(id),
            source: item.download_url,
            isLocal: id.toUpperCase() === LOCAL_TRANSLATION_ID ? true : false
          } satisfies BibleTranslationMeta;
        })
        .filter((meta) => meta.id.toUpperCase() !== LOCAL_TRANSLATION_ID);

      this.mergeAndSetTranslations(remoteTranslations);
      this.writeCachedTranslationMeta(remoteTranslations);
    } catch (error) {
      console.error('Failed to refresh translations:', error);
    }
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
              matches.push({
                book: book.name,
                chapter: chapter.chapter,
                verse: verse.verse,
                text: verse.text
              });
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

  private mergeAndSetTranslations(remote: BibleTranslationMeta[]): void {
    const mergedMap = new Map<string, BibleTranslationMeta>();
    for (const entry of this._availableTranslations()) {
      mergedMap.set(entry.id, entry);
    }

    for (const entry of remote) {
      const existing = mergedMap.get(entry.id);
      if (existing) {
        mergedMap.set(entry.id, { ...existing, ...entry });
      } else {
        mergedMap.set(entry.id, entry);
      }
    }

    this._availableTranslations.set(Array.from(mergedMap.values()).sort((a, b) => a.id.localeCompare(b.id)));
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
    if (meta.isLocal) {
      return [meta.source];
    }

    const { owner, repo, branch, path } = this.extractRepoInfo(meta);
    const cdnPath = `${owner}/${repo}@${branch}/${path}`;
    const set = new Set<string>([
      `https://cdn.jsdelivr.net/gh/${cdnPath}`,
      `https://fastly.jsdelivr.net/gh/${cdnPath}`,
      `https://cdn.statically.io/gh/${owner}/${repo}/${branch}/${path}`,
      `https://rawcdn.githack.com/${owner}/${repo}/${branch}/${path}`,
      meta.source
    ]);

    return Array.from(set);
  }

  private extractRepoInfo(meta: BibleTranslationMeta): {
    owner: string;
    repo: string;
    branch: string;
    path: string;
  } {
    const fallback = {
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      branch: GITHUB_BRANCH,
      path: `formats/json/${meta.id}.json`
    };

    if (!meta.source.startsWith('https://raw.githubusercontent.com/')) {
      return fallback;
    }

    const trimmed = meta.source.replace('https://raw.githubusercontent.com/', '');
    const segments = trimmed.split('/');
    if (segments.length < 4) {
      return fallback;
    }

    const [owner, repo, branch, ...rest] = segments;
    const path = rest.join('/');

    if (!owner || !repo || !branch || !path) {
      return fallback;
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

interface GithubContentItem {
  name: string;
  download_url: string;
  path?: string;
  type: 'file' | 'dir';
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
