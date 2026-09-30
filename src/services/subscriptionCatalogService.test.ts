import type { BibleTranslationMeta } from '../models/bible';
import { buildSubscriptionCatalog, BUILT_IN_LIBRARY_NAME } from './subscriptionCatalogService';
import { BUILT_IN_HYPERLINKS_SOURCE } from './hyperlinkService';
import { resourceDocumentKey } from '../utils/sourceSubscriptions';

jest.mock('./bibleService', () => ({ bibleService: {} }));
jest.mock('./storageAuthenticatedFetch', () => ({ fetchStorageAware: jest.fn() }));

const PUBLISHER_URL = 'https://publisher.example/library.json';
const BIBLE_URL = 'https://bibles.example/esv.json';
const OWN_URL = 'https://storage.example.com/users/user-1/library.json';

function translation(id: string, configuredSourceUrl?: string): BibleTranslationMeta {
  return { id, label: id, source: configuredSourceUrl ?? 'data/library.json', isLocal: !configuredSourceUrl, configuredSourceUrl };
}

describe('buildSubscriptionCatalog', () => {
  const baseInput = {
    sourceUrls: [PUBLISHER_URL, BIBLE_URL, OWN_URL],
    userId: 'user-1',
    translations: [
      translation('KJV'),
      translation('ASV'),
      translation('ESV', BIBLE_URL),
      translation('NET', PUBLISHER_URL),
      translation('MINE', OWN_URL),
    ],
    resourceLibraries: [
      {
        libraryId: 'publisher-resources',
        label: 'Publisher',
        resourcesUrl: 'https://publisher.example/resources.json',
        configuredSourceUrl: PUBLISHER_URL,
        documents: [{ documentId: 'doc-1', title: 'Romans Notes', tags: ['Teaching'] }],
      },
      {
        libraryId: 'own-resources',
        label: 'Mine',
        resourcesUrl: 'https://storage.example.com/users/user-1/OneDrive/resources.json',
        configuredSourceUrl: OWN_URL,
        documents: [{ documentId: 'private', title: 'Private Sermon', tags: [] }],
      },
    ],
    hyperlinkSets: [
      { sourceUrl: BUILT_IN_HYPERLINKS_SOURCE, entries: [{ label: 'Blue Letter Bible', url: 'https://blb.example/{book}' }] },
    ],
    libraryNames: { [PUBLISHER_URL]: 'Publisher Library' },
  };

  it('lists Built-In first, then subscriptions by name, excluding the user\'s own library', () => {
    const libraries = buildSubscriptionCatalog(baseInput);

    expect(libraries.map((library) => library.name)).toEqual([BUILT_IN_LIBRARY_NAME, 'Esv', 'Publisher Library']);
    expect(libraries[0].isBuiltIn).toBe(true);
    expect(libraries.some((library) => library.key === OWN_URL)).toBe(false);
    const allLabels = libraries.flatMap((library) => Object.values(library.types).flat().map((doc) => doc!.label));
    expect(allLabels).not.toContain('MINE');
    expect(allLabels).not.toContain('Private Sermon');
  });

  it('groups each library\'s documents by type and records publisher tags for resources', () => {
    const libraries = buildSubscriptionCatalog(baseInput);
    const builtIn = libraries[0];
    const publisher = libraries.find((library) => library.key === PUBLISHER_URL)!;
    const bible = libraries.find((library) => library.key === BIBLE_URL)!;

    expect(builtIn.types.translation?.map((doc) => doc.itemId)).toEqual(['ASV', 'KJV']);
    expect(builtIn.types.hyperlink?.map((doc) => doc.key)).toEqual(['builtin|hyperlink|https://blb.example/{book}']);
    expect(builtIn.types.resource).toBeUndefined();

    const resourceKey = resourceDocumentKey('https://publisher.example/resources.json', 'doc-1');
    expect(publisher.types.translation?.map((doc) => doc.key)).toEqual([`${PUBLISHER_URL}|translation|NET`]);
    expect(publisher.types.resource).toEqual([{
      key: `${PUBLISHER_URL}|resource|${resourceKey}`,
      label: 'Romans Notes',
      itemId: resourceKey,
      publisherTags: ['Teaching'],
    }]);

    expect(Object.keys(bible.types)).toEqual(['translation']);
  });
});
