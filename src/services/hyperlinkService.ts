import type { IDBPDatabase } from 'idb';
import type { HyperlinkEntry, HyperlinkSet, ResolvedHyperlink } from '../models/hyperlink';
import type { VerseContext } from '../models/tab';
import { bibleService } from './bibleService';
import { resolveHyperlinkTemplate } from '../utils/hyperlinkTemplate';
import {
  buildFetchUrlCandidates,
  inferSourceFileKindFromPayload,
  inferSourceFileKindFromUrl,
  isPlainObject,
  readString,
  validateHyperlinksFile,
} from '../utils/resourceLibraryConfig';
import { fetchStorageAware } from './storageAuthenticatedFetch';

export const BUILT_IN_HYPERLINKS_SOURCE = 'data/hyperlinks.json';

const STORE_NAME = 'hyperlinkSets';

interface StoredHyperlinkSet {
  sourceUrl: string;
  entries: HyperlinkEntry[];
  modifiedOn?: string;
  fetchedAt: number;
}

interface HyperlinkServiceDependencies {
  getDatabase: () => Promise<IDBPDatabase<any>>;
}

const readEntries = (payload: unknown): HyperlinkEntry[] => {
  const hyperlinks = isPlainObject(payload) ? payload['hyperlinks'] : null;
  if (!Array.isArray(hyperlinks)) {
    return [];
  }

  return hyperlinks.reduce<HyperlinkEntry[]>((accumulator, item) => {
    if (!isPlainObject(item)) {
      return accumulator;
    }

    const label = readString(item['label']);
    const url = readString(item['url']);
    if (label && url) {
      accumulator.push({ label, url });
    }

    return accumulator;
  }, []);
};

export class HyperlinkService {
  private readonly getDatabase: HyperlinkServiceDependencies['getDatabase'];
  private setsBySourceKey: string | null = null;
  private setsPromise: Promise<HyperlinkSet[]> | null = null;

  constructor(dependencies: HyperlinkServiceDependencies) {
    this.getDatabase = dependencies.getDatabase;
  }

  async getHyperlinkSets(sourceUrls: string[] = []): Promise<HyperlinkSet[]> {
    const hyperlinkSourceUrls = sourceUrls.filter((url) => inferSourceFileKindFromUrl(url) === 'hyperlinks');
    const cacheKey = JSON.stringify(hyperlinkSourceUrls);

    if (this.setsPromise && this.setsBySourceKey === cacheKey) {
      return this.setsPromise;
    }

    this.setsBySourceKey = cacheKey;
    this.setsPromise = this.loadHyperlinkSets([BUILT_IN_HYPERLINKS_SOURCE, ...hyperlinkSourceUrls]);
    return this.setsPromise;
  }

  async getHyperlinksForVerse(verse: VerseContext, sourceUrls: string[] = []): Promise<ResolvedHyperlink[]> {
    const sets = await this.getHyperlinkSets(sourceUrls);

    return sets.flatMap((set) =>
      set.entries.reduce<ResolvedHyperlink[]>((accumulator, entry) => {
        const href = resolveHyperlinkTemplate(entry.url, verse);
        if (href) {
          accumulator.push({ label: entry.label, href, sourceUrl: set.sourceUrl });
        }
        return accumulator;
      }, [])
    );
  }

  async purgeSource(sourceUrl: string): Promise<void> {
    this.invalidate();

    try {
      const db = await this.getDatabase();
      await db.delete(STORE_NAME, sourceUrl);
    } catch (error) {
      console.warn('Unable to purge cached hyperlinks', error);
    }
  }

  invalidate(): void {
    this.setsBySourceKey = null;
    this.setsPromise = null;
  }

  private async loadHyperlinkSets(sourceUrls: string[]): Promise<HyperlinkSet[]> {
    const sets: HyperlinkSet[] = [];

    for (const sourceUrl of sourceUrls) {
      const set = await this.loadHyperlinkSet(sourceUrl);
      if (set) {
        sets.push(set);
      }
    }

    return sets;
  }

  private async loadHyperlinkSet(sourceUrl: string): Promise<HyperlinkSet | null> {
    try {
      const payload = await this.fetchPayload(sourceUrl);
      if (inferSourceFileKindFromPayload(payload) !== 'hyperlinks') {
        throw new Error(`${sourceUrl} is not a hyperlinks source`);
      }

      const validated = validateHyperlinksFile(payload, sourceUrl);
      const set: HyperlinkSet = {
        sourceUrl,
        modifiedOn: readString(validated.modifiedOn),
        entries: readEntries(payload),
      };

      await this.writeCachedSet(set);
      return set;
    } catch (error) {
      console.warn(`Failed to load hyperlinks from ${sourceUrl}`, error);
      return this.readCachedSet(sourceUrl);
    }
  }

  private async fetchPayload(sourceUrl: string): Promise<unknown> {
    let lastStatus = 0;

    for (const candidate of buildFetchUrlCandidates(sourceUrl)) {
      const response = await fetchStorageAware(candidate, { cache: 'no-store' });
      if (response.ok) {
        return (await response.json()) as unknown;
      }

      lastStatus = response.status;
    }

    throw new Error(`${sourceUrl} responded with ${lastStatus || 404}`);
  }

  private async writeCachedSet(set: HyperlinkSet): Promise<void> {
    try {
      const db = await this.getDatabase();
      const stored: StoredHyperlinkSet = { ...set, fetchedAt: Date.now() };
      await db.put(STORE_NAME, stored, set.sourceUrl);
    } catch (error) {
      console.warn('Unable to cache hyperlinks', error);
    }
  }

  private async readCachedSet(sourceUrl: string): Promise<HyperlinkSet | null> {
    try {
      const db = await this.getDatabase();
      const stored = (await db.get(STORE_NAME, sourceUrl)) as StoredHyperlinkSet | undefined;
      return stored ? { sourceUrl, modifiedOn: stored.modifiedOn, entries: stored.entries } : null;
    } catch (error) {
      console.warn('Unable to read cached hyperlinks', error);
      return null;
    }
  }
}

export const hyperlinkService = new HyperlinkService({
  getDatabase: () => bibleService.openDatabase(),
});
