import { useCallback } from 'react';
import { bibleService } from '../services/bibleService';
import { routeInteraction } from '../services/windowRouting';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { openVerseTabs } from '../store/slices/bibleSlice';
import {
  closeDocumentViewer,
  setSelectedBook,
  setSelectedChapter,
  setVerseSelection,
} from '../store/slices/uiSlice';
import type { VerseContext } from '../models/tab';
import type { ShowVersesPayload } from '../models/windowMessages';
import { versesFromContext } from '../utils/selectedVerseContext';
import { scrollToVerse, VERSE_REFERENCE_SCROLL_OPTIONS } from '../App';
import type { DocumentScriptureReference } from '../utils/pageVerseReferences';
import { toVerseContext } from '../utils/pageVerseReferences';
import { useSourcePreferences } from './useSourcePreferences';

export interface ShowVersesOptions {
  /** Replayed from another window: any panel interaction it triggers routes without a toast. */
  silent?: boolean;
  /** Close this window's document viewer and scroll the Bible pane to the first verse. */
  revealInBible?: boolean;
}

/** Selects verses in this window and, when asked, opens the verse tabs on the panel. */
export function useShowVersesLocally(): (payload: ShowVersesPayload, options?: ShowVersesOptions) => Promise<void> {
  const dispatch = useAppDispatch();
  const selectedTranslationId = useAppSelector((state) => state.ui.selectedTranslationId);
  const pdfViewerOpen = useAppSelector((state) => state.ui.pdfViewer.isOpen);
  const sourceUrls = useAppSelector((state) => state.ui.sourceUrls);
  const sourcePreferences = useSourcePreferences();

  return useCallback(async ({ context, openPanel }, { silent = false, revealInBible = true } = {}) => {
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

    if (revealInBible) {
      if (pdfViewerOpen) {
        dispatch(closeDocumentViewer());
      }
      void scrollToVerse(
        { book: context.book, chapter: context.chapter, verse: firstVerse },
        VERSE_REFERENCE_SCROLL_OPTIONS
      );
    }

    if (!openPanel) {
      return;
    }

    const hasResources = await bibleService.hasResourcesForVerse(
      context.book,
      context.chapter,
      firstVerse,
      sourceUrls,
      sourcePreferences
    );
    const payload = {
      book: context.book,
      chapter: context.chapter,
      verse: firstVerse,
      verses,
      hasResources,
      preferPanel: openPanel,
    };
    routeInteraction(
      { kind: 'panel', type: 'open-verse-tabs', payload },
      () => dispatch(openVerseTabs(payload)),
      { silent }
    );
  }, [dispatch, pdfViewerOpen, selectedTranslationId, sourcePreferences, sourceUrls]);
}

/**
 * Open a document scripture citation in the Translations panel (full verse set): this window's own
 * panel, or the panel window when one is open. The Bible window is left alone. Selecting the verses
 * here drives this window's panel and, through the selection sync, the panel window.
 */
export function useOpenDocumentScriptureReference(
  onOpen?: () => void
): (reference: DocumentScriptureReference) => Promise<void> {
  const showVersesLocally = useShowVersesLocally();

  return useCallback(async (reference: DocumentScriptureReference) => {
    const context = toVerseContext(reference);
    const verses = versesFromContext(context);
    if (verses.length === 0) {
      return;
    }

    onOpen?.();
    const payload: ShowVersesPayload = { context: { ...context, verses }, openPanel: 'translations' };
    await showVersesLocally(payload, { revealInBible: false });
  }, [onOpen, showVersesLocally]);
}

/**
 * Reveal the first verse of the current panel context in the Bible pane of the Bible window, closing
 * any document it shows. Document and panel windows hand it to the Bible window (or a new Bible tab).
 */
export function useRevealVerseSelectionInBible(): (context: VerseContext) => void {
  const showVersesLocally = useShowVersesLocally();

  return useCallback((context: VerseContext) => {
    const payload: ShowVersesPayload = { context };
    routeInteraction({ kind: 'bible', type: 'show-verses', payload }, () => {
      void showVersesLocally(payload);
    });
  }, [showVersesLocally]);
}
