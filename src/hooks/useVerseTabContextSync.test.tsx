jest.mock('../services/bibleService', () => ({
  bibleService: {},
}));

jest.mock('../services/searchIndexService', () => ({
  searchIndexService: {},
}));

import { configureStore } from '@reduxjs/toolkit';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Provider } from 'react-redux';
import bibleReducer, {
  createDeferredSearchTab,
  openVerseTabs,
  setActiveTab,
} from '../store/slices/bibleSlice';
import uiReducer, {
  clearVerseSelection,
  setSelectedBook,
  setSelectedChapter,
  setVerseSelection,
} from '../store/slices/uiSlice';
import { useVerseTabContextSync } from './useVerseTabContextSync';

const createTestStore = () => configureStore({
  reducer: {
    bible: bibleReducer,
    ui: uiReducer,
  },
});

type TestStore = ReturnType<typeof createTestStore>;

const wrapperFor = (store: TestStore) => function Wrapper({ children }: { children: ReactNode }) {
  return <Provider store={store}>{children}</Provider>;
};

const verseTabTypes = ['translations', 'resources', 'links'] as const;

describe('useVerseTabContextSync', () => {
  const mountAtGenesis1 = () => {
    const store = createTestStore();
    store.dispatch(setSelectedBook('Genesis'));
    store.dispatch(setSelectedChapter(1));
    renderHook(() => useVerseTabContextSync(), { wrapper: wrapperFor(store) });
    act(() => {
      store.dispatch(openVerseTabs({
        book: 'Genesis',
        chapter: 1,
        verse: 1,
        hasResources: true,
      }));
    });
    return store;
  };

  it('clears verse panel context when navigating to another chapter without a selected verse', () => {
    const store = mountAtGenesis1();

    act(() => {
      store.dispatch(setSelectedChapter(2));
      store.dispatch(clearVerseSelection());
    });

    const verseTabs = store.getState().bible.tabs.filter((tab) => (
      verseTabTypes.includes(tab.type as typeof verseTabTypes[number])
    ));
    expect(verseTabs.length).toBeGreaterThan(0);
    expect(verseTabs.every((tab) => tab.verseContext === undefined)).toBe(true);
  });

  it('updates only the active verse panel when the route changes to a verse in the new chapter', () => {
    const store = mountAtGenesis1();
    const activeTabId = store.getState().bible.activeTabId;

    act(() => {
      store.dispatch(setSelectedChapter(2));
      store.dispatch(setVerseSelection({
        translationId: 'KJV',
        verses: [3],
        anchorVerse: 3,
      }));
    });

    const tabs = store.getState().bible.tabs;
    const activeTab = tabs.find((tab) => tab.id === activeTabId);
    const inactiveTabs = tabs.filter((tab) => (
      verseTabTypes.includes(tab.type as typeof verseTabTypes[number])
      && tab.id !== activeTabId
    ));

    expect(activeTab?.type).toBe('resources');
    expect(activeTab?.verseContext).toEqual({ book: 'Genesis', chapter: 2, verse: 3 });
    expect(inactiveTabs.every((tab) => tab.verseContext === undefined)).toBe(true);
  });

  it('updates the active verse panel when only the selected verse changes in the same chapter', () => {
    const store = mountAtGenesis1();

    act(() => {
      store.dispatch(setVerseSelection({
        translationId: 'KJV',
        verses: [4],
        anchorVerse: 4,
      }));
    });

    const activeTab = store.getState().bible.tabs.find((tab) => (
      tab.id === store.getState().bible.activeTabId
    ));
    expect(activeTab?.verseContext?.verse).toBe(4);
  });

  it('updates the active verse panel when the selection expands to multiple verses', () => {
    const store = mountAtGenesis1();

    act(() => {
      store.dispatch(setVerseSelection({
        translationId: 'KJV',
        verses: [1, 2, 3],
        anchorVerse: 1,
      }));
    });

    const activeTab = store.getState().bible.tabs.find((tab) => (
      tab.id === store.getState().bible.activeTabId
    ));
    expect(activeTab?.verseContext).toEqual({
      book: 'Genesis',
      chapter: 1,
      verse: 1,
      verses: [1, 2, 3],
    });
  });

  it('does not clear verse context when selection is cleared in the same chapter', () => {
    const store = mountAtGenesis1();
    const activeTabId = store.getState().bible.activeTabId;

    act(() => {
      store.dispatch(clearVerseSelection());
    });

    const activeTab = store.getState().bible.tabs.find((tab) => tab.id === activeTabId);
    expect(activeTab?.verseContext).toEqual({ book: 'Genesis', chapter: 1, verse: 1 });
  });

  it('leaves deferred search tabs unpopulated when chapter changes', () => {
    const store = mountAtGenesis1();

    act(() => {
      store.dispatch(createDeferredSearchTab({
        query: 'light',
        translationIds: ['KJV'],
      }));
      store.dispatch(setSelectedChapter(2));
      store.dispatch(clearVerseSelection());
    });

    const searchTabs = store.getState().bible.tabs.filter((tab) => tab.type === 'search');
    expect(searchTabs).toHaveLength(1);
    expect(searchTabs[0].title).toBe('light');
    expect(searchTabs[0].searchResults).toBeUndefined();
  });

  it('keeps inactive verse tabs on their prior context until they are displayed', () => {
    const store = mountAtGenesis1();
    const translationsTab = store.getState().bible.tabs.find((tab) => tab.type === 'translations');

    act(() => {
      store.dispatch(setActiveTab({
        tabId: translationsTab!.id,
        verseContext: { book: 'Genesis', chapter: 1, verse: 1 },
      }));
      store.dispatch(setActiveTab({
        tabId: store.getState().bible.tabs.find((tab) => tab.type === 'resources')!.id,
        verseContext: { book: 'Genesis', chapter: 1, verse: 1 },
      }));
      store.dispatch(setSelectedChapter(2));
      store.dispatch(setVerseSelection({
        translationId: 'KJV',
        verses: [9],
        anchorVerse: 9,
      }));
    });

    const tabs = store.getState().bible.tabs;
    expect(tabs.find((tab) => tab.type === 'resources')?.verseContext).toEqual({
      book: 'Genesis',
      chapter: 2,
      verse: 9,
    });
    expect(tabs.find((tab) => tab.type === 'translations')?.verseContext).toEqual({
      book: 'Genesis',
      chapter: 1,
      verse: 1,
    });
  });
});
