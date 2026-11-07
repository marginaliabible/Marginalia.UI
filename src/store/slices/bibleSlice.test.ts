jest.mock('../../services/bibleService', () => ({
  bibleService: {},
}));

jest.mock('../../services/searchIndexService', () => ({
  searchIndexService: {},
}));

import reducer, {
  clearVerseTabContexts,
  closeTab,
  createDeferredSearchTab,
  openHelpTab,
  openVerseTabs,
  setActiveTab,
  updateActiveVerseTabContext,
} from './bibleSlice';

const genesisOneOne = { book: 'Genesis', chapter: 1, verse: 1 };
const romansTenNine = { book: 'Romans', chapter: 10, verse: 9 };

const verseTabTypes = ['translations', 'resources', 'links'] as const;

describe('bibleSlice verse tab context', () => {
  const withVerseTabs = () => reducer(undefined, openVerseTabs({
    ...genesisOneOne,
    hasResources: true,
  }));

  it('openVerseTabs binds the clicked verse only on the active verse panel tab', () => {
    const state = withVerseTabs();
    const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
    const inactiveTabs = state.tabs.filter((tab) => (
      verseTabTypes.includes(tab.type as typeof verseTabTypes[number])
      && tab.id !== state.activeTabId
    ));

    expect(activeTab?.type).toBe('resources');
    expect(activeTab?.verseContext).toEqual(genesisOneOne);
    expect(inactiveTabs.map((tab) => tab.type).sort()).toEqual(['links', 'translations']);
    expect(inactiveTabs.every((tab) => tab.verseContext === undefined)).toBe(true);
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

  it('updateActiveVerseTabContext updates only the active verse tab', () => {
    const opened = withVerseTabs();
    const linksTab = opened.tabs.find((tab) => tab.type === 'links');
    const resourcesTab = opened.tabs.find((tab) => tab.type === 'resources');
    expect(linksTab).toBeDefined();
    expect(resourcesTab).toBeDefined();

    const withLinksActive = reducer(opened, setActiveTab({
      tabId: linksTab!.id,
      verseContext: genesisOneOne,
    }));
    const updated = reducer(withLinksActive, updateActiveVerseTabContext(romansTenNine));

    const links = updated.tabs.find((tab) => tab.type === 'links');
    const resources = updated.tabs.find((tab) => tab.type === 'resources');
    const translations = updated.tabs.find((tab) => tab.type === 'translations');

    expect(links?.verseContext).toEqual(romansTenNine);
    expect(resources?.verseContext).toEqual(genesisOneOne);
    expect(translations?.verseContext).toBeUndefined();
  });

  it('setActiveTab applies the selected verse to a newly displayed verse tab', () => {
    const opened = withVerseTabs();
    const translationsTab = opened.tabs.find((tab) => tab.type === 'translations');
    expect(translationsTab).toBeDefined();
    expect(translationsTab?.verseContext).toBeUndefined();

    const activated = reducer(opened, setActiveTab({
      tabId: translationsTab!.id,
      verseContext: romansTenNine,
    }));

    const translations = activated.tabs.find((tab) => tab.type === 'translations');
    const resources = activated.tabs.find((tab) => tab.type === 'resources');

    expect(activated.activeTabId).toBe(translationsTab!.id);
    expect(translations?.verseContext).toEqual(romansTenNine);
    expect(resources?.verseContext).toEqual(genesisOneOne);
  });

  it('openVerseTabs does not overwrite inactive tab verseContext when switching verses', () => {
    const opened = withVerseTabs();
    const translationsTab = opened.tabs.find((tab) => tab.type === 'translations');
    const withTranslationsBound = reducer(opened, setActiveTab({
      tabId: translationsTab!.id,
      verseContext: genesisOneOne,
    }));
    const backToResources = reducer(withTranslationsBound, setActiveTab({
      tabId: withTranslationsBound.tabs.find((tab) => tab.type === 'resources')!.id,
      verseContext: genesisOneOne,
    }));

    const switched = reducer(backToResources, openVerseTabs({
      ...romansTenNine,
      hasResources: true,
    }));

    const resources = switched.tabs.find((tab) => tab.type === 'resources');
    const translations = switched.tabs.find((tab) => tab.type === 'translations');

    expect(switched.activeTabId).toBe(resources?.id);
    expect(resources?.verseContext).toEqual(romansTenNine);
    expect(translations?.verseContext).toEqual(genesisOneOne);
  });

  it('closeTab binds the selected verse onto a fallback verse tab', () => {
    const opened = withVerseTabs();
    const resourcesTab = opened.tabs.find((tab) => tab.type === 'resources');
    const translationsTab = opened.tabs.find((tab) => tab.type === 'translations');
    const withTranslations = reducer(opened, setActiveTab({
      tabId: translationsTab!.id,
      verseContext: genesisOneOne,
    }));

    const closed = reducer(withTranslations, closeTab({
      tabId: translationsTab!.id,
      verseContext: romansTenNine,
    }));

    expect(closed.activeTabId).toBe(resourcesTab!.id);
    expect(closed.tabs.find((tab) => tab.type === 'resources')?.verseContext).toEqual(romansTenNine);
  });

  it('updateActiveVerseTabContext applies a multi-verse range even when the first verse is unchanged', () => {
    const opened = withVerseTabs();
    const updated = reducer(opened, updateActiveVerseTabContext({
      book: 'Genesis',
      chapter: 1,
      verse: 1,
      verses: [1, 2, 3],
    }));

    const activeTab = updated.tabs.find((tab) => tab.id === updated.activeTabId);
    expect(activeTab?.verseContext).toEqual({
      book: 'Genesis',
      chapter: 1,
      verse: 1,
      verses: [1, 2, 3],
    });
  });

  it('openVerseTabs can prefer Translations and bind a multi-verse context', () => {
    const state = reducer(undefined, openVerseTabs({
      book: 'Romans',
      chapter: 12,
      verse: 1,
      verses: [1, 2, 3],
      hasResources: true,
      preferPanel: 'translations',
    }));

    const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
    expect(activeTab?.type).toBe('translations');
    expect(activeTab?.verseContext).toEqual({
      book: 'Romans',
      chapter: 12,
      verse: 1,
      verses: [1, 2, 3],
    });
    expect(state.lastVersePanelType).toBe('translations');
  });
});

describe('bibleSlice help tab', () => {
  it('openHelpTab creates a singleton help tab and activates it', () => {
    const opened = reducer(undefined, openHelpTab());
    expect(opened.tabs.filter((tab) => tab.type === 'help')).toHaveLength(1);
    expect(opened.tabs.find((tab) => tab.id === opened.activeTabId)?.type).toBe('help');

    const again = reducer(opened, openHelpTab());
    expect(again.tabs.filter((tab) => tab.type === 'help')).toHaveLength(1);
    expect(again.activeTabId).toBe(opened.tabs.find((tab) => tab.type === 'help')?.id);
  });

  it('openHelpTab coexists with verse tabs without replacing them', () => {
    const withVerse = reducer(undefined, openVerseTabs({
      book: 'Genesis',
      chapter: 1,
      verse: 1,
      hasResources: true,
    }));
    const withHelp = reducer(withVerse, openHelpTab());

    expect(withHelp.tabs.some((tab) => tab.type === 'resources')).toBe(true);
    expect(withHelp.tabs.filter((tab) => tab.type === 'help')).toHaveLength(1);
    expect(withHelp.tabs.find((tab) => tab.id === withHelp.activeTabId)?.type).toBe('help');
  });
});

