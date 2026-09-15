import { useEffect, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { clearVerseTabContexts, updateActiveVerseTabContext } from '../store/slices/bibleSlice';

const isVersePanelTabType = (type: string): boolean => (
  type === 'translations' || type === 'resources' || type === 'links'
);

const locationKeyFor = (book: string | null, chapter: number): string => `${book ?? ''}::${chapter}`;

/**
 * Keep verse panel tabs aligned with the current book/chapter.
 * Search tabs and visibility-gated population are left untouched.
 */
export const useVerseTabContextSync = (): void => {
  const dispatch = useAppDispatch();
  const selectedBook = useAppSelector((state) => state.ui.selectedBook);
  const selectedChapter = useAppSelector((state) => state.ui.selectedChapter);
  const selectedVerses = useAppSelector((state) => state.ui.selectedVerses);
  const tabs = useAppSelector((state) => state.bible.tabs);
  const locationKeyRef = useRef(locationKeyFor(selectedBook, selectedChapter));

  useEffect(() => {
    const locationKey = locationKeyFor(selectedBook, selectedChapter);
    if (locationKeyRef.current === locationKey) {
      return;
    }
    locationKeyRef.current = locationKey;

    const hasVersePanelTab = tabs.some((tab) => isVersePanelTabType(tab.type));
    if (!hasVersePanelTab) {
      return;
    }

    const selectedVerse = selectedVerses.find((verse) => Number.isInteger(verse) && verse > 0);
    if (selectedBook && selectedVerse) {
      dispatch(updateActiveVerseTabContext({
        book: selectedBook,
        chapter: selectedChapter,
        verse: selectedVerse,
      }));
      return;
    }

    dispatch(clearVerseTabContexts());
  }, [dispatch, selectedBook, selectedChapter, selectedVerses, tabs]);
};
