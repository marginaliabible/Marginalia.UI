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
  readLibrarySourceAddresses,
  readString,
  resolveAddress,
  validateHyperlinksFile,
  validateLibraryFile,
} from '../utils/resourceLibraryConfig';
import {
  BUILT_IN_LIBRARY_KEY,
  hasSourcePreferences,
  isHyperlinkDisabled,
  type SourcePreferences,
} from '../utils/sourceSubscriptions';
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

interface HyperlinkTarget {
  sourceUrl: string;
  librarySourceUrl: string;
}

/** Subscription library key for a set: 'builtin' for the bundled file, else the saved source URL. */
export function toHyperlinkLibraryKey(set: HyperlinkSet): string {
  const library = set.librarySourceUrl ?? set.sourceUrl;
  return library === BUILT_IN_HYPERLINKS_SOURCE ? BUILT_IN_LIBRARY_KEY : library;
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

  /**
   * Built-in hyperlinks, saved hyperlinks.json URLs, and hyperlinks.json files listed in the `sources`
   * of saved library.json URLs.
   */
  async getHyperlinkSets(sourceUrls: string[] = []): Promise<HyperlinkSet[]> {
    const relevantSourceUrls = sourceUrls.filter((url) => {
      const kind = inferSourceFileKindFromUrl(url);
      return kind === 'hyperlinks' || kind === 'library';
    });
    const cacheKey = JSON.stringify(relevantSourceUrls);

    if (this.setsPromise && this.setsBySourceKey === cacheKey) {
      return this.setsPromise;
    }

    this.setsBySourceKey = cacheKey;
    this.setsPromise = this.resolveHyperlinkTargets(relevantSourceUrls)
      .then((targets) => this.loadHyperlinkSets(targets));
    return this.setsPromise;
  }

  async getHyperlinksForVerse(
    verse: VerseContext,
    sourceUrls: string[] = [],
    preferences?: SourcePreferences
  ): Promise<ResolvedHyperlink[]> {
    const sets = await this.getHyperlinkSets(sourceUrls);
    const disabled = hasSourcePreferences(preferences) ? new Set(preferences.disabledSourceItems) : null;

    return sets.flatMap((set) => {
      const libraryKey = toHyperlinkLibraryKey(set);
      return set.entries.reduce<ResolvedHyperlink[]>((accumulator, entry) => {
        if (disabled && isHyperlinkDisabled(disabled, libraryKey, entry.url)) {
          return accumulator;
        }

        const href = resolveHyperlinkTemplate(entry.url, verse);
        if (href) {
          accumulator.push({ label: entry.label, href, sourceUrl: set.sourceUrl });
        }
        return accumulator;
      }, []);
    });
  }

  private async resolveHyperlinkTargets(sourceUrls: string[]): Promise<HyperlinkTarget[]> {
    const targets: HyperlinkTarget[] = [{ sourceUrl: BUILT_IN_HYPERLINKS_SOURCE, librarySourceUrl: BUILT_IN_HYPERLINKS_SOURCE }];

    for (const sourceUrl of sourceUrls) {
      if (inferSourceFileKindFromUrl(sourceUrl) === 'hyperlinks') {
        targets.push({ sourceUrl, librarySourceUrl: sourceUrl });
        continue;
      }

      try {
        const library = validateLibraryFile(await this.fetchPayload(sourceUrl), sourceUrl);
        for (const address of readLibrarySourceAddresses(library)) {
          const childUrl = resolveAddress(address, sourceUrl);
          if (inferSourceFileKindFromUrl(childUrl) === 'hyperlinks') {
            targets.push({ sourceUrl: childUrl, librarySourceUrl: sourceUrl });
          }
        }
      } catch (error) {
        console.warn(`Failed to read hyperlink sources from ${sourceUrl}`, error);
      }
    }

    const seen = new Set<string>();
    return targets.filter((target) => {
      if (seen.has(target.sourceUrl)) {
        return false;
      }
      seen.add(target.sourceUrl);
      return true;
    });
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

  private async loadHyperlinkSets(targets: HyperlinkTarget[]): Promise<HyperlinkSet[]> {
    const sets: HyperlinkSet[] = [];

    for (const target of targets) {
      const set = await this.loadHyperlinkSet(target.sourceUrl);
      if (set) {
        sets.push({ ...set, librarySourceUrl: target.librarySourceUrl });
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
