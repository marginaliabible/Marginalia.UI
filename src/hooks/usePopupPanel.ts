import { useState, useRef, useEffect } from 'react';
import type { AppDispatch } from '../store/store';
import { setPanelDetached } from '../store/slices/bibleSlice';

interface UsePopupPanelProps {
  dispatch: AppDispatch;
  theme: string;
  isPanelDetached: boolean;
  detachedPanelName: string | null;
}

interface UsePopupPanelReturn {
  popupContainer: HTMLElement | null;
  focusDetachedPanel: () => void;
  handleToggleDetachPanel: () => void;
}

export const usePopupPanel = ({
  dispatch,
  theme,
  isPanelDetached,
  detachedPanelName,
}: UsePopupPanelProps): UsePopupPanelReturn => {
  const [popupContainer, setPopupContainer] = useState<HTMLElement | null>(null);
  const popupWindowRef = useRef<Window | null>(null);
  const popupCleanupRef = useRef<(() => void) | null>(null);

  const focusDetachedPanel = () => {
    const popup = popupWindowRef.current;
    if (!popup || popup.closed) {
      return;
    }
    popup.focus();
  };

  const attachPopupWindow = (popup: Window, windowName: string) => {
    popupWindowRef.current = popup;

    popup.document.title = 'GitBible Panel';
    popup.document.body.className = document.body.className;
    popup.document.documentElement.setAttribute('data-theme', theme);
    popup.document.documentElement.setAttribute('data-bs-theme', theme);
    popup.document.documentElement.style.height = '100%';
    popup.document.body.style.height = '100%';
    popup.document.body.style.margin = '0';
    popup.document.body.style.padding = '1rem';
    popup.document.body.style.display = 'flex';
    popup.document.body.style.flexDirection = 'column';

    const existingRoot = popup.document.getElementById('gitbible-popout-root');
    const root = existingRoot ?? popup.document.createElement('div');
    root.id = 'gitbible-popout-root';
    root.style.display = 'flex';
    root.style.flexDirection = 'column';
    root.style.flex = '1 1 auto';
    root.style.minHeight = '0';
    if (!existingRoot) {
      popup.document.body.innerHTML = '';
      popup.document.body.appendChild(root);
    }

    if (!popup.document.getElementById('gitbible-popout-base')) {
      const baseStyle = popup.document.createElement('style');
      baseStyle.id = 'gitbible-popout-base';
      baseStyle.textContent = `
        body {
          background: var(--bs-body-bg);
          color: var(--bs-body-color);
        }

        #gitbible-popout-root .popout-panel-shell {
          display: flex;
          flex: 1 1 auto;
          flex-direction: column;
          min-height: 0;
          max-height: none;
        }

        #gitbible-popout-root .popout-panel-shell.workspace-scroll {
          height: 100%;
          max-height: none;
          overflow: auto;
        }

        #gitbible-popout-root .popout-panel-shell > .card {
          flex: 1 1 auto;
          min-height: 0;
        }

        #gitbible-popout-root .popout-panel-shell .card-body {
          min-height: 0;
        }

        #gitbible-popout-root .popout-panel-shell .search-results-card {
          flex: 1 1 auto;
          min-height: 0;
        }

        #gitbible-popout-root .popout-panel-shell .search-results-body {
          flex: 1 1 auto;
          min-height: 0;
        }
      `;
      popup.document.head.appendChild(baseStyle);
    }

    document.querySelectorAll('link[rel="stylesheet"], style').forEach((styleNode) => {
      const clone = styleNode.cloneNode(true) as HTMLElement;

      if (styleNode.tagName === 'LINK') {
        const href = styleNode.getAttribute('href');
        if (!href) return;
        const existing = Array.from(popup.document.querySelectorAll('link[rel="stylesheet"]')).some(
          (candidate) => candidate.getAttribute('href') === href
        );
        if (existing) return;
      }

      if (styleNode.tagName === 'STYLE') {
        const styleId = styleNode.getAttribute('id');
        if (styleId) {
          const existing = popup.document.getElementById(styleId);
          if (existing) return;
        }
      }

      popup.document.head.appendChild(clone);
    });

    const handlePopupBeforeUnload = () => {
      dispatch(setPanelDetached({ detached: false, panelName: null }));
      setPopupContainer(null);
      popupWindowRef.current = null;
      sessionStorage.removeItem('gitbible-popout-name');
    };

    popup.addEventListener('beforeunload', handlePopupBeforeUnload);
    popupCleanupRef.current = () => {
      popup.removeEventListener('beforeunload', handlePopupBeforeUnload);
    };

    setPopupContainer(root);
    dispatch(setPanelDetached({ detached: true, panelName: windowName }));
    sessionStorage.setItem('gitbible-popout-name', windowName);
  };

  const openOrReconnectPopup = (forceOpen: boolean) => {
    const storedName = detachedPanelName ?? sessionStorage.getItem('gitbible-popout-name');
    const windowName =
      storedName && storedName.trim().length > 0
        ? storedName
        : `gitbible-panel-${Date.now()}`;

    const popup = window.open('', windowName);
    if (!popup || popup.closed) {
      return;
    }

    attachPopupWindow(popup, windowName);
    if (forceOpen) {
      popup.focus();
    }
  };

  // Reconnect popup on mount if session storage indicates one was open
  useEffect(() => {
    const popupName = sessionStorage.getItem('gitbible-popout-name');
    if (!popupName) return;
    openOrReconnectPopup(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Detect popup closed while detached state still set
  useEffect(() => {
    if (!isPanelDetached) return;

    const popup = popupWindowRef.current;
    if (!popup || popup.closed) {
      dispatch(setPanelDetached({ detached: false, panelName: null }));
      setPopupContainer(null);
      sessionStorage.removeItem('gitbible-popout-name');
    }
  }, [isPanelDetached, dispatch]);

  // Sync theme to popup window when it changes
  useEffect(() => {
    const popup = popupWindowRef.current;
    if (popup && !popup.closed) {
      popup.document.documentElement.setAttribute('data-theme', theme);
      popup.document.documentElement.setAttribute('data-bs-theme', theme);
    }
  }, [theme]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      popupCleanupRef.current?.();
    };
  }, []);

  const handleToggleDetachPanel = () => {
    if (isPanelDetached) {
      dispatch(setPanelDetached({ detached: false, panelName: null }));
      setPopupContainer(null);
      sessionStorage.removeItem('gitbible-popout-name');
      popupCleanupRef.current?.();

      const popup = popupWindowRef.current;
      popupWindowRef.current = null;
      if (popup && !popup.closed) {
        popup.close();
      }

      window.focus();
      return;
    }

    openOrReconnectPopup(true);
  };

  return { popupContainer, focusDetachedPanel, handleToggleDetachPanel };
};
