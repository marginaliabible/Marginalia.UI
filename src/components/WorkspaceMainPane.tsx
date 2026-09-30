import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import VerseDisplay from './VerseDisplay';
import PdfViewerPane from './PdfViewerPane';
import MarkupDocumentViewer from './MarkupDocumentViewer';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import {
  openVerseTabs,
} from '../store/slices/bibleSlice';
import {
  setSelectedBook,
  setSelectedChapter,
  setVerseSelection,
  clearVerseSelection,
} from '../store/slices/uiSlice';
import { bibleService } from '../services/bibleService';
import { searchIndexService } from '../services/searchIndexService';
import { scrollToVerse } from '../App';
import type { BibleChapter, BibleTranslationMeta, QuickJumpTarget } from '../models/bible';
import { markupFlagsFromBible } from '../utils/verseMarkup';
import { useSourcePreferences } from '../hooks/useSourcePreferences';
import type { WorkspacePanelKey } from '../App';

interface WorkspaceMainPaneProps {
  isDesktopLayout: boolean;
  isPanelDetached: boolean;
  activeWorkspacePanel: WorkspacePanelKey | null;
  mainPanePercent: number;
  isMobileLayout: boolean;
  setIsMobilePanelOpen: (open: boolean) => void;
  translationMetadataById: Map<string, BibleTranslationMeta>;
  onCopySelectedVerses: () => Promise<void> | void;
  onShareCurrentVerse: () => Promise<void> | void;
  shareButtonLabel: string;
  goToReference: (target: QuickJumpTarget, translationId?: string) => Promise<void>;
  focusDetachedPanel: () => void;
  miniSearchFocusToken: number;
  isMiniSearchVisible: boolean;
  setIsMiniSearchVisible: (open: boolean) => void;
  mainPaneRef: React.RefObject<HTMLDivElement | null>;
  resourceHiddenTags: string[];
}

type VerseSelectionMode = 'single' | 'toggle' | 'range' | 'mobile-range' | 'mobile-anchor';

const getVerseRange = (start: number, end: number): number[] => {
  const min = Math.min(start, end);
  const max = Math.max(start, end);
  return Array.from({ length: max - min + 1 }, (_, index) => min + index);
};

