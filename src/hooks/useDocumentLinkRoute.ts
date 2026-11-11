import { useCallback, useEffect, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { openDocumentViewer, setDocumentLinkNotice } from '../store/slices/uiSlice';
import { openVerseTabs } from '../store/slices/bibleSlice';
import { bibleService } from '../services/bibleService';
import {
  findSharedDocument,
  findSharedDocumentPageRaws,
  normalizeSharedDocumentHash,
  type SharedDocumentLookup,
} from '../services/sharedDocumentService';
import { buildMarkupDocumentShellUrl } from '../utils/resourceLibraryConfig';
import { subscriptionItemFromResource } from '../utils/accountSyncTarget';
import { routeInteraction } from '../services/windowRouting';
import type { OpenDocumentPayload } from '../models/windowMessages';
import {
  assignHashWithoutScroll,
  REOPEN_DOCUMENT_LINK_EVENT,
  parseDocumentLinkFromHash,
  parseHashRoute,
  stripDocumentLinkFromHash,
  withoutPopoutParam,
  type DocumentLinkTarget,
  type HashRouteTarget,
} from '../App';

export const DOCUMENT_LINK_NOT_FOUND_MESSAGE = "This document isn't in your libraries.";
export const DOCUMENT_LINK_UNAVAILABLE_MESSAGE = 'This document is no longer available.';
export const DOCUMENT_LINK_SIGN_IN_MESSAGE = 'Sign in to view this shared document.';
export const DOCUMENT_LINK_LOAD_FAILED_MESSAGE = "This shared document couldn't be loaded. Try again later.";

const SHARED_LOOKUP_MESSAGES: Record<Exclude<SharedDocumentLookup['status'], 'found'>, string> = {
  'not-found': DOCUMENT_LINK_UNAVAILABLE_MESSAGE,
  unauthorized: DOCUMENT_LINK_SIGN_IN_MESSAGE,
  error: DOCUMENT_LINK_LOAD_FAILED_MESSAGE,
};

type DocumentLinkTrigger = 'initial' | 'hashchange' | 'reopen';

const DOCUMENT_LINK_CLEARED_EVENT = 'marginalia:document-link-cleared';

let locallyRequestedHash: string | null = null;

/** Drops the document link from this window's URL (and any open still resolving), e.g. after the document moved away. */
export function clearDocumentLinkFromLocation(): void {
  if (typeof window === 'undefined') {
    return;
  }

  locallyRequestedHash = null;
  const hash = window.location.hash;
  const stripped = stripDocumentLinkFromHash(hash);
  if (stripped !== hash) {
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}${stripped}`
    );
  }
  window.dispatchEvent(new Event(DOCUMENT_LINK_CLEARED_EVENT));
}

/** Opens a document link in this window without offering it to another document window. */
export function openDocumentLinkHere(hash: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  locallyRequestedHash = hash;
  if (window.location.hash === hash) {
    window.dispatchEvent(new Event(REOPEN_DOCUMENT_LINK_EVENT));
  } else {
    assignHashWithoutScroll(hash);
  }
}

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

  const openFromLocation = useCallback(async (trigger: DocumentLinkTrigger) => {
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
    if (trigger !== 'reopen' && handledHashRef.current === hash) {
      return;
    }

    // Kept until this link is handled: an effect re-run can read the same hash again before its hashchange.
    const requestedHere = locallyRequestedHash === hash;
    if (!requestedHere) {
      locallyRequestedHash = null;
    }
    // A page load (bookmark, new tab) keeps its document; only clicks may send it to the document window.
    if (trigger !== 'initial' && !requestedHere) {
      const linkHash = withoutPopoutParam(hash);
      let routed = false;
      const outcome = routeInteraction(
        { kind: 'document', type: 'open-document-link', payload: { hash: linkHash } },
        () => {
          if (routed) {
            openDocumentLinkHere(linkHash);
          }
        }
      );
      routed = true;
      if (outcome !== 'local') {
        generationRef.current += 1;
        handledHashRef.current = null;
        window.history.replaceState(
          window.history.state,
          '',
          `${window.location.pathname}${window.location.search}${stripDocumentLinkFromHash(hash)}`
        );
        return;
      }
    }

    const generation = ++generationRef.current;
    const isCurrent = () => generation === generationRef.current && window.location.hash === hash;

    const resolved = await bibleService.findDocumentByLink(link, sourceUrls).catch(() => null);
    if (!isCurrent()) {
      return;
    }

    let target: Omit<OpenDocumentPayload, 'page' | 'matchRaws'>;
    let sharedPagesUrl: string | null = null;
    if (resolved) {
      target = {
        sourceUrl: resolved.viewer === 'markup' ? buildMarkupDocumentShellUrl(resolved.url) : resolved.url,
        title: resolved.title,
        kind: resolved.viewer,
        syncItem: resolved.cloudProvider ? { provider: resolved.cloudProvider, itemId: resolved.documentId } : null,
        subscriptionItem: subscriptionItemFromResource({
          cloudProvider: resolved.cloudProvider,
          libraryKey: resolved.libraryKey,
          resourceKey: resolved.resourceKey,
        }),
      };
    } else {
      // Not in the user's libraries: a content-hash link opens the rendered package straight from storage.
      const sharedHash = link.lib ? null : normalizeSharedDocumentHash(link.doc);
      const lookup: SharedDocumentLookup = sharedHash
        ? await findSharedDocument(sharedHash, sourceUrls)
        : { status: 'not-found' };
      if (!isCurrent()) {
        return;
      }

      if (lookup.status !== 'found') {
        // Left unhandled so a later sourceUrls change (e.g. a cloud library arriving after sign-in) retries.
        locallyRequestedHash = null;
        dispatch(setDocumentLinkNotice(sharedHash ? SHARED_LOOKUP_MESSAGES[lookup.status] : DOCUMENT_LINK_NOT_FOUND_MESSAGE));
        return;
      }

      sharedPagesUrl = lookup.pagesUrl;
      target = {
        sourceUrl: lookup.shellUrl,
        title: lookup.title,
        kind: 'markup',
        syncItem: null,
        subscriptionItem: null,
        shared: true,
      };
    }

    const reference = parseHashRoute(hash);
    const verseResources = reference?.verse
      ? await collectVerseResources(reference, link, sourceUrls, selectionRef.current)
      : null;
    // The user's resource shards don't index a shared document; its own page index does.
    const matchRaws = sharedPagesUrl && reference && verseResources
      ? await findSharedDocumentPageRaws(sharedPagesUrl, link.page, {
        book: reference.book,
        chapter: reference.chapter,
        verses: verseResources.verses,
      })
      : verseResources?.matchRaws ?? [];
    if (!isCurrent()) {
      return;
    }

    handledHashRef.current = hash;
    locallyRequestedHash = null;
    dispatch(setDocumentLinkNotice(null));
    // A fresh load (bookmark, new tab) has no verse tabs yet, so no side panel; the viewer's height
    // also depends on that panel. Show what a page-link click from the Resources panel shows.
    if (reference && verseResources && !hasResourcesTabRef.current) {
      const versePanel = {
        book: reference.book,
        chapter: reference.chapter,
        verse: verseResources.verses[0],
        verses: verseResources.verses,
        hasResources: verseResources.hasResources,
        preferPanel: 'resources' as const,
      };
      routeInteraction(
        { kind: 'panel', type: 'open-verse-tabs', payload: versePanel },
        () => dispatch(openVerseTabs(versePanel)),
        { silent: true }
      );
    }
    dispatch(openDocumentViewer({ ...target, page: link.page, matchRaws }));
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

    void openFromLocation('initial');

    const handleHashChange = () => {
      void openFromLocation('hashchange');
    };
    const handleReopen = () => {
      void openFromLocation('reopen');
    };
    const handleCleared = () => {
      generationRef.current += 1;
      handledHashRef.current = null;
    };

    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener(REOPEN_DOCUMENT_LINK_EVENT, handleReopen);
    window.addEventListener(DOCUMENT_LINK_CLEARED_EVENT, handleCleared);
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
      window.removeEventListener(REOPEN_DOCUMENT_LINK_EVENT, handleReopen);
      window.removeEventListener(DOCUMENT_LINK_CLEARED_EVENT, handleCleared);
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
