import { useEffect, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { clearVerseTabContexts, updateActiveVerseTabContext } from '../store/slices/bibleSlice';
import { resolveSelectedVerseContext, sameVerseContext } from '../utils/selectedVerseContext';

const isVersePanelTabType = (type: string): boolean => (
  type === 'translations' || type === 'resources' || type === 'links'
);

const locationKeyFor = (book: string | null, chapter: number): string => `${book ?? ''}::${chapter}`;

/**
 * Drive the active verse panel tab from the current verse selection.
 * Inactive verse tabs keep their last context until selected; search tabs and
 * visibility-gated population are left untouched.
 */
export const useVerseTabContextSync = (): void => {
  const dispatch = useAppDispatch();
  const selectedBook = useAppSelector((state) => state.ui.selectedBook);
  const selectedChapter = useAppSelector((state) => state.ui.selectedChapter);
  const selectedVerses = useAppSelector((state) => state.ui.selectedVerses);
  const hasVersePanelTab = useAppSelector((state) => (
    state.bible.tabs.some((tab) => isVersePanelTabType(tab.type))
  ));
  const activeVerseTabContext = useAppSelector((state) => {
    const activeTab = state.bible.tabs.find((tab) => tab.id === state.bible.activeTabId);
    if (!activeTab || !isVersePanelTabType(activeTab.type)) {
      return null;
    }
    return activeTab.verseContext ?? null;
  });
  const locationKeyRef = useRef(locationKeyFor(selectedBook, selectedChapter));

  useEffect(() => {
    if (!hasVersePanelTab) {
      return;
    }

    const locationKey = locationKeyFor(selectedBook, selectedChapter);
    const locationChanged = locationKeyRef.current !== locationKey;
    locationKeyRef.current = locationKey;

    const selectedVerseContext = resolveSelectedVerseContext(
      selectedBook,
      selectedChapter,
      selectedVerses
    );

    if (selectedVerseContext) {
      if (sameVerseContext(activeVerseTabContext, selectedVerseContext)) {
        return;
      }
      dispatch(updateActiveVerseTabContext(selectedVerseContext));
      return;
    }

    // Only clear when leaving a location with no selection; clearing a selection
    // in-place leaves the last panel context until a new verse is chosen.
    if (locationChanged && activeVerseTabContext) {
      dispatch(clearVerseTabContexts());
    }
  }, [
    activeVerseTabContext,
    dispatch,
    hasVersePanelTab,
    selectedBook,
    selectedChapter,
    selectedVerses,
  ]);
};
