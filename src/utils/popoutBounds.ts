/** Device-local on purpose: monitor layouts differ between devices, so this is never part of cloud sync. */
export const POPOUT_BOUNDS_STORAGE_KEY = 'marginalia:popout-bounds';

export type PopoutKind = 'panel' | 'document';

export interface PopoutBounds {
  /** Outer window position, as `window.open`'s `left`/`top` expect. */
  left: number;
  top: number;
  /** Viewport size, as `window.open`'s `width`/`height` expect. */
  width: number;
  height: number;
  /** Full window size including browser chrome, for the on-screen check. */
  outerWidth: number;
  outerHeight: number;
}

export interface ScreenArea {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
}

/** Maximized windows on Windows hang their resize borders a few pixels past the work area. */
const EDGE_TOLERANCE_PX = 16;
const MIN_POPOUT_SIZE_PX = 200;
const MOVE_CHECK_MS = 1_000;
const RESIZE_SAVE_DELAY_MS = 300;

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const isPopoutBounds = (value: unknown): value is PopoutBounds => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const bounds = value as Record<string, unknown>;
  return ['left', 'top', 'width', 'height', 'outerWidth', 'outerHeight'].every((key) => isFiniteNumber(bounds[key]));
};

const readAll = (): Partial<Record<PopoutKind, PopoutBounds>> => {
  try {
    const raw = window.localStorage.getItem(POPOUT_BOUNDS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : null;
    return parsed && typeof parsed === 'object' ? parsed as Partial<Record<PopoutKind, PopoutBounds>> : {};
  } catch {
    return {};
  }
};

export const readPopoutBounds = (kind: PopoutKind): PopoutBounds | null => {
  const bounds = readAll()[kind];
  return isPopoutBounds(bounds) ? bounds : null;
};

export const savePopoutBounds = (kind: PopoutKind, bounds: PopoutBounds): void => {
  try {
    window.localStorage.setItem(POPOUT_BOUNDS_STORAGE_KEY, JSON.stringify({ ...readAll(), [kind]: bounds }));
  } catch {
    // Storage full or unavailable; the next popout opens at its default size.
  }
};

/** Whether the whole window would land on the given screen's work area, so it can't open lost offscreen. */
export const boundsFitScreen = (bounds: PopoutBounds, area: ScreenArea): boolean => (
  bounds.width >= MIN_POPOUT_SIZE_PX
  && bounds.height >= MIN_POPOUT_SIZE_PX
  && bounds.left >= area.availLeft - EDGE_TOLERANCE_PX
  && bounds.top >= area.availTop - EDGE_TOLERANCE_PX
  && bounds.left + bounds.outerWidth <= area.availLeft + area.availWidth + EDGE_TOLERANCE_PX
  && bounds.top + bounds.outerHeight <= area.availTop + area.availHeight + EDGE_TOLERANCE_PX
);

export const readWindowBounds = (target: Window): PopoutBounds => ({
  left: target.screenX,
  top: target.screenY,
  width: target.innerWidth,
  height: target.innerHeight,
  outerWidth: target.outerWidth,
  outerHeight: target.outerHeight,
});

const sameBounds = (left: PopoutBounds, right: PopoutBounds): boolean => (
  left.left === right.left
  && left.top === right.top
  && left.width === right.width
  && left.height === right.height
  && left.outerWidth === right.outerWidth
  && left.outerHeight === right.outerHeight
);

/** Remembers this popout's size and position; browsers have no move event, so position is polled. */
export const trackPopoutBounds = (kind: PopoutKind, target: Window = window): (() => void) => {
  let last: PopoutBounds | null = null;
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;

  const save = () => {
    const next = readWindowBounds(target);
    if (!isPopoutBounds(next) || (last && sameBounds(last, next))) {
      return;
    }
    last = next;
    savePopoutBounds(kind, next);
  };
  const handleResize = () => {
    if (resizeTimer !== null) {
      clearTimeout(resizeTimer);
    }
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      save();
    }, RESIZE_SAVE_DELAY_MS);
  };

  last = readWindowBounds(target);
  const moveTimer = setInterval(save, MOVE_CHECK_MS);
  target.addEventListener('resize', handleResize);
  target.addEventListener('pagehide', save);
  return () => {
    clearInterval(moveTimer);
    if (resizeTimer !== null) {
      clearTimeout(resizeTimer);
    }
    target.removeEventListener('resize', handleResize);
    target.removeEventListener('pagehide', save);
  };
};