const WorkspaceMainPane: React.FC<WorkspaceMainPaneProps> = ({
  isDesktopLayout,
  isPanelDetached,
  activeWorkspacePanel,
  mainPanePercent,
  isMobileLayout,
  setIsMobilePanelOpen,
  translationMetadataById,
  onCopySelectedVerses,
  onShareCurrentVerse,
  shareButtonLabel,
  goToReference,
  focusDetachedPanel,
  miniSearchFocusToken,
  isMiniSearchVisible,
  setIsMiniSearchVisible,
  mainPaneRef,
  resourceHiddenTags,
}) => {
  const dispatch = useAppDispatch();
  const { currentBible } = useAppSelector((state) => state.bible);
  const {
    selectedTranslationId,
    translationRecords,
    selectedBook,
    selectedChapter,
    selectedVerseTranslationId,
    selectedVerses,
    selectionAnchorVerse,
    sourceUrls,
    pdfViewer,
    translatorItalics,
    translatorParagraphMarks,
  } = useAppSelector((state) => state.ui);
  const sourcePreferences = useSourcePreferences();

  const [loadedChapterView, setLoadedChapterView] = useState<{
    book: string;
    chapter: number;
    byTranslation: Record<string, BibleChapter | null>;
    markupFlagsByTranslation: Record<string, ReturnType<typeof markupFlagsFromBible>>;
  } | null>(null);
  const [resourceVerseTagsByVerse, setResourceVerseTagsByVerse] = useState<Map<number, string[]>>(new Map());
  const keyboardCursorRef = useRef<{
    translationId: string;
    book: string;
    chapter: number;
    anchorVerse: number;
    cursorVerse: number;
  } | null>(null);

  const starredTranslationIds = useMemo(() => {
    return translationRecords.filter((r) => r.starred).map((r) => r.id);
  }, [translationRecords]);

  const chaptersByTranslation = loadedChapterView?.byTranslation ?? {};
  const markupFlagsByTranslation = loadedChapterView?.markupFlagsByTranslation ?? {};

  const selectedBookEntry = useMemo(() => {
    if (!currentBible || !selectedBook) return null;
    return currentBible.books.find((book) => book.name === selectedBook) ?? null;
  }, [currentBible, selectedBook]);

  const translationLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const translationId of starredTranslationIds) {
      const translation = translationMetadataById.get(translationId);
      labels[translationId] = translation?.label ?? translationId;
    }
    return labels;
  }, [starredTranslationIds, translationMetadataById]);

  const verseMarkupSettings = useMemo(() => ({
    italics: translatorItalics,
    paragraphMarks: translatorParagraphMarks,
  }), [translatorItalics, translatorParagraphMarks]);

  // Sync cache sizes
  useEffect(() => {
    const fullTranslationWorkingSetSize = new Set([
      ...starredTranslationIds,
      selectedTranslationId,
    ]).size;

    bibleService.setFullTranslationCacheLimit(fullTranslationWorkingSetSize);
    searchIndexService.setIndexCacheLimit(Math.max(1, starredTranslationIds.length));
  }, [selectedTranslationId, starredTranslationIds]);

  // Load visible chapters for all starred translations. Keep the previously loaded
  // chapter on screen until the new one arrives so verse DOM ids never remap onto
  // stale rows from a different book/chapter.
  useEffect(() => {
    let cancelled = false;
    const requestedBook = selectedBook;
    const requestedChapter = selectedChapter;

    const loadVisibleChapters = async () => {
      if (!requestedBook || starredTranslationIds.length === 0) {
        if (!cancelled) setLoadedChapterView(null);
        return;
      }

      const entries = await Promise.all(
        starredTranslationIds.map(async (translationId) => {
          const [chapter, bible] = await Promise.all([
            bibleService.loadChapter(translationId, requestedBook, requestedChapter),
            bibleService.loadTranslation(translationId),
          ]);
          return [translationId, chapter, markupFlagsFromBible(bible)] as const;
        })
      );

      if (!cancelled) {
        setLoadedChapterView({
          book: requestedBook,
          chapter: requestedChapter,
          byTranslation: Object.fromEntries(entries.map(([id, chapter]) => [id, chapter])),
          markupFlagsByTranslation: Object.fromEntries(entries.map(([id, , flags]) => [id, flags])),
        });
      }
    };

    void loadVisibleChapters();
    return () => {
      cancelled = true;
    };
  }, [selectedBook, selectedChapter, starredTranslationIds]);

  useEffect(() => {
    let cancelled = false;

    const loadResourceMarkers = async () => {
      const verseNumbers = selectedBookEntry?.chapters.find((entry) => entry.chapter === selectedChapter)?.verses.map((entry) => entry.verse) ?? [];

      if (!selectedBook || verseNumbers.length === 0) {
        if (!cancelled) {
          setResourceVerseTagsByVerse(new Map());
        }
        return;
      }

      const settled = await Promise.all(
        verseNumbers.map(async (verseNumber) => {
          const payload = await bibleService.getResourcesForVerse(
            selectedBook,
            selectedChapter,
            verseNumber,
            sourceUrls,
            sourcePreferences
          );
          return [verseNumber, payload.tags] as const;
        })
      );

      if (!cancelled) {
        setResourceVerseTagsByVerse(new Map(settled.filter(([, tags]) => tags.length > 0)));
      }
    };

    void loadResourceMarkers();
    return () => {
      cancelled = true;
    };
  }, [selectedBook, selectedChapter, selectedBookEntry, sourceUrls, sourcePreferences]);

  const handleBookSelectionChange = (bookName: string) => {
    const nextBook = currentBible?.books.find((book) => book.name === bookName);
    if (!nextBook) return;

    const nextChapter = nextBook.chapters[0]?.chapter ?? 1;
    dispatch(setSelectedBook(bookName));
    dispatch(setSelectedChapter(nextChapter));
    dispatch(clearVerseSelection());
    void scrollToVerse({ book: bookName, chapter: nextChapter, verse: 1 });
  };

  const handleChapterSelectionChange = (chapter: number) => {
    if (!selectedBook) return;

    const isValidChapter = selectedBookEntry?.chapters.some((entry) => entry.chapter === chapter) ?? false;
    const nextChapter = isValidChapter ? chapter : selectedBookEntry?.chapters[0]?.chapter ?? 1;

    dispatch(setSelectedChapter(nextChapter));
    dispatch(clearVerseSelection());
    void scrollToVerse({ book: selectedBook, chapter: nextChapter, verse: 1 });
  };

  const openVersePanel = (verse: number, options?: { expandMobile?: boolean }) => {
    // Ensures verse tabs exist (and expands on mobile when requested).
    // Displayed verse context is driven by selection via useVerseTabContextSync.
    if (options?.expandMobile && isMobileLayout && !isPanelDetached) {
      setIsMobilePanelOpen(true);
    }

    if (selectedBook) {
      void (async () => {
        const hasResources = await bibleService.hasResourcesForVerse(
          selectedBook,
          selectedChapter,
          verse,
          sourceUrls,
          sourcePreferences
        );
        dispatch(openVerseTabs({ book: selectedBook, chapter: selectedChapter, verse, hasResources }));
      })();
    }
  };

  const focusMainPane = () => {
    mainPaneRef.current?.focus({ preventScroll: true });
  };

  const setKeyboardCursor = (
    translationId: string,
    anchorVerse: number,
    cursorVerse: number
  ) => {
    if (!selectedBook) {
      return;
    }

    keyboardCursorRef.current = {
      translationId,
      book: selectedBook,
      chapter: selectedChapter,
      anchorVerse,
      cursorVerse,
    };
  };

  const handleVerseNumberClick = (verse: number) => {
    const translationId = selectedVerseTranslationId ?? selectedTranslationId;
    if (translationId) {
      focusMainPane();
      dispatch(setVerseSelection({ translationId, verses: [verse], anchorVerse: verse }));
      setKeyboardCursor(translationId, verse, verse);
    }
    openVersePanel(verse, { expandMobile: true });
  };

  const handleVerseCellSelect = (
    verse: number,
    translationId: string,
    mode: VerseSelectionMode
  ) => {
    focusMainPane();

    const hasSelection = selectedVerses.length > 0 && Boolean(selectedVerseTranslationId);
    const translationLocked = hasSelection && selectedVerseTranslationId !== translationId;

    if (translationLocked && mode !== 'single') {
      return;
    }

    if (mode === 'single' || mode === 'mobile-anchor') {
      dispatch(setVerseSelection({ translationId, verses: [verse], anchorVerse: verse }));
      setKeyboardCursor(translationId, verse, verse);
      if (mode === 'single') {
        // Ensure verse tabs exist; mobile expand is reserved for verse-number clicks.
        openVersePanel(verse);
      }
      return;
    }

    if (mode === 'toggle') {
      const currentSet = new Set(selectedVerses);
      if (selectedVerseTranslationId !== translationId) {
        dispatch(setVerseSelection({ translationId, verses: [verse], anchorVerse: verse }));
        setKeyboardCursor(translationId, verse, verse);
        return;
      }

      if (currentSet.has(verse)) {
        currentSet.delete(verse);
      } else {
        currentSet.add(verse);
      }

      const nextVerses = Array.from(currentSet).sort((a, b) => a - b);
      if (nextVerses.length === 0) {
        dispatch(clearVerseSelection());
        keyboardCursorRef.current = null;
      } else {
        dispatch(setVerseSelection({ translationId, verses: nextVerses, anchorVerse: verse }));
        setKeyboardCursor(translationId, verse, verse);
      }
      return;
    }

    if (mode === 'range' || mode === 'mobile-range') {
      if (selectedVerseTranslationId && selectedVerseTranslationId !== translationId) {
        return;
      }

      const anchorVerse = selectionAnchorVerse ?? selectedVerses[0] ?? verse;
      const range = getVerseRange(anchorVerse, verse);
      dispatch(setVerseSelection({ translationId, verses: range, anchorVerse }));
      setKeyboardCursor(translationId, anchorVerse, verse);

    }
  };

  useEffect(() => {
    keyboardCursorRef.current = null;
  }, [selectedBook, selectedChapter]);

  const handleArrowSelectionKey = useCallback((event: KeyboardEvent) => {
    const isArrowUp = event.key === 'ArrowUp';
    const isArrowDown = event.key === 'ArrowDown';
    if (!isArrowUp && !isArrowDown) {
      return;
    }

    if (!selectedVerseTranslationId || selectedVerses.length === 0) {
      return;
    }

    const chapter = chaptersByTranslation[selectedVerseTranslationId];
    const availableVerses = (chapter?.verses ?? []).map((entry) => entry.verse).sort((a, b) => a - b);
    if (availableVerses.length === 0) {
      return;
    }

    const availableVerseSet = new Set(availableVerses);
    const currentSelection = Array.from(new Set(selectedVerses))
      .filter((verse) => availableVerseSet.has(verse))
      .sort((a, b) => a - b);
    if (currentSelection.length === 0) {
      return;
    }

    const direction = isArrowUp ? -1 : 1;

    if (event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) {
      if (currentSelection.length !== 1 || !selectedBook) {
        return;
      }

      const currentVerse = currentSelection[0];
      const currentIndex = availableVerses.indexOf(currentVerse);
      if (currentIndex < 0) {
        return;
      }

      const nextIndex = currentIndex + direction;
      if (nextIndex < 0 || nextIndex >= availableVerses.length) {
        event.preventDefault();
        return;
      }

      const nextVerse = availableVerses[nextIndex];
      dispatch(setVerseSelection({
        translationId: selectedVerseTranslationId,
        verses: [nextVerse],
        anchorVerse: nextVerse,
      }));
      setKeyboardCursor(selectedVerseTranslationId, nextVerse, nextVerse);
      void scrollToVerse({ book: selectedBook, chapter: selectedChapter, verse: nextVerse });
      event.preventDefault();
      return;
    }

    if (!event.shiftKey || event.altKey || event.metaKey) {
      return;
    }

    if (!selectedBook) {
      return;
    }

    const anchorVerse = selectionAnchorVerse ?? currentSelection[0];
    const cursorState = keyboardCursorRef.current;
    let cursorVerse = anchorVerse;

    if (
      cursorState
      && cursorState.translationId === selectedVerseTranslationId
      && cursorState.book === selectedBook
      && cursorState.chapter === selectedChapter
    ) {
      cursorVerse = cursorState.cursorVerse;
    } else if (currentSelection.length === 1) {
      cursorVerse = currentSelection[0];
    } else {
      const minVerse = currentSelection[0];
      const maxVerse = currentSelection[currentSelection.length - 1];
      cursorVerse = Math.abs(anchorVerse - minVerse) > Math.abs(maxVerse - anchorVerse) ? minVerse : maxVerse;
    }

    const cursorIndex = availableVerses.indexOf(cursorVerse);
    if (cursorIndex < 0) {
      return;
    }

    const nextIndex = cursorIndex + direction;
    if (nextIndex < 0 || nextIndex >= availableVerses.length) {
      event.preventDefault();
      return;
    }

    const nextCursorVerse = availableVerses[nextIndex];
    const nextRange = getVerseRange(anchorVerse, nextCursorVerse);
    dispatch(setVerseSelection({
      translationId: selectedVerseTranslationId,
      verses: nextRange,
      anchorVerse,
    }));
    setKeyboardCursor(selectedVerseTranslationId, anchorVerse, nextCursorVerse);
    void scrollToVerse({ book: selectedBook, chapter: selectedChapter, verse: nextCursorVerse });
    event.preventDefault();
  }, [
    chaptersByTranslation,
    dispatch,
    selectedBook,
    selectedChapter,
    selectedVerseTranslationId,
    selectedVerses,
    selectionAnchorVerse,
    starredTranslationIds,
  ]);

  useEffect(() => {
    window.addEventListener('keydown', handleArrowSelectionKey, true);
    return () => window.removeEventListener('keydown', handleArrowSelectionKey, true);
  }, [handleArrowSelectionKey]);

  const shouldRenderDocumentViewer = pdfViewer.isOpen && !isPanelDetached;

  if (!currentBible && !shouldRenderDocumentViewer) {
    return null;
  }

  return (
    <section
      className="workspace-pane workspace-main"
      ref={mainPaneRef}
      tabIndex={-1}
      onPointerDownCapture={focusMainPane}
      style={
        isDesktopLayout && activeWorkspacePanel && !isPanelDetached
          ? { flexBasis: `${mainPanePercent}%` }
          : undefined
      }
    >
      <div className="card border-0 shadow-sm">
        <div className="card-body workspace-scroll pb-4">
          {shouldRenderDocumentViewer ? (
            pdfViewer.kind === 'markup' ? <MarkupDocumentViewer /> : <PdfViewerPane />
          ) : selectedBook ? (
            <VerseDisplay
              chaptersByTranslation={chaptersByTranslation}
              markupFlagsByTranslation={markupFlagsByTranslation}
              verseMarkupSettings={verseMarkupSettings}
              translationOrder={starredTranslationIds}
              translationLabels={translationLabels}
              selectedTranslationId={selectedTranslationId}
              books={currentBible?.books ?? []}
              availableChapters={selectedBookEntry?.chapters ?? []}
              selectedBook={selectedBook}
              selectedChapter={selectedChapter}
              isMobileLayout={isMobileLayout}
              selectedVerseTranslationId={selectedVerseTranslationId}
              selectedVerses={selectedVerses}
              selectionAnchorVerse={selectionAnchorVerse}
              onBookChange={handleBookSelectionChange}
              onChapterChange={handleChapterSelectionChange}
              onVerseNumberClick={handleVerseNumberClick}
              onVerseCellSelect={handleVerseCellSelect}
              onCopySelectedVerses={onCopySelectedVerses}
              onShareCurrentVerse={onShareCurrentVerse}
              shareButtonLabel={shareButtonLabel}
              starredTranslationIds={starredTranslationIds}
              goToReference={goToReference}
              isPanelDetached={isPanelDetached}
              focusDetachedPanel={focusDetachedPanel}
              miniSearchFocusToken={miniSearchFocusToken}
              isMiniSearchVisible={isMiniSearchVisible}
              setIsMiniSearchVisible={setIsMiniSearchVisible}
              onSearchComplete={() => setIsMiniSearchVisible(false)}
              setIsMobilePanelOpen={setIsMobilePanelOpen}
              resourceVerseTagsByVerse={resourceVerseTagsByVerse}
              resourceHiddenTags={resourceHiddenTags}
              verseDomBook={loadedChapterView?.book ?? ''}
              verseDomChapter={loadedChapterView?.chapter ?? 0}
            />
          ) : (
            <p className="text-body-secondary mb-0">Select a chapter to begin.</p>
          )}
        </div>
      </div>
    </section>
  );
};

export default WorkspaceMainPane;
