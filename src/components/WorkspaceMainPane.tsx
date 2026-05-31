import React, { useState, useEffect, useMemo } from 'react';
import VerseDisplay from './VerseDisplay';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import {
  openTranslationsTab,
} from '../store/slices/bibleSlice';
import {
  setSelectedBook,
  setSelectedChapter,
  setFocusVerse,
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
}

const WorkspaceMainPane: React.FC<WorkspaceMainPaneProps> = ({
  isDesktopLayout,
  isPanelDetached,
  activeWorkspacePanel,
  mainPanePercent,
  isMobileLayout,
  setIsMobilePanelOpen,
  translationMetadataById,
}) => {
  const dispatch = useAppDispatch();
  const { currentBible } = useAppSelector((state) => state.bible);
  const {
    selectedTranslationId,
    translationRecords,
    selectedBook,
    selectedChapter,
    focusVerse,
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
    dispatch(setFocusVerse(null));
    void scrollToVerse({ book: bookName, chapter: nextChapter, verse: 1 });
  };

  const handleChapterSelectionChange = (chapter: number) => {
    if (!selectedBook) return;

    const isValidChapter = selectedBookEntry?.chapters.some((entry) => entry.chapter === chapter) ?? false;
    const nextChapter = isValidChapter ? chapter : selectedBookEntry?.chapters[0]?.chapter ?? 1;

    dispatch(setSelectedChapter(nextChapter));
    dispatch(setFocusVerse(null));
    void scrollToVerse({ book: selectedBook, chapter: nextChapter, verse: 1 });
  };

  const handleVerseClick = (verse: number) => {
    if (isMobileLayout && !isPanelDetached) {
      setIsMobilePanelOpen(true);
    }

    dispatch(setFocusVerse(verse));

    if (selectedBook) {
      dispatch(openTranslationsTab({ book: selectedBook, chapter: selectedChapter, verse }));
    }
  };

  if (!currentBible) {
    return null;
  }

  return (
    <section
      className="workspace-pane workspace-main"
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
              focusVerse={focusVerse}
              onBookChange={handleBookSelectionChange}
              onChapterChange={handleChapterSelectionChange}
              onVerseClick={handleVerseClick}
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
