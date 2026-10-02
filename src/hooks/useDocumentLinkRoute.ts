import { useCallback, useEffect, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { openDocumentViewer, setDocumentLinkNotice } from '../store/slices/uiSlice';
import { openVerseTabs } from '../store/slices/bibleSlice';
import { bibleService } from '../services/bibleService';
import { buildMarkupDocumentShellUrl } from '../utils/resourceLibraryConfig';
import {
  REOPEN_DOCUMENT_LINK_EVENT,
  parseDocumentLinkFromHash,
  parseHashRoute,
  stripDocumentLinkFromHash,
  type DocumentLinkTarget,
  type HashRouteTarget,
} from '../App';

export const DOCUMENT_LINK_NOT_FOUND_MESSAGE = "This document isn't in your libraries.";

interface UseDocumentLinkRouteOptions {
  ready: boolean;
}

export const useDocumentLinkRoute = ({ ready }: UseDocumentLinkRouteOptions): void => {
  const dispatch = useAppDispatch();
  const { sourceUrls, selectedBook, selectedChapter, selectedVerses, pdfViewer } = useAppSelector((state) => state.ui);
  const isViewerOpen = pdfViewer.isOpen;
  const wasViewerOpenRef = useRef(isViewerOpen);
  const handledHashRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const selectionRef = useRef({ selectedBook, selectedChapter, selectedVerses });
  const hasResourcesTab = useAppSelector((state) => state.bible.tabs.some((tab) => tab.type === 'resources'));
  const hasResourcesTabRef = useRef(hasResourcesTab);

  useEffect(() => {
    selectionRef.current = { selectedBook, selectedChapter, selectedVerses };
  }, [selectedBook, selectedChapter, selectedVerses]);

  useEffect(() => {
    hasResourcesTabRef.current = hasResourcesTab;
  }, [hasResourcesTab]);

  const openFromLocation = useCallback(async (force: boolean) => {
    if (typeof window === 'undefined') {
      return;
    }

    const hash = window.location.hash;
    const link = parseDocumentLinkFromHash(hash);
    if (!link) {
      handledHashRef.current = null;
      dispatch(setDocumentLinkNotice(null));
      return;
    }
    if (!force && handledHashRef.current === hash) {
      return;
    }

    const generation = ++generationRef.current;
    const isCurrent = () => generation === generationRef.current && window.location.hash === hash;

    const resolved = await bibleService.findDocumentByLink(link, sourceUrls).catch(() => null);
    if (!isCurrent()) {
      return;
    }

    if (!resolved) {
      // Left unhandled so a later sourceUrls change (e.g. a cloud library arriving after sign-in) retries.
      dispatch(setDocumentLinkNotice(DOCUMENT_LINK_NOT_FOUND_MESSAGE));
      return;
    }

    const reference = parseHashRoute(hash);
    const verseResources = reference?.verse
      ? await collectVerseResources(reference, link, sourceUrls, selectionRef.current)
      : null;
    if (!isCurrent()) {
      return;
    }

    handledHashRef.current = hash;
    dispatch(setDocumentLinkNotice(null));
    // A fresh load (bookmark, new tab) has no verse tabs yet, so no side panel; the viewer's height
    // also depends on that panel. Show what a page-link click from the Resources panel shows.
    if (reference && verseResources && !hasResourcesTabRef.current) {
      dispatch(openVerseTabs({
        book: reference.book,
        chapter: reference.chapter,
        verse: verseResources.verses[0],
        verses: verseResources.verses,
        hasResources: verseResources.hasResources,
        preferPanel: 'resources',
      }));
    }
    const matchRaws = verseResources?.matchRaws ?? [];
    dispatch(openDocumentViewer({
      sourceUrl: resolved.viewer === 'markup' ? buildMarkupDocumentShellUrl(resolved.url) : resolved.url,
      page: link.page,
      title: resolved.title,
      matchRaws,
      kind: resolved.viewer,
      syncItem: resolved.cloudProvider ? { provider: resolved.cloudProvider, itemId: resolved.documentId } : null,
    }));
  }, [dispatch, sourceUrls]);

  // A bookmark taken after the viewer closes must not reopen it.
  useEffect(() => {
    const wasOpen = wasViewerOpenRef.current;
    wasViewerOpenRef.current = isViewerOpen;
    if (!wasOpen || isViewerOpen || typeof window === 'undefined') {
      return;
    }

    const hash = window.location.hash;
    const stripped = stripDocumentLinkFromHash(hash);
    if (stripped !== hash) {
      generationRef.current += 1;
      handledHashRef.current = null;
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${window.location.search}${stripped}`
      );
    }
  }, [isViewerOpen]);

  useEffect(() => {
    if (!ready || typeof window === 'undefined') {
      return;
    }

    void openFromLocation(false);

    const handleHashChange = () => {
      void openFromLocation(false);
    };
    const handleReopen = () => {
      void openFromLocation(true);
    };

    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener(REOPEN_DOCUMENT_LINK_EVENT, handleReopen);
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
      window.removeEventListener(REOPEN_DOCUMENT_LINK_EVENT, handleReopen);
    };
  }, [ready, openFromLocation]);
};

/**
 * Reference texts to highlight on the linked page. When the link's verse is part of the current
 * selection (a click from the Resources panel), every selected verse contributes, as before.
 */
async function collectVerseResources(
  reference: HashRouteTarget,
  link: DocumentLinkTarget,
  sourceUrls: string[],
  selection: { selectedBook: string | null; selectedChapter: number; selectedVerses: number[] }
): Promise<{ verses: number[]; matchRaws: string[]; hasResources: boolean }> {
  const routeVerse = reference.verse as number;
  const verses = selection.selectedBook === reference.book
    && selection.selectedChapter === reference.chapter
    && selection.selectedVerses.includes(routeVerse)
    ? selection.selectedVerses
    : [routeVerse];

  const payloads = await Promise.all(verses.map((verse) => (
    bibleService.getResourcesForVerse(reference.book, reference.chapter, verse, sourceUrls).catch(() => null)
  )));

  const raws = new Set<string>();
  let hasResources = false;
  for (const payload of payloads) {
    for (const document of payload?.documents ?? []) {
      hasResources = true;
      if (document.link.doc !== link.doc || (document.link.lib ?? null) !== (link.lib ?? null)) {
        continue;
      }
      for (const raw of document.pageLinks.find((pageLink) => pageLink.page === link.page)?.raws ?? []) {
        raws.add(raw);
      }
    }
  }

  return { verses, matchRaws: Array.from(raws), hasResources };
}
