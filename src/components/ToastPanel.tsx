import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { isAlertTone, setToastExpiryPaused, useToasts, type Toast } from '../services/toastService';

export const TOAST_AUTO_COLLAPSE_MS = 12_000;
// Unmounts the panel even when no transitionend arrives (reduced motion, jsdom).
const LEAVE_FALLBACK_MS = 400;
const LIST_TOP_THRESHOLD_PX = 4;

type PanelPhase = 'hidden' | 'entering' | 'shown' | 'leaving';

function formatToastTime(createdAt: number): string {
  return new Date(createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatRepeat(toast: Toast): string {
  return toast.repeatCount > 1 ? ` (x${toast.repeatCount})` : '';
}

function alertPrefix(toast: Toast): string {
  if (toast.tone === 'error') {
    return 'Error: ';
  }
  return toast.tone === 'warning' ? 'Warning: ' : '';
}

function hasTransition(element: HTMLElement): boolean {
  return window.getComputedStyle(element).transitionDuration.split(',').some((duration) => parseFloat(duration) > 0);
}

// Distance from the header's bottom edge to the panel's, i.e. how far the open list must sit below
// the viewport for only its header row to show where the one-line bar was.
function measureListLift(panel: HTMLElement): number {
  const header = panel.querySelector('.toast-panel__header');
  if (!header) {
    return 0;
  }
  return Math.max(0, panel.getBoundingClientRect().bottom - header.getBoundingClientRect().bottom);
}

function isKeyboardFocus(target: EventTarget): boolean {
  try {
    return target instanceof Element && target.matches(':focus-visible');
  } catch {
    return false;
  }
}

const ToastAlertIcon: React.FC<{ toast: Toast }> = ({ toast }) => {
  if (!isAlertTone(toast.tone)) {
    return null;
  }

  return (
    <>
      <i className="fa-solid fa-radiation toast-panel__alert-icon" aria-hidden="true"></i>
      <span className="visually-hidden">{alertPrefix(toast)}</span>
    </>
  );
};

const ToastActionButton: React.FC<{ toast: Toast }> = ({ toast }) => {
  if (!toast.action) {
    return null;
  }

  const { label, onClick } = toast.action;
  return (
    <button type="button" className="toast-panel__action" onClick={onClick}>
      {label}
    </button>
  );
};

const ToastPanel: React.FC = () => {
  const toasts = useToasts();
  const [phase, setPhase] = useState<PanelPhase>('hidden');
  const [collapsed, setCollapsed] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [keyboardFocusWithin, setKeyboardFocusWithin] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const listAtTopRef = useRef(true);
  const historyRef = useRef<HTMLButtonElement>(null);
  const listCloseRef = useRef<HTMLButtonElement>(null);
  const focusListToggleRef = useRef(false);
  const listId = useId();
  const headerId = useId();

  const hasToasts = toasts.length > 0;
  // Keeps the last content on screen while the emptied panel slides out.
  const [retainedToasts, setRetainedToasts] = useState(toasts);
  if (hasToasts && retainedToasts !== toasts) {
    setRetainedToasts(toasts);
  }
  const displayToasts = hasToasts ? toasts : retainedToasts;
  const newest = displayToasts.length > 0 ? displayToasts[displayToasts.length - 1] : null;
  const newestSignature = hasToasts && newest ? `${newest.id}:${newest.createdAt}:${newest.repeatCount}` : '';
  const newestFirst = useMemo(() => [...displayToasts].reverse(), [displayToasts]);
  const isVisible = phase === 'entering' || phase === 'shown';
  const expanded = isVisible && !collapsed;

  // Keeps the list laid out while it slides back down after being closed.
  const [listClosing, setListClosing] = useState(false);
  const [previousListOpen, setPreviousListOpen] = useState(listOpen);
  if (previousListOpen !== listOpen) {
    setPreviousListOpen(listOpen);
    setListClosing(!listOpen);
  }
  const showList = listOpen || listClosing;

  useEffect(() => {
    if (hasToasts) {
      setPhase((current) => {
        if (current === 'hidden') {
          return 'entering';
        }
        return current === 'leaving' ? 'shown' : current;
      });
    } else {
      setPhase((current) => (current === 'hidden' ? current : 'leaving'));
    }
  }, [hasToasts]);

  // Forces a style flush on the offscreen frame so the slide-in transition runs.
  useLayoutEffect(() => {
    if (phase !== 'entering') {
      return;
    }
    panelRef.current?.getBoundingClientRect();
    setPhase('shown');
  }, [phase]);

  const finishLeaving = useCallback(() => {
    setPhase((current) => (current === 'leaving' ? 'hidden' : current));
    setCollapsed(false);
    setListOpen(false);
    setHovered(false);
    setKeyboardFocusWithin(false);
  }, []);

  useEffect(() => {
    if (phase !== 'leaving') {
      return;
    }
    const timer = window.setTimeout(finishLeaving, LEAVE_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [finishLeaving, phase]);

  useEffect(() => {
    if (newestSignature) {
      setCollapsed(false);
    }
  }, [newestSignature]);

  const interacting = hovered || keyboardFocusWithin;
  useEffect(() => {
    if (!isVisible || collapsed || listOpen || interacting || !newestSignature) {
      return;
    }
    const timer = window.setTimeout(() => setCollapsed(true), TOAST_AUTO_COLLAPSE_MS);
    return () => window.clearTimeout(timer);
  }, [collapsed, interacting, isVisible, listOpen, newestSignature]);

  useEffect(() => {
    setToastExpiryPaused(expanded);
  }, [expanded]);

  useEffect(() => () => setToastExpiryPaused(false), []);

  useEffect(() => {
    if (!listOpen) {
      return;
    }
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && panelRef.current?.contains(event.target)) {
        return;
      }
      setListOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [listOpen]);

  useLayoutEffect(() => {
    if (listOpen && listRef.current) {
      listRef.current.scrollTop = 0;
      listAtTopRef.current = true;
    }
  }, [listOpen]);

  useLayoutEffect(() => {
    if (listOpen && listAtTopRef.current && listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [listOpen, newestSignature]);

  // Starts the open list pushed down so only its header row shows, then slides it up into view.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!listOpen || !panel || !hasTransition(panel)) {
      return;
    }
    const lift = measureListLift(panel);
    if (lift === 0) {
      return;
    }
    panel.style.transition = 'none';
    panel.style.setProperty('--toast-lift', `${lift}px`);
    panel.getBoundingClientRect();
    panel.style.transition = '';
    panel.style.setProperty('--toast-lift', '0px');
  }, [listOpen]);

  useLayoutEffect(() => {
    if (!listClosing) {
      return;
    }
    const panel = panelRef.current;
    const lift = panel && hasTransition(panel) ? measureListLift(panel) : 0;
    if (!panel || lift === 0) {
      setListClosing(false);
      return;
    }
    panel.style.setProperty('--toast-lift', `${lift}px`);
    const timer = window.setTimeout(() => setListClosing(false), LEAVE_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [listClosing]);

  // Swaps the slid-down list for the bar without animating the lift back to zero.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (showList || !panel || !panel.style.getPropertyValue('--toast-lift')) {
      return;
    }
    panel.style.transition = 'none';
    panel.style.removeProperty('--toast-lift');
    panel.getBoundingClientRect();
    panel.style.transition = '';
  }, [showList]);

  // The open and close toggles swap places, so focus follows to the one that replaced it.
  useLayoutEffect(() => {
    if (!focusListToggleRef.current || showList !== listOpen) {
      return;
    }
    focusListToggleRef.current = false;
    (showList ? listCloseRef : historyRef).current?.focus();
  }, [listOpen, showList]);

  if (phase === 'hidden' || !newest) {
    return null;
  }

  const handleCollapseToggle = () => {
    if (collapsed) {
      setCollapsed(false);
      return;
    }
    setCollapsed(true);
    setListOpen(false);
  };

  const toggleList = (open: boolean) => {
    focusListToggleRef.current = true;
    setListOpen(open);
  };

  const handleCurrentClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest('.toast-panel__action')) {
      return;
    }
    setListOpen(true);
  };

  const handleTransitionEnd = (event: React.TransitionEvent<HTMLDivElement>) => {
    if (event.target !== panelRef.current || event.propertyName !== 'transform') {
      return;
    }
    if (phase === 'leaving') {
      finishLeaving();
    } else if (listClosing) {
      setListClosing(false);
    }
  };

  const handleFocus = (event: React.FocusEvent<HTMLDivElement>) => {
    setKeyboardFocusWithin(isKeyboardFocus(event.target));
  };

  const handleBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !panelRef.current?.contains(next)) {
      setKeyboardFocusWithin(false);
    }
  };

  const panelClassName = [
    'toast-panel',
    isVisible ? '' : 'is-offscreen',
    collapsed ? 'is-collapsed' : '',
    showList ? 'is-list-open' : '',
    listClosing ? 'is-list-closing' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={panelRef}
      className={panelClassName}
      role="region"
      aria-label="Notifications"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onTransitionEnd={handleTransitionEnd}
    >
      <div className="toast-panel__body" inert={collapsed || !isVisible}>
        {showList && (
          <>
            <h2 id={headerId} className="toast-panel__header" onClick={() => setListOpen(false)}>
              Recent Notifications
            </h2>
            <ol
              ref={listRef}
              id={listId}
              className="toast-panel__list"
              aria-labelledby={headerId}
              inert={!listOpen}
              onScroll={(event) => {
                listAtTopRef.current = event.currentTarget.scrollTop <= LIST_TOP_THRESHOLD_PX;
              }}
            >
              {newestFirst.map((toast) => (
                <li key={toast.id} className="toast-panel__row" data-tone={toast.tone}>
                  <time className="toast-panel__time" dateTime={new Date(toast.createdAt).toISOString()}>
                    {formatToastTime(toast.createdAt)}
                  </time>
                  <span className="toast-panel__row-message">
                    <ToastAlertIcon toast={toast} />
                    {toast.message}
                    {formatRepeat(toast)}
                    <ToastActionButton toast={toast} />
                  </span>
                </li>
              ))}
            </ol>
          </>
        )}

        {!showList && (
          <div
            className="toast-panel__current"
            data-tone={newest.tone}
            title={`${newest.message}${formatRepeat(newest)}`}
            onClick={handleCurrentClick}
          >
            <ToastAlertIcon toast={newest} />
            <span className="toast-panel__current-message">{newest.message}</span>
            {newest.repeatCount > 1 && (
              <span className="toast-panel__repeat">{formatRepeat(newest)}</span>
            )}
            <ToastActionButton toast={newest} />
          </div>
        )}
      </div>

      <div className="toast-panel__controls">
        {showList ? (
          <button
            ref={listCloseRef}
            type="button"
            className="toast-panel__collapse"
            aria-expanded={listOpen}
            aria-controls={listId}
            aria-label="Hide notification history"
            title="Hide notification history"
            onClick={() => toggleList(false)}
          >
            <i className="fa-solid fa-angles-down" aria-hidden="true"></i>
          </button>
        ) : (
          <>
            <button
              ref={historyRef}
              type="button"
              className="toast-panel__history"
              inert={collapsed || !isVisible}
              aria-expanded={false}
              aria-controls={listId}
              aria-label="Show notification history"
              title="Show notification history"
              onClick={() => toggleList(true)}
            >
              <i className="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>
            </button>
            <button
              type="button"
              className="toast-panel__collapse"
              aria-expanded={!collapsed}
              aria-label={collapsed ? 'Show notifications' : 'Hide notifications'}
              onClick={handleCollapseToggle}
            >
              <i className={`fa-solid ${collapsed ? 'fa-angles-right' : 'fa-angles-left'}`} aria-hidden="true"></i>
            </button>
          </>
        )}
      </div>

      <div className="visually-hidden" aria-live="polite">
        {hasToasts ? `${alertPrefix(newest)}${newest.message}${formatRepeat(newest)}` : ''}
      </div>
    </div>
  );
};

export default ToastPanel;
