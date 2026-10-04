import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from 'react-redux';
import type { AppDispatch, RootState } from '../store/store';
import { setPanelDetached } from '../store/slices/bibleSlice';
import { withPopoutParam } from '../App';
import { buildPopoutUrl, formatPopupFeatures, readPopupMetrics, resolvePopupPlacement } from '../utils/popoutWindow';
import { readPopoutBounds } from '../utils/popoutBounds';
import { getScreenLayout, moveToOtherScreen, offerScreenPlacement } from '../services/screenPlacement';
import {
  PANEL_WINDOW_NAME,
  useChannelWindows,
  watchForLastRegularWindow,
  windowChannel,
} from '../services/windowChannel';
import { focusChannelWindow, mostRecentWindowOfType, registerWindowRef } from '../services/windowRouting';
import type { WindowInfo } from '../models/windowMessages';
import { buildPanelHandoff, PANEL_WINDOW_STATE_KEY, panelHomeWindow } from './useWindowStateSync';

export { PANEL_WINDOW_NAME };
const SIDE_PANEL_ELEMENT_ID = 'workspace-side-panel';
/** How long a just-opened popout has to announce itself before the docked panel comes back. */
const POPOUT_ANNOUNCE_TIMEOUT_MS = 5_000;
/** Checked after `window.close()`: a window the user opened themselves can't be closed by script. */
const CLOSE_CHECK_MS = 250;

interface UsePopupPanelProps {
  dispatch: AppDispatch;
  isPanelDetached: boolean;
}

interface UsePopupPanelReturn {
  focusMainWindow: () => void;
  handleToggleDetachPanel: () => void;
  /** The panel window handed its tabs back but couldn't close itself. */
  isPanelWindowDocked: boolean;
}

const findPanelWindow = (windows: readonly WindowInfo[]): WindowInfo | null => (
  windows.find((entry) => entry.type === 'panel') ?? null
);

export const usePopupPanel = ({ dispatch, isPanelDetached }: UsePopupPanelProps): UsePopupPanelReturn => {
  const store = useStore<RootState>();
  const windows = useChannelWindows();
  const windowsRef = useRef(windows);
  windowsRef.current = windows;
  const announceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isPanelWindowDocked, setIsDocked] = useState(false);

  const focusMainWindow = useCallback(() => {
    const bibleWindow = mostRecentWindowOfType('bible');
    if (bibleWindow) {
      focusChannelWindow(bibleWindow.id);
    }
  }, []);

  // The panel window closes itself once the last regular tab is gone (allowing for refreshes).
  useEffect(() => {
    if (!windowChannel.isPanelWindow || !windowChannel.isAvailable) {
      return;
    }
    return watchForLastRegularWindow(windowChannel, { onGone: () => window.close() });
  }, []);

  // Resource links and other hash changes must not turn the panel window into a regular tab on refresh.
  useEffect(() => {
    if (!windowChannel.isPanelWindow) {
      return;
    }

    const keepPopoutParam = () => {
      const nextHash = withPopoutParam(window.location.hash);
      if (nextHash !== window.location.hash) {
        window.history.replaceState(
          window.history.state,
          '',
          `${window.location.pathname}${window.location.search}${nextHash}`
        );
      }
    };

    keepPopoutParam();
    window.addEventListener('hashchange', keepPopoutParam);
    return () => window.removeEventListener('hashchange', keepPopoutParam);
  }, []);

  useEffect(() => () => {
    if (announceTimerRef.current !== null) {
      clearTimeout(announceTimerRef.current);
    }
  }, []);

  const dockPanelWindow = useCallback(() => {
    const target = panelHomeWindow(windowsRef.current, windowChannel.getSelf().openerId);
    if (target) {
      windowChannel.post({ type: 'panel-state', to: target.id, state: buildPanelHandoff(store.getState()) });
    }

    try {
      window.sessionStorage.removeItem(PANEL_WINDOW_STATE_KEY);
    } catch {
      // Storage unavailable.
    }

    window.close();
    // A window the user opened themselves can't be closed by script. It leaves the other windows (so the
    // main window shows its docked panel again) but never turns into a Bible window.
    window.setTimeout(() => {
      if (!window.closed) {
        windowChannel.stop();
        setIsDocked(true);
      }
    }, CLOSE_CHECK_MS);
  }, [store]);

  const handleToggleDetachPanel = useCallback(() => {
    if (windowChannel.isPanelWindow) {
      dockPanelWindow();
      return;
    }

    const existing = findPanelWindow(windowsRef.current);
    if (existing) {
      if (!isPanelDetached) {
        dispatch(setPanelDetached(true));
      }
      focusChannelWindow(existing.id);
      return;
    }

    const placement = resolvePopupPlacement(
      readPopupMetrics(document.getElementById(SIDE_PANEL_ELEMENT_ID)),
      readPopoutBounds('panel'),
      getScreenLayout()
    );
    const popup = window.open(buildPopoutUrl(window.location), PANEL_WINDOW_NAME, formatPopupFeatures(placement));
    if (!popup) {
      return;
    }

    registerWindowRef(popup);
    offerScreenPlacement(placement.source === 'default' ? () => moveToOtherScreen(popup) : undefined);
    dispatch(setPanelDetached(true));
    if (announceTimerRef.current !== null) {
      clearTimeout(announceTimerRef.current);
    }
    announceTimerRef.current = setTimeout(() => {
      announceTimerRef.current = null;
      if (!findPanelWindow(windowChannel.getWindows())) {
        dispatch(setPanelDetached(false));
      }
    }, POPOUT_ANNOUNCE_TIMEOUT_MS);
  }, [dispatch, dockPanelWindow, isPanelDetached]);

  return { focusMainWindow, handleToggleDetachPanel, isPanelWindowDocked };
};
