import { configureStore } from '@reduxjs/toolkit';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Provider } from 'react-redux';
import bibleReducer, {
  createDeferredSearchTab,
  openVerseTabs,
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

  it('updates verse panel context when the route changes to a verse in the new chapter', () => {
    const store = mountAtGenesis1();

    act(() => {
      store.dispatch(setSelectedChapter(2));
      store.dispatch(setVerseSelection({
        translationId: 'KJV',
        verses: [3],
        anchorVerse: 3,
      }));
    });

    const verseTabs = store.getState().bible.tabs.filter((tab) => (
      verseTabTypes.includes(tab.type as typeof verseTabTypes[number])
    ));
    expect(verseTabs.every((tab) => (
      tab.verseContext?.book === 'Genesis'
      && tab.verseContext?.chapter === 2
      && tab.verseContext?.verse === 3
    ))).toBe(true);
  });

  it('does not clear verse context when only the selected verse changes in the same chapter', () => {
    const store = mountAtGenesis1();

    act(() => {
      store.dispatch(setVerseSelection({
        translationId: 'KJV',
        verses: [4],
        anchorVerse: 4,
      }));
      store.dispatch(openVerseTabs({
        book: 'Genesis',
        chapter: 1,
        verse: 4,
        hasResources: true,
      }));
    });

    const verseTabs = store.getState().bible.tabs.filter((tab) => (
      verseTabTypes.includes(tab.type as typeof verseTabTypes[number])
    ));
    expect(verseTabs.every((tab) => tab.verseContext?.verse === 4)).toBe(true);
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
});
