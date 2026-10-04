import { stripDocumentLinkFromHash, withPopoutParam, withoutPopoutParam } from '../App';
import { boundsFitScreen, type PopoutBounds, type ScreenArea } from './popoutBounds';

export interface PopupMetrics {
  /** The box the popup opens over (the docked panel or the main pane), in viewport coordinates; null when unmeasurable. */
  anchorRect: { left: number; width: number } | null;
  outerWidth: number;
  outerHeight: number;
  innerWidth: number;
  screenX: number;
  screenY: number;
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
}

export const finiteOr = (value: number | undefined, fallback: number): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
);

/** Every connected screen, available once the user grants window management (multi-display only). */
export interface ScreenLayout {
  screens: ScreenArea[];
  /** The first screen that isn't the one this window is on. */
  other: ScreenArea | null;
}

export interface PopupPlacement {
  width: number;
  height: number;
  left: number;
  top: number;
  source: 'saved' | 'other-screen' | 'default';
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), Math.max(min, max));

/** Centers a window of the given size on a screen's work area, shrinking it to fit. */
export const centerOnScreen = (width: number, height: number, area: ScreenArea): Omit<PopupPlacement, 'source'> => {
  const fittedWidth = Math.round(Math.min(width, area.availWidth));
  const fittedHeight = Math.round(Math.min(height, area.availHeight));
  return {
    width: fittedWidth,
    height: fittedHeight,
    left: Math.round(area.availLeft + (area.availWidth - fittedWidth) / 2),
    top: Math.round(area.availTop + (area.availHeight - fittedHeight) / 2),
  };
};

/**
 * Reopens where the user last left this kind of popout when that spot is still on a connected screen
 * (only the current screen is visible without window management). Otherwise it opens on another
 * screen when one is known, or over the anchor at its width and the source window's height.
 */
export const resolvePopupPlacement = (
  metrics: PopupMetrics,
  saved: PopoutBounds | null = null,
  layout: ScreenLayout | null = null
): PopupPlacement => {
  const outerWidth = finiteOr(metrics.outerWidth, 1100);
  const outerHeight = finiteOr(metrics.outerHeight, 780);
  const screenX = finiteOr(metrics.screenX, 80);
  const screenY = finiteOr(metrics.screenY, 60);
  const current: ScreenArea = {
    availLeft: finiteOr(metrics.availLeft, 0),
    availTop: finiteOr(metrics.availTop, 0),
    availWidth: finiteOr(metrics.availWidth, outerWidth),
    availHeight: finiteOr(metrics.availHeight, outerHeight),
  };

  const visibleScreens = layout && layout.screens.length > 0 ? layout.screens : [current];
  if (saved && visibleScreens.some((area) => boundsFitScreen(saved, area))) {
    return {
      width: Math.round(saved.width),
      height: Math.round(saved.height),
      left: Math.round(saved.left),
      top: Math.round(saved.top),
      source: 'saved',
    };
  }

  let width: number;
  let height: number;
  let left: number;
  let top: number;

  const anchorRect = metrics.anchorRect;
  if (anchorRect && anchorRect.width > 0) {
    const chromeWidth = Math.max(0, outerWidth - finiteOr(metrics.innerWidth, outerWidth));
    width = Math.round(anchorRect.width + chromeWidth);
    height = Math.round(outerHeight);
    left = Math.round(screenX + anchorRect.left);
    top = Math.round(screenY);
  } else {
    width = Math.max(920, Math.min(outerWidth - 80, 1400));
    height = Math.max(640, Math.min(outerHeight - 80, 980));
    left = Math.round(screenX + Math.max(20, (outerWidth - width) / 2));
    top = Math.round(screenY + Math.max(20, (outerHeight - height) / 2));
  }

  if (layout?.other) {
    return { ...centerOnScreen(width, height, layout.other), source: 'other-screen' };
  }

  width = Math.min(width, current.availWidth);
  height = Math.min(height, current.availHeight);
  left = clamp(left, current.availLeft, current.availLeft + current.availWidth - width);
  top = clamp(top, current.availTop, current.availTop + current.availHeight - height);
  return { width, height, left, top, source: 'default' };
};

export const buildPopupFeatures = (
  metrics: PopupMetrics,
  saved: PopoutBounds | null = null,
  layout: ScreenLayout | null = null
): string => {
  return formatPopupFeatures(resolvePopupPlacement(metrics, saved, layout));
};

export const formatPopupFeatures = ({ width, height, left, top }: Omit<PopupPlacement, 'source'>): string => [
  'popup=yes',
  `width=${width}`,
  `height=${height}`,
  `left=${left}`,
  `top=${top}`,
  'resizable=yes',
  'scrollbars=yes',
  'status=no',
  'toolbar=no',
  'location=no',
  'menubar=no',
].join(',');

export const readPopupMetrics = (anchor: Element | null): PopupMetrics => {
  const rect = anchor?.getBoundingClientRect();
  const screenWithOffsets = window.screen as Screen & { availLeft?: number; availTop?: number };
  return {
    anchorRect: rect && rect.width > 0 ? { left: rect.left, width: rect.width } : null,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
    innerWidth: window.innerWidth,
    screenX: window.screenX,
    screenY: window.screenY,
    availLeft: finiteOr(screenWithOffsets.availLeft, 0),
    availTop: finiteOr(screenWithOffsets.availTop, 0),
    availWidth: window.screen.availWidth,
    availHeight: window.screen.availHeight,
  };
};

export const buildPopoutUrl = (location: Pick<Location, 'pathname' | 'search' | 'hash'>): string => (
  `${location.pathname}${location.search}${withPopoutParam(stripDocumentLinkFromHash(location.hash))}`
);

/** A regular window at the same verse route; the document itself is handed over through sessionStorage. */
export const buildDocumentPopoutUrl = (location: Pick<Location, 'pathname' | 'search' | 'hash'>): string => (
  `${location.pathname}${location.search}${withoutPopoutParam(stripDocumentLinkFromHash(location.hash))}`
);
