import { act, render, waitFor } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import uiReducer, { restoreState, setVerseSelection } from '../store/slices/uiSlice';
import { useAppSelector } from '../store/hooks';
import type { BibleData } from '../models/bible';
import { useHashRouteSync } from './useHashRouteSync';

jest.mock('../App', () => ({
  ...jest.requireActual('../App'),
  scrollToVerse: jest.fn(async () => undefined),
}));

const bible = {
  books: [
    { name: 'John', chapters: [{ chapter: 10, verses: [{ verse: 1, text: '' }] }] },
    { name: 'Romans', chapters: [{ chapter: 8, verses: [28, 29].map((verse) => ({ verse, text: '' })) }] },
  ],
} as unknown as BibleData;

function Harness() {
  const { selectedBook, selectedChapter, selectedVerses, selectedTranslationId } = useAppSelector((state) => state.ui);
  useHashRouteSync({
    currentBible: bible,
    ready: true,
    selectedBook,
    selectedChapter,
    selectedTranslationId,
    selectedVerses,
  });
  return null;
}

function renderWithSavedReference() {
  const store = configureStore({ reducer: { ui: uiReducer } });
  store.dispatch(restoreState({ selectedBook: 'John', selectedChapter: 10 }));
  render(<Provider store={store}><Harness /></Provider>);
  return store;
}

describe('useHashRouteSync', () => {
  it('keeps the incoming hash, document-link params included, over the saved reference on load', async () => {
    window.history.replaceState(null, '', '/#/Romans/8/28?doc=abc&page=12');

    const store = renderWithSavedReference();

    await waitFor(() => expect(store.getState().ui.selectedVerses).toEqual([28]));
    expect(store.getState().ui.selectedBook).toBe('Romans');
    expect(store.getState().ui.selectedChapter).toBe(8);
    expect(window.location.hash).toBe('#/Romans/8/28?doc=abc&page=12');
  });

  it('still follows later selection changes', async () => {
    window.history.replaceState(null, '', '/#/Romans/8/28?doc=abc&page=12');
    const store = renderWithSavedReference();
    await waitFor(() => expect(store.getState().ui.selectedVerses).toEqual([28]));

    act(() => {
      store.dispatch(setVerseSelection({ translationId: 'KJV', verses: [29] }));
    });

    expect(window.location.hash).toBe('#/Romans/8/29');
  });

  it('leaves a document link without a verse route in place on load', async () => {
    window.history.replaceState(null, '', '/#/?doc=abc&page=1');

    const store = renderWithSavedReference();

    await waitFor(() => expect(store.getState().ui.selectedBook).toBe('John'));
    expect(window.location.hash).toBe('#/?doc=abc&page=1');
  });

  it('follows selection changes after a document link without a verse route', async () => {
    window.history.replaceState(null, '', '/#/?doc=abc&page=1');
    const store = renderWithSavedReference();
    await waitFor(() => expect(store.getState().ui.selectedBook).toBe('John'));

    act(() => {
      store.dispatch(setVerseSelection({ translationId: 'KJV', verses: [1] }));
    });

    expect(window.location.hash).toBe('#/John/10/1');
  });
});
