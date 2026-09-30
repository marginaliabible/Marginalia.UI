import { useCallback } from 'react';
import { bibleService } from '../services/bibleService';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { openVerseTabs } from '../store/slices/bibleSlice';
import {
  closeDocumentViewer,
  setSelectedBook,
  setSelectedChapter,
  setVerseSelection,
} from '../store/slices/uiSlice';
import type { VerseContext } from '../models/tab';
import { versesFromContext } from '../utils/selectedVerseContext';
import { scrollToVerse, VERSE_REFERENCE_SCROLL_OPTIONS } from '../App';
import type { DocumentScriptureReference } from '../utils/pageVerseReferences';
import { toVerseContext } from '../utils/pageVerseReferences';
import { useSourcePreferences } from './useSourcePreferences';

/**
 * Open a document scripture citation in the Translations panel (full verse set).
 */
export function useOpenDocumentScriptureReference(): (reference: DocumentScriptureReference) => Promise<void> {
  const dispatch = useAppDispatch();
  const selectedTranslationId = useAppSelector((state) => state.ui.selectedTranslationId);
  const sourceUrls = useAppSelector((state) => state.ui.sourceUrls);
  const sourcePreferences = useSourcePreferences();

  return useCallback(async (reference: DocumentScriptureReference) => {
    const context = toVerseContext(reference);
    const verses = versesFromContext(context);
    if (verses.length === 0) {
      return;
    }

    dispatch(setSelectedBook(context.book));
    dispatch(setSelectedChapter(context.chapter));
    dispatch(setVerseSelection({
      translationId: selectedTranslationId,
      verses,
      anchorVerse: verses[0],
    }));

    const hasResources = await bibleService.hasResourcesForVerse(
      context.book,
      context.chapter,
      verses[0],
      sourceUrls,
      sourcePreferences
    );

    dispatch(openVerseTabs({
      book: context.book,
      chapter: context.chapter,
      verse: verses[0],
      verses,
      hasResources,
      preferPanel: 'translations',
    }));
  }, [dispatch, selectedTranslationId, sourcePreferences, sourceUrls]);
}

/**
 * Reveal the first verse of the current panel context in the Bible pane.
 * Closes a docked document viewer when it shares the main window with the Bible.
 */
export function useRevealVerseSelectionInBible(): (context: VerseContext) => void {
  const dispatch = useAppDispatch();
  const isPanelDetached = useAppSelector((state) => state.bible.isPanelDetached);
  const pdfViewerOpen = useAppSelector((state) => state.ui.pdfViewer.isOpen);
  const selectedTranslationId = useAppSelector((state) => state.ui.selectedTranslationId);

  return useCallback((context: VerseContext) => {
    const verses = versesFromContext(context);
    const firstVerse = verses[0] ?? context.verse;
    if (!firstVerse) {
      return;
    }

    dispatch(setSelectedBook(context.book));
    dispatch(setSelectedChapter(context.chapter));
    dispatch(setVerseSelection({
      translationId: selectedTranslationId,
      verses,
      anchorVerse: firstVerse,
    }));

    // Detached popup holds the viewer beside the side panel; Bible stays in the opener.
    if (pdfViewerOpen && !isPanelDetached) {
      dispatch(closeDocumentViewer());
    }

    void scrollToVerse(
      { book: context.book, chapter: context.chapter, verse: firstVerse },
      VERSE_REFERENCE_SCROLL_OPTIONS
    );
  }, [dispatch, isPanelDetached, pdfViewerOpen, selectedTranslationId]);
}
