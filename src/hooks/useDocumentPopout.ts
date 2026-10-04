import { useCallback, useEffect, useRef } from 'react';
import { useStore } from 'react-redux';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import type { RootState } from '../store/store';
import { closeDocumentViewer, openDocumentViewer } from '../store/slices/uiSlice';
import { DOCUMENT_WINDOW_NAME_PREFIX, isDocumentWindow, isPanelWindow } from '../services/windowChannel';
import { registerWindowRef, routeInteraction } from '../services/windowRouting';
import { resolveSelectedVerseContext } from '../utils/selectedVerseContext';
import type { OpenDocumentPayload } from '../models/windowMessages';
import { buildDocumentPopoutUrl, formatPopupFeatures, readPopupMetrics, resolvePopupPlacement } from '../utils/popoutWindow';
import { getScreenLayout, moveToOtherScreen, offerScreenPlacement } from '../services/screenPlacement';
import { readPopoutBounds, trackPopoutBounds } from '../utils/popoutBounds';

export const DOCUMENT_WINDOW_STATE_KEY = 'marginalia:document-window-state';
export const MAIN_PANE_ELEMENT_ID = 'workspace-main-pane';

interface DocumentWindowState {
  viewer: OpenDocumentPayload | null;
}

/** Popups inherit their opener's sessionStorage at `window.open`, which is how the document arrives. */
const readDocumentWindowState = (): DocumentWindowState | null => {
  try {
    const raw = window.sessionStorage.getItem(DOCUMENT_WINDOW_STATE_KEY);
    const parsed = raw ? JSON.parse(raw) as DocumentWindowState : null;
    return parsed && typeof parsed === 'object' && 'viewer' in parsed ? parsed : null;
  } catch {
    return null;
  }
};

const writeDocumentWindowState = (state: DocumentWindowState): void => {
  try {
    window.sessionStorage.setItem(DOCUMENT_WINDOW_STATE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or unavailable; a refresh comes back without the document.
  }
};

const clearDocumentWindowState = (): void => {
  try {
    window.sessionStorage.removeItem(DOCUMENT_WINDOW_STATE_KEY);
  } catch {
    // Storage unavailable.
  }
};

export const toOpenDocumentPayload = (viewer: RootState['ui']['pdfViewer']): OpenDocumentPayload | null => (
  viewer.isOpen && viewer.sourceUrl
    ? {
      sourceUrl: viewer.sourceUrl,
      ...(viewer.title ? { title: viewer.title } : {}),
      page: viewer.page,
      matchRaws: viewer.matchRaws,
      kind: viewer.kind,
      syncItem: viewer.syncItem,
    }
    : null
);

/** Opens the current document in its own popup window and returns this window to the Bible. */
export const usePopOutDocument = (): (() => void) => {
  const dispatch = useAppDispatch();
  const store = useStore<RootState>();

  return useCallback(() => {
    const viewer = toOpenDocumentPayload(store.getState().ui.pdfViewer);
    if (!viewer) {
      return;
    }

    const placement = resolvePopupPlacement(
      readPopupMetrics(document.getElementById(MAIN_PANE_ELEMENT_ID)),
      readPopoutBounds('document'),
      getScreenLayout()
    );
    writeDocumentWindowState({ viewer });
    let popup: Window | null = null;
    try {
      popup = window.open(
        buildDocumentPopoutUrl(window.location),
        `${DOCUMENT_WINDOW_NAME_PREFIX}${Date.now().toString(36)}`,
        formatPopupFeatures(placement)
      );
    } finally {
      clearDocumentWindowState();
    }
    if (!popup) {
      return;
    }

    const opened = popup;
    registerWindowRef(opened);
    offerScreenPlacement(placement.source === 'default' ? () => moveToOtherScreen(opened) : undefined);
    dispatch(closeDocumentViewer());
  }, [dispatch, store]);
};

/**
 * A Bible window closes its document. A document window keeps its document and shows its verse in the
 * Bible window instead (closing any document there), opening a new Bible tab when none is left.
 */
export const useBackToVerses = (): (() => void) => {
  const dispatch = useAppDispatch();
  const store = useStore<RootState>();

  return useCallback(() => {
    if (!isDocumentWindow) {
      dispatch(closeDocumentViewer());
      return;
    }

    const { selectedBook, selectedChapter, selectedVerses } = store.getState().ui;
    if (!selectedBook) {
      return;
    }
    const context = resolveSelectedVerseContext(selectedBook, selectedChapter, selectedVerses)
      ?? { book: selectedBook, chapter: selectedChapter, verse: 1 };
    routeInteraction({ kind: 'bible', type: 'show-verses', payload: { context } }, () => {});
  }, [dispatch, store]);
};

/** The next panel or document popout reopens where the user left this one. */
export const usePopoutBoundsTracking = (): void => {
  useEffect(() => {
    if (isPanelWindow) {
      return trackPopoutBounds('panel');
    }
    return isDocumentWindow ? trackPopoutBounds('document') : undefined;
  }, []);
};

/** A document popup reopens its document after a refresh, for as long as the window stays open. */
export const useDocumentPopoutWindow = ({ ready }: { ready: boolean }): void => {
  const dispatch = useAppDispatch();
  const pdfViewer = useAppSelector((state) => state.ui.pdfViewer);
  const restoredRef = useRef(false);

  useEffect(() => {
    if (!isDocumentWindow || !ready) {
      return;
    }

    if (!restoredRef.current) {
      restoredRef.current = true;
      const viewer = readDocumentWindowState()?.viewer;
      if (viewer) {
        dispatch(openDocumentViewer(viewer));
        return;
      }
    }
    writeDocumentWindowState({ viewer: toOpenDocumentPayload(pdfViewer) });
  }, [dispatch, pdfViewer, ready]);
};
