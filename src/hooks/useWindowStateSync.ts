import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useStore } from 'react-redux';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import type { RootState } from '../store/store';
import { refreshTranslations, restorePanelTabs } from '../store/slices/bibleSlice';
import {
  applySharedSettings,
  clearVerseSelection,
  setSelectedBook,
  setSelectedChapter,
  setVerseSelection,
} from '../store/slices/uiSlice';
import { hyperlinkService } from '../services/hyperlinkService';
import { useChannelWindows, windowChannel } from '../services/windowChannel';
import type { PanelHandoffState, SharedSelection, SharedSettings, WindowInfo } from '../models/windowMessages';

export const PANEL_WINDOW_STATE_KEY = 'marginalia:panel-window-state';

export const buildPanelHandoff = (state: RootState): PanelHandoffState => ({
  tabs: state.bible.tabs,
  activeTabId: state.bible.activeTabId,
  lastVersePanelType: state.bible.lastVersePanelType,
  selection: {
    book: state.ui.selectedBook,
    chapter: state.ui.selectedChapter,
    verses: state.ui.selectedVerses,
    translationId: state.ui.selectedVerseTranslationId ?? state.ui.selectedTranslationId,
  },
});

const mostRecentOfType = (windows: readonly WindowInfo[], type: WindowInfo['type']): WindowInfo | null => (
  windows
    .filter((entry) => entry.type === type)
    .reduce<WindowInfo | null>(
      (best, entry) => (!best || entry.lastFocusedAt > best.lastFocusedAt ? entry : best),
      null
    )
);

/**
 * Where the panel window's tabs come from and go back to: the window that opened it while that is still
 * open, otherwise the most recently focused Bible window, otherwise a document window.
 */
export const panelHomeWindow = (windows: readonly WindowInfo[], openerId: string | null): WindowInfo | null => (
  windows.find((entry) => entry.id === openerId && entry.type !== 'panel')
  ?? mostRecentOfType(windows, 'bible')
  ?? mostRecentOfType(windows, 'document')
);

const readStoredPanelState = (): PanelHandoffState | null => {
  try {
    const raw = window.sessionStorage.getItem(PANEL_WINDOW_STATE_KEY);
    const parsed = raw ? JSON.parse(raw) as PanelHandoffState : null;
    return parsed && Array.isArray(parsed.tabs) ? parsed : null;
  } catch {
    return null;
  }
};

/**
 * Keeps each window's independent store in step with the others: shared settings everywhere,
 * the regular tabs' verse selection in the panel window, and the panel's tabs when it pops out or docks.
 */
