import { useCallback, useEffect, useRef } from 'react';
import { setSelectedBook, setSelectedChapter, setVerseSelection, clearVerseSelection } from '../store/slices/uiSlice';
import { useAppDispatch } from '../store/hooks';
import type { BibleData } from '../models/bible';
import { buildSearchHashRoute, buildHashRoute, parseHashRoute, parseSearchFromHash, scrollToVerse, VERSE_REFERENCE_SCROLL_OPTIONS } from '../App';

interface UseHashRouteSyncOptions {
  currentBible: BibleData | null;
  ready: boolean;
  selectedBook: string | null;
  selectedChapter: number;
  selectedTranslationId: string;
  selectedVerses: number[];
}

const selectionKey = (book: string | null, chapter: number, verses: number[]): string => (
  `${book ?? ''}::${chapter}::${verses.join(',')}`
);

export const useHashRouteSync = ({
  currentBible,
  ready,
  selectedBook,
  selectedChapter,
  selectedTranslationId,
  selectedVerses,
}: UseHashRouteSyncOptions): void => {
  const dispatch = useAppDispatch();
  const hasSyncedChapterHashRef = useRef(false);
  const lastSelectedChapterKeyRef = useRef<string | null>(null);
  const selectedBookRef = useRef<string | null>(selectedBook);
  const selectedChapterRef = useRef<number>(selectedChapter);
  const selectedTranslationIdRef = useRef<string>(selectedTranslationId);
  const selectedVersesRef = useRef<number[]>(selectedVerses);
  const staleSelectionRef = useRef<string | null>(null);
  const applyGenerationRef = useRef(0);

  useEffect(() => {
    selectedBookRef.current = selectedBook;
  }, [selectedBook]);

  useEffect(() => {
    selectedChapterRef.current = selectedChapter;
  }, [selectedChapter]);

  useEffect(() => {
    selectedTranslationIdRef.current = selectedTranslationId;
  }, [selectedTranslationId]);

  useEffect(() => {
    selectedVersesRef.current = selectedVerses;
  }, [selectedVerses]);

  const applyHashRouteFromLocation = useCallback(async () => {
    if (typeof window === 'undefined' || !currentBible) {
      return;
    }

    const generation = ++applyGenerationRef.current;
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
    const currentSelectedBook = selectedBookRef.current;
    const currentSelectedChapter = selectedChapterRef.current;
    const didChangeReference = currentSelectedBook !== book.name || currentSelectedChapter !== nextChapter;
    const keepsSelection = Boolean(route.verse) && !didChangeReference
      && selectedVersesRef.current.includes(route.verse as number);

    // The URL-sync effect can run in this same commit with the pre-route selection; it must not
    // overwrite the incoming hash (and its extra params, e.g. document links) with that state.
    staleSelectionRef.current = didChangeReference || (Boolean(route.verse) && !keepsSelection)
      ? selectionKey(currentSelectedBook, currentSelectedChapter, selectedVersesRef.current)
      : null;

    if (currentSelectedBook !== book.name) {
      dispatch(setSelectedBook(book.name));
    }
    if (currentSelectedChapter !== nextChapter) {
      dispatch(setSelectedChapter(nextChapter));
    }

    if (generation !== applyGenerationRef.current) {
      return;
    }

    // A Resources panel page link names the first selected verse; keep the rest of the selection in place.
    if (keepsSelection) {
      return;
    }

    if (route.verse) {
      const chapterEntry = book.chapters.find((entry) => entry.chapter === nextChapter);
      const verseExists = chapterEntry?.verses.some((entry) => entry.verse === route.verse) ?? false;

      if (verseExists) {
        dispatch(setVerseSelection({
          translationId: selectedTranslationIdRef.current,
          verses: [route.verse],
          anchorVerse: route.verse,
        }));
        await scrollToVerse(
          { book: book.name, chapter: nextChapter, verse: route.verse },
          VERSE_REFERENCE_SCROLL_OPTIONS
        );
        return;
      }
    }

    if (didChangeReference) {
      dispatch(clearVerseSelection());
    }
  }, [currentBible, dispatch]);

  useEffect(() => {
    if (!ready || !currentBible || typeof window === 'undefined') {
      return;
    }

    void applyHashRouteFromLocation();

    const handleHashChange = () => {
      void applyHashRouteFromLocation();
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [ready, currentBible, applyHashRouteFromLocation]);

  useEffect(() => {
    if (!ready || !selectedBook || typeof window === 'undefined') {
      return;
    }

    if (staleSelectionRef.current !== null) {
      if (staleSelectionRef.current === selectionKey(selectedBook, selectedChapter, selectedVerses)) {
        return;
      }
      staleSelectionRef.current = null;
    }

    const selectedVerse = selectedVerses.find((verse) => Number.isInteger(verse) && verse > 0);
    const nextChapterHash = buildHashRoute({ book: selectedBook, chapter: selectedChapter });
    const nextVerseHash = selectedVerse
      ? buildHashRoute({ book: selectedBook, chapter: selectedChapter, verse: selectedVerse }, true)
      : nextChapterHash;
    const withCurrentSearch = (hashRoute: string): string => {
      const search = parseSearchFromHash(window.location.hash);
      const route = parseHashRoute(hashRoute);
      return search && route ? buildSearchHashRoute(search, route) : hashRoute;
    };
    const nextChapterHashWithSearch = withCurrentSearch(nextChapterHash);
    const nextVerseHashWithSearch = withCurrentSearch(nextVerseHash);
    const chapterKey = `${selectedBook}::${selectedChapter}`;

    const parsedCurrentHash = parseHashRoute(window.location.hash);
    const keepCurrentVerseHash =
      parsedCurrentHash?.book === selectedBook
      && parsedCurrentHash.chapter === selectedChapter
      && parsedCurrentHash.verse === selectedVerse;
    if (keepCurrentVerseHash) {
      hasSyncedChapterHashRef.current = true;
      lastSelectedChapterKeyRef.current = chapterKey;
      return;
    }

    if (window.location.hash === nextVerseHash) {
      hasSyncedChapterHashRef.current = true;
      lastSelectedChapterKeyRef.current = chapterKey;
      return;
    }

    if (!hasSyncedChapterHashRef.current) {
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${window.location.search}${nextVerseHashWithSearch}`
      );
      hasSyncedChapterHashRef.current = true;
      lastSelectedChapterKeyRef.current = chapterKey;
      return;
    }

    const chapterChanged = lastSelectedChapterKeyRef.current !== chapterKey;

    if (chapterChanged) {
      if (window.location.hash !== nextChapterHash && window.location.hash !== nextChapterHashWithSearch) {
        // pushState avoids the native hash-assignment scroll-to-top that can fire
        // before the new chapter's late verses have mounted.
        window.history.pushState(
          window.history.state,
          '',
          `${window.location.pathname}${window.location.search}${nextChapterHashWithSearch}`
        );
      }

      if (nextVerseHash !== nextChapterHash && window.location.hash !== nextVerseHashWithSearch) {
        window.history.replaceState(
          window.history.state,
          '',
          `${window.location.pathname}${window.location.search}${nextVerseHashWithSearch}`
        );
      }

      lastSelectedChapterKeyRef.current = chapterKey;
      return;
    }

    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}${nextVerseHashWithSearch}`
    );
  }, [ready, selectedBook, selectedChapter, selectedVerses]);
};
