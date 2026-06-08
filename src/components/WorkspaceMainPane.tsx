import React, { useState, useEffect, useMemo } from 'react';
import VerseDisplay from './VerseDisplay';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import {
  openTranslationsTab,
} from '../store/slices/bibleSlice';
import {
  setSelectedBook,
  setSelectedChapter,
  setVerseSelection,
  clearVerseSelection,
} from '../store/slices/uiSlice';
import { bibleService } from '../services/bibleService';
import { searchIndexService } from '../services/searchIndexService';
import { verseDomId, scrollToVerse } from '../App';
import type { BibleChapter, BibleTranslationMeta } from '../models/bible';
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
  mainPaneRef: React.RefObject<HTMLDivElement | null>;
}

type VerseSelectionMode = 'single' | 'toggle' | 'range' | 'mobile-range';

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
  mainPaneRef,
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
  } = useAppSelector((state) => state.ui);

  const [chaptersByTranslation, setChaptersByTranslation] = useState<Record<string, BibleChapter | null>>({});

  const starredTranslationIds = useMemo(() => {
    return translationRecords.filter((r) => r.starred).map((r) => r.id);
  }, [translationRecords]);

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

  // Sync cache sizes
  useEffect(() => {
    const fullTranslationWorkingSetSize = new Set([
      ...starredTranslationIds,
      selectedTranslationId,
    ]).size;

    bibleService.setFullTranslationCacheLimit(fullTranslationWorkingSetSize);
    searchIndexService.setIndexCacheLimit(Math.max(1, starredTranslationIds.length));
  }, [selectedTranslationId, starredTranslationIds]);

  // Load visible chapters for all starred translations
  useEffect(() => {
    let cancelled = false;

    const loadVisibleChapters = async () => {
      if (!selectedBook || starredTranslationIds.length === 0) {
        if (!cancelled) setChaptersByTranslation({});
        return;
      }

      const entries = await Promise.all(
        starredTranslationIds.map(async (translationId) => {
          const chapter = await bibleService.loadChapter(translationId, selectedBook, selectedChapter);
          return [translationId, chapter] as const;
        })
      );

      if (!cancelled) {
        setChaptersByTranslation(Object.fromEntries(entries));
      }
    };

    void loadVisibleChapters();
    return () => {
      cancelled = true;
    };
  }, [selectedBook, selectedChapter, starredTranslationIds]);

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

  const openVersePanel = (verse: number) => {
    if (isMobileLayout && !isPanelDetached) {
      setIsMobilePanelOpen(true);
    }

    if (selectedBook) {
      dispatch(openTranslationsTab({ book: selectedBook, chapter: selectedChapter, verse }));
    }
  };

  const handleVerseNumberClick = (verse: number) => {
    openVersePanel(verse);
  };

  const focusMainPane = () => {
    mainPaneRef.current?.focus({ preventScroll: true });
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

    if (mode === 'single') {
      dispatch(setVerseSelection({ translationId, verses: [verse], anchorVerse: verse }));
      openVersePanel(verse);
      return;
    }

    if (mode === 'toggle') {
      const currentSet = new Set(selectedVerses);
      if (selectedVerseTranslationId !== translationId) {
        dispatch(setVerseSelection({ translationId, verses: [verse], anchorVerse: verse }));
        openVersePanel(verse);
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
      } else {
        dispatch(setVerseSelection({ translationId, verses: nextVerses, anchorVerse: verse }));
      }
      openVersePanel(verse);
      return;
    }

    if (mode === 'range' || mode === 'mobile-range') {
      if (selectedVerseTranslationId && selectedVerseTranslationId !== translationId) {
        return;
      }

      const anchorVerse = selectionAnchorVerse ?? selectedVerses[0] ?? verse;
      const range = getVerseRange(anchorVerse, verse);
      dispatch(setVerseSelection({ translationId, verses: range, anchorVerse }));
      openVersePanel(verse);
    }
  };

  if (!currentBible) {
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
          {selectedBook ? (
            <VerseDisplay
              chaptersByTranslation={chaptersByTranslation}
              translationOrder={starredTranslationIds}
              translationLabels={translationLabels}
              selectedTranslationId={selectedTranslationId}
              books={currentBible.books}
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
              verseDomId={verseDomId}
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