export const useWindowStateSync = ({ ready }: { ready: boolean }): void => {
  const dispatch = useAppDispatch();
  const store = useStore<RootState>();
  const windows = useChannelWindows();
  const ui = useAppSelector((state) => state.ui);
  const tabs = useAppSelector((state) => state.bible.tabs);
  const activeTabId = useAppSelector((state) => state.bible.activeTabId);
  const lastSettingsJsonRef = useRef<string | null>(null);
  const restoredFromSessionRef = useRef(false);
  const requestedPanelStateRef = useRef(false);

  const settings = useMemo<SharedSettings>(() => ({
    translationRecords: ui.translationRecords,
    selectedLanguages: ui.selectedLanguages,
    sourceUrls: ui.sourceUrls,
    sourceUrlAddedAt: ui.sourceUrlAddedAt,
    sourceUrlTombstones: ui.sourceUrlTombstones,
    disabledSourceItems: ui.disabledSourceItems,
    resourceTagOverrides: ui.resourceTagOverrides,
    resourceHiddenTags: ui.resourceHiddenTags,
    theme: ui.theme,
    translatorItalics: ui.translatorItalics,
    translatorParagraphMarks: ui.translatorParagraphMarks,
  }), [
    ui.translationRecords,
    ui.selectedLanguages,
    ui.sourceUrls,
    ui.sourceUrlAddedAt,
    ui.sourceUrlTombstones,
    ui.disabledSourceItems,
    ui.resourceTagOverrides,
    ui.resourceHiddenTags,
    ui.theme,
    ui.translatorItalics,
    ui.translatorParagraphMarks,
  ]);

  const applySelection = useCallback((selection: SharedSelection) => {
    dispatch(setSelectedBook(selection.book));
    dispatch(setSelectedChapter(selection.chapter));
    if (selection.verses.length > 0) {
      dispatch(setVerseSelection({
        translationId: selection.translationId,
        verses: selection.verses,
        anchorVerse: selection.verses[0],
      }));
    } else {
      dispatch(clearVerseSelection());
    }
  }, [dispatch]);

  useEffect(() => {
    if (!ready) {
      return;
    }

    const json = JSON.stringify(settings);
    if (json === lastSettingsJsonRef.current) {
      return;
    }
    lastSettingsJsonRef.current = json;
    windowChannel.post({ type: 'settings', settings });
  }, [ready, settings]);

  useEffect(() => windowChannel.on('settings', ({ settings: incoming }) => {
    const json = JSON.stringify(incoming);
    if (json === lastSettingsJsonRef.current) {
      return;
    }

    const previousSourceUrls = store.getState().ui.sourceUrls;
    lastSettingsJsonRef.current = json;
    dispatch(applySharedSettings(incoming));
    if (JSON.stringify(previousSourceUrls) !== JSON.stringify(incoming.sourceUrls)) {
      hyperlinkService.invalidate();
      void dispatch(refreshTranslations(false));
    }
  }), [dispatch, store]);

  const selectedVerseTranslationId = ui.selectedVerseTranslationId ?? ui.selectedTranslationId;
  useEffect(() => {
    if (!ready || windowChannel.isPanelWindow) {
      return;
    }

    windowChannel.post({
      type: 'selection',
      selection: {
        book: ui.selectedBook,
        chapter: ui.selectedChapter,
        verses: ui.selectedVerses,
        translationId: selectedVerseTranslationId,
      },
    });
  }, [ready, selectedVerseTranslationId, ui.selectedBook, ui.selectedChapter, ui.selectedVerses]);

  useEffect(() => {
    if (!windowChannel.isPanelWindow) {
      return;
    }
    return windowChannel.on('selection', ({ selection }) => applySelection(selection));
  }, [applySelection]);

  // Bible and document windows answer a panel window's request and take its tabs back when it docks.
  useEffect(() => {
    if (windowChannel.isPanelWindow) {
      return;
    }

    // Popups inherit their opener's sessionStorage, so only the panel window may carry panel state.
    try {
      window.sessionStorage.removeItem(PANEL_WINDOW_STATE_KEY);
    } catch {
      // Storage unavailable.
    }

    const stopRequests = windowChannel.on('panel-state-request', ({ from }) => {
      windowChannel.post({ type: 'panel-state', to: from, state: buildPanelHandoff(store.getState()) });
    });
    const stopHandoffs = windowChannel.on('panel-state', ({ state }) => {
      dispatch(restorePanelTabs(state));
    });
    return () => {
      stopRequests();
      stopHandoffs();
    };
  }, [dispatch, store]);

  // A refreshed panel window keeps its own tabs; the regular tab still supplies the current selection.
  useEffect(() => {
    if (!windowChannel.isPanelWindow || !ready || restoredFromSessionRef.current) {
      return;
    }

    const stored = readStoredPanelState();
    if (stored) {
      restoredFromSessionRef.current = true;
      dispatch(restorePanelTabs(stored));
      applySelection(stored.selection);
    }
  }, [applySelection, dispatch, ready]);

  useEffect(() => {
    if (!windowChannel.isPanelWindow) {
      return;
    }
    return windowChannel.on('panel-state', ({ state }) => {
      if (!restoredFromSessionRef.current) {
        restoredFromSessionRef.current = true;
        dispatch(restorePanelTabs(state));
      }
      applySelection(state.selection);
    });
  }, [applySelection, dispatch]);

  const homeWindow = windowChannel.isPanelWindow ? panelHomeWindow(windows, windowChannel.getSelf().openerId) : null;
  useEffect(() => {
    if (!windowChannel.isPanelWindow || !ready || requestedPanelStateRef.current || !homeWindow) {
      return;
    }

    requestedPanelStateRef.current = true;
    windowChannel.post({ type: 'panel-state-request', to: homeWindow.id });
  }, [ready, homeWindow]);

  useEffect(() => {
    if (!windowChannel.isPanelWindow || !ready) {
      return;
    }

    try {
      window.sessionStorage.setItem(PANEL_WINDOW_STATE_KEY, JSON.stringify(buildPanelHandoff(store.getState())));
    } catch {
      // Storage full or unavailable; a refresh falls back to the regular tab's panel state.
    }
  }, [activeTabId, ready, store, tabs, ui.selectedBook, ui.selectedChapter, ui.selectedVerses]);
};
