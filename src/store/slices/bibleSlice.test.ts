jest.mock('../../services/bibleService', () => ({
  bibleService: {},
}));

jest.mock('../../services/searchIndexService', () => ({
  searchIndexService: {},
}));

import reducer, {
  clearVerseTabContexts,
  createDeferredSearchTab,
  openVerseTabs,
  setActiveTab,
  updateActiveVerseTabContext,
} from './bibleSlice';

const genesisOneOne = { book: 'Genesis', chapter: 1, verse: 1 };

const verseTabTypes = ['translations', 'resources', 'links'] as const;

describe('bibleSlice verse tab context', () => {
  const withVerseTabs = () => reducer(undefined, openVerseTabs({
    ...genesisOneOne,
    hasResources: true,
  }));

  it('openVerseTabs stores the clicked verse on every verse panel tab', () => {
    const state = withVerseTabs();
    const verseTabs = state.tabs.filter((tab) => verseTabTypes.includes(tab.type as typeof verseTabTypes[number]));

    expect(verseTabs.map((tab) => tab.type).sort()).toEqual(['links', 'resources', 'translations']);
    expect(verseTabs.every((tab) => tab.verseContext?.book === 'Genesis')).toBe(true);
    expect(verseTabs.every((tab) => tab.verseContext?.chapter === 1)).toBe(true);
    expect(verseTabs.every((tab) => tab.verseContext?.verse === 1)).toBe(true);
  });

  it('clearVerseTabContexts removes verseContext from verse tabs and leaves search tabs untouched', () => {
    const opened = withVerseTabs();
    const withSearch = reducer(opened, createDeferredSearchTab({
      query: 'light',
      translationIds: ['KJV'],
    }));

    const cleared = reducer(withSearch, clearVerseTabContexts());
    const verseTabs = cleared.tabs.filter((tab) => verseTabTypes.includes(tab.type as typeof verseTabTypes[number]));
    const searchTabs = cleared.tabs.filter((tab) => tab.type === 'search');

    expect(verseTabs.length).toBe(3);
    expect(verseTabs.every((tab) => tab.verseContext === undefined)).toBe(true);
    expect(searchTabs).toHaveLength(1);
    expect(searchTabs[0].title).toBe('light');
    expect(searchTabs[0].searchResults).toBeUndefined();
  });

  it('updateActiveVerseTabContext updates every verse tab, not only the active one', () => {
    const opened = withVerseTabs();
    const linksTab = opened.tabs.find((tab) => tab.type === 'links');
    expect(linksTab).toBeDefined();

    const withLinksActive = reducer(opened, setActiveTab(linksTab!.id));
    const updated = reducer(withLinksActive, updateActiveVerseTabContext({
      book: 'Psalms',
      chapter: 23,
      verse: 2,
    }));

    const verseTabs = updated.tabs.filter((tab) => verseTabTypes.includes(tab.type as typeof verseTabTypes[number]));
    expect(verseTabs.every((tab) => (
      tab.verseContext?.book === 'Psalms'
      && tab.verseContext?.chapter === 23
      && tab.verseContext?.verse === 2
    ))).toBe(true);
  });
});
