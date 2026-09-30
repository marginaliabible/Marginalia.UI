import type { BibleTranslationMeta } from '../models/bible';
import type { HyperlinkSet } from '../models/hyperlink';
import type { ResourceLibraryDocumentList } from './resourceLibraryService';
import { bibleService } from './bibleService';
import { hyperlinkService, toHyperlinkLibraryKey } from './hyperlinkService';
import { fetchStorageAware } from './storageAuthenticatedFetch';
import {
  buildFetchUrlCandidates,
  inferSourceFileKindFromUrl,
  isPlainObject,
  readString,
} from '../utils/resourceLibraryConfig';
import {
  BUILT_IN_LIBRARY_KEY,
  hyperlinkItemKey,
  isOwnLibraryUrl,
  prettifySourceUrl,
  resolveLibraryKey,
  resourceDocumentKey,
  resourceItemKey,
  translationItemKey,
  type SubscriptionDocumentType,
} from '../utils/sourceSubscriptions';

export const BUILT_IN_LIBRARY_NAME = 'Built-In';

export interface SubscriptionDocument {
  /** disabledSourceItems key. */
  key: string;
  label: string;
  /** Translation id, resource document key, or hyperlink url template. */
  itemId: string;
  /** Resources only: tags supplied by the publisher, before the user's edits. */
  publisherTags?: string[];
}

export interface SubscriptionLibrary {
  /** 'builtin' or the saved source URL. */
  key: string;
  name: string;
  isBuiltIn: boolean;
  types: Partial<Record<SubscriptionDocumentType, SubscriptionDocument[]>>;
}

export interface SubscriptionCatalogInput {
  sourceUrls: string[];
  userId: string | null | undefined;
  translations: BibleTranslationMeta[];
  resourceLibraries: ResourceLibraryDocumentList[];
  hyperlinkSets: HyperlinkSet[];
  libraryNames: Record<string, string>;
}

/** Pure grouping step, separated from fetching so it can be tested without network access. */
export function buildSubscriptionCatalog(input: SubscriptionCatalogInput): SubscriptionLibrary[] {
  const subscribedUrls = input.sourceUrls.filter((url) => !isOwnLibraryUrl(url, input.userId));
  const libraries = new Map<string, SubscriptionLibrary>();
  libraries.set(BUILT_IN_LIBRARY_KEY, { key: BUILT_IN_LIBRARY_KEY, name: BUILT_IN_LIBRARY_NAME, isBuiltIn: true, types: {} });
  for (const url of subscribedUrls) {
    libraries.set(url, { key: url, name: input.libraryNames[url] || prettifySourceUrl(url), isBuiltIn: false, types: {} });
  }

  const push = (libraryKey: string, type: SubscriptionDocumentType, document: SubscriptionDocument) => {
    const library = libraries.get(libraryKey);
    if (!library) {
      return;
    }

    const documents = library.types[type] ?? [];
    if (!documents.some((existing) => existing.key === document.key)) {
      documents.push(document);
    }
    library.types[type] = documents;
  };

  for (const translation of input.translations) {
    if ((translation.artifactType ?? 'translation') !== 'translation') {
      continue;
    }

    const libraryKey = resolveLibraryKey(translation.configuredSourceUrl, input.sourceUrls);
    push(libraryKey, 'translation', {
      key: translationItemKey(libraryKey, translation.id),
      label: translation.label,
      itemId: translation.id,
    });
  }

  for (const resourceLibrary of input.resourceLibraries) {
    const libraryKey = resolveLibraryKey(resourceLibrary.configuredSourceUrl, input.sourceUrls);
    for (const document of resourceLibrary.documents) {
      const resourceKey = resourceDocumentKey(resourceLibrary.resourcesUrl, document.documentId);
      push(libraryKey, 'resource', {
        key: resourceItemKey(libraryKey, resourceKey),
        label: document.title,
        itemId: resourceKey,
        publisherTags: [...document.tags],
      });
    }
  }

  for (const set of input.hyperlinkSets) {
    const libraryKey = toHyperlinkLibraryKey(set);
    for (const entry of set.entries) {
      push(libraryKey, 'hyperlink', {
        key: hyperlinkItemKey(libraryKey, entry.url),
        label: entry.label,
        itemId: entry.url,
      });
    }
  }

  for (const library of libraries.values()) {
    for (const documents of Object.values(library.types)) {
      documents?.sort((a, b) => a.label.localeCompare(b.label));
    }
  }

  const [builtIn, ...subscribed] = Array.from(libraries.values());
  return [builtIn, ...subscribed.sort((a, b) => a.name.localeCompare(b.name))];
}

const libraryNameCache = new Map<string, string | null>();

/** The `name` field most source files carry (library.json requires it); null when unavailable. */
async function fetchLibraryName(url: string): Promise<string | null> {
  if (libraryNameCache.has(url)) {
    return libraryNameCache.get(url) ?? null;
  }

  let name: string | null = null;
  for (const candidate of buildFetchUrlCandidates(url)) {
    try {
      const response = await fetchStorageAware(candidate, { cache: 'no-store' });
      if (!response.ok) {
        continue;
      }

      const payload = (await response.json()) as unknown;
      name = isPlainObject(payload) ? readString(payload['name']) ?? null : null;
      break;
    } catch {
      // Try the next candidate.
    }
  }

  libraryNameCache.set(url, name);
  return name;
}

export async function loadSubscriptionCatalog(options: {
  sourceUrls: string[];
  userId: string | null | undefined;
  translations: BibleTranslationMeta[];
}): Promise<SubscriptionLibrary[]> {
  const subscribedUrls = options.sourceUrls.filter((url) => !isOwnLibraryUrl(url, options.userId));
  const [resourceLibraries, hyperlinkSets, names] = await Promise.all([
    bibleService.listResourceLibraryDocuments(options.sourceUrls).catch((error: unknown) => {
      console.warn('Failed to list resource documents for subscriptions', error);
      return [] as ResourceLibraryDocumentList[];
    }),
    hyperlinkService.getHyperlinkSets(options.sourceUrls).catch((error: unknown) => {
      console.warn('Failed to list hyperlinks for subscriptions', error);
      return [] as HyperlinkSet[];
    }),
    Promise.all(subscribedUrls.map(async (url) => {
      // A bare translation JSON can be megabytes; its parsed label is already known.
      if (!inferSourceFileKindFromUrl(url)) {
        const translation = options.translations.find((entry) => entry.configuredSourceUrl === url);
        return [url, translation?.label ?? null] as const;
      }
      return [url, await fetchLibraryName(url)] as const;
    })),
  ]);

  return buildSubscriptionCatalog({
    sourceUrls: options.sourceUrls,
    userId: options.userId,
    translations: options.translations,
    resourceLibraries,
    hyperlinkSets,
    libraryNames: Object.fromEntries(names.filter((entry): entry is readonly [string, string] => Boolean(entry[1]))),
  });
}
