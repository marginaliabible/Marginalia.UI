import { useCallback, useEffect, useRef } from 'react';
import { setSelectedBook, setSelectedChapter, setVerseSelection, clearVerseSelection } from '../store/slices/uiSlice';
import { useAppDispatch } from '../store/hooks';
import type { BibleData } from '../models/bible';
import { buildHashRoute, parseHashRoute, scrollToVerse } from '../App';

interface UseHashRouteSyncOptions {
  currentBible: BibleData | null;
  ready: boolean;
  selectedBook: string | null;
  selectedChapter: number;
  selectedTranslationId: string;
}

export const useHashRouteSync = ({
  currentBible,
  ready,
  selectedBook,
  selectedChapter,
  selectedTranslationId,
}: UseHashRouteSyncOptions): void => {
  const dispatch = useAppDispatch();
  const hasSyncedChapterHashRef = useRef(false);
  const suppressNextHashApplyRef = useRef(false);

  const applyHashRouteFromLocation = useCallback(async () => {
    if (typeof window === 'undefined' || !currentBible) {
      return;
    }

    const route = parseHashRoute(window.location.hash);
    if (!route) {
      return;
    }

    const book = currentBible.books.find((entry) => entry.name === route.book);
    if (!book) {
      return;
    }

    const chapterExists = book.chapters.some((entry) => entry.chapter === route.chapter);
    const nextChapter = chapterExists ? route.chapter : (book.chapters[0]?.chapter ?? 1);

    dispatch(setSelectedBook(book.name));
    dispatch(setSelectedChapter(nextChapter));

    if (route.verse) {
      const chapterEntry = book.chapters.find((entry) => entry.chapter === nextChapter);
      const verseExists = chapterEntry?.verses.some((entry) => entry.verse === route.verse) ?? false;

      if (verseExists) {
        dispatch(setVerseSelection({
          translationId: selectedTranslationId,
          verses: [route.verse],
          anchorVerse: route.verse,
        }));
        await scrollToVerse({ book: book.name, chapter: nextChapter, verse: route.verse });
        return;
      }
    }

    dispatch(clearVerseSelection());
  }, [currentBible, dispatch, selectedTranslationId]);

  useEffect(() => {
    if (!ready || !currentBible || typeof window === 'undefined') {
      return;
    }

    void applyHashRouteFromLocation();

    const handleHashChange = () => {
      if (suppressNextHashApplyRef.current) {
        suppressNextHashApplyRef.current = false;
        return;
      }

      void applyHashRouteFromLocation();
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [ready, currentBible, applyHashRouteFromLocation]);

  useEffect(() => {
    if (!ready || !selectedBook || typeof window === 'undefined') {
      return;
    }

    const parsedCurrentHash = parseHashRoute(window.location.hash);
    const keepCurrentVerseHash =
      parsedCurrentHash?.book === selectedBook
      && parsedCurrentHash.chapter === selectedChapter
      && typeof parsedCurrentHash.verse === 'number';
    if (keepCurrentVerseHash) {
      hasSyncedChapterHashRef.current = true;
      return;
    }

    const nextHash = buildHashRoute({ book: selectedBook, chapter: selectedChapter });
    if (window.location.hash === nextHash) {
      hasSyncedChapterHashRef.current = true;
      return;
    }

    if (!hasSyncedChapterHashRef.current) {
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${window.location.search}${nextHash}`
      );
      hasSyncedChapterHashRef.current = true;
      return;
    }

    suppressNextHashApplyRef.current = true;
    window.location.hash = nextHash;
  }, [ready, selectedBook, selectedChapter]);
};
