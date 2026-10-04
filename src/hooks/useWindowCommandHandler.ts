import { useEffect, useRef } from 'react';
import { useStore } from 'react-redux';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import type { RootState } from '../store/store';
import { openVerseTabs, runPanelSearch } from '../store/slices/bibleSlice';
import { closeDocumentViewer, openDocumentViewer } from '../store/slices/uiSlice';
import { isDocumentWindow, windowChannel } from '../services/windowChannel';
import { takePendingCommand } from '../services/windowRouting';
import { focusWhenWindowActive } from '../utils/focusWhenWindowActive';
import type { QuickJumpTarget } from '../models/bible';
import type { OpenDocumentPayload, WindowCommand } from '../models/windowMessages';
import { useShowVersesLocally } from './useDocumentScriptureNavigation';
import { clearDocumentLinkFromLocation, openDocumentLinkHere } from './useDocumentLinkRoute';
import { toOpenDocumentPayload } from './useDocumentPopout';

interface UseWindowCommandHandlerOptions {
  ready: boolean;
  goToReference: (target: QuickJumpTarget, translationId?: string) => Promise<void>;
  /** Focuses this window's search box, e.g. for Ctrl+K pressed in a panel or document window. */
  focusSearch: () => void;
}

/** Applies interactions other windows routed here, without re-offering them elsewhere. */
export const useWindowCommandHandler = ({ ready, goToReference, focusSearch }: UseWindowCommandHandlerOptions): void => {
  const dispatch = useAppDispatch();
  const store = useStore<RootState>();
  const showVersesLocally = useShowVersesLocally();
  const pdfViewerOpen = useAppSelector((state) => state.ui.pdfViewer.isOpen);
  const latestRef = useRef({ goToReference, showVersesLocally, pdfViewerOpen, focusSearch });
  latestRef.current = { goToReference, showVersesLocally, pdfViewerOpen, focusSearch };
  const applyRef = useRef<((command: WindowCommand) => void) | null>(null);

  useEffect(() => {
    /** What this window showed before the latest routed document, for "Move it here" to put back. */
    let documentBeforeRoute: { viewer: OpenDocumentPayload | null } | null = null;
    let stopFocusSearch: (() => void) | null = null;
    const rememberCurrentDocument = () => {
      documentBeforeRoute = { viewer: toOpenDocumentPayload(store.getState().ui.pdfViewer) };
    };

    const apply = (command: WindowCommand) => {
      const latest = latestRef.current;
      switch (command.type) {
        case 'open-verse-tabs':
          dispatch(openVerseTabs(command.payload));
          return;
        case 'run-search':
          void dispatch(runPanelSearch(command.payload));
          return;
        case 'show-verses':
          // A document window never turns into a Bible view.
          if (!isDocumentWindow) {
            void latest.showVersesLocally(command.payload, { silent: true, revealInBible: true });
          }
          return;
        case 'go-to-reference':
          if (isDocumentWindow) {
            return;
          }
          if (latest.pdfViewerOpen) {
            dispatch(closeDocumentViewer());
          }
          void latest.goToReference(command.payload.target, command.payload.translationId);
          return;
        case 'focus-search':
          if (!isDocumentWindow) {
            stopFocusSearch?.();
            stopFocusSearch = focusWhenWindowActive(() => latestRef.current.focusSearch());
          }
          return;
        case 'open-document':
          rememberCurrentDocument();
          dispatch(openDocumentViewer(command.payload));
          return;
        case 'open-document-link':
          rememberCurrentDocument();
          openDocumentLinkHere(command.payload.hash);
          return;
      }
    };
    applyRef.current = apply;

    const stopCommands = windowChannel.on('command', ({ command }) => apply(command));
    const stopRestoreDocument = windowChannel.on('restore-document', () => {
      const previous = documentBeforeRoute?.viewer ?? null;
      documentBeforeRoute = null;
      clearDocumentLinkFromLocation();
      if (previous) {
        dispatch(openDocumentViewer(previous));
        return;
      }
      dispatch(closeDocumentViewer());
      if (isDocumentWindow) {
        // Only script-opened windows can close themselves; otherwise the empty document state stays.
        window.close();
      }
    });
    return () => {
      stopFocusSearch?.();
      applyRef.current = null;
      stopCommands();
      stopRestoreDocument();
    };
  }, [dispatch, store]);

  useEffect(() => {
    if (!ready) {
      return;
    }
    const pending = takePendingCommand();
    if (pending) {
      applyRef.current?.(pending);
    }
  }, [ready]);
};
