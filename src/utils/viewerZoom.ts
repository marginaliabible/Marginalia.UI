/** Zoom limits shared by the PDF and markup document viewers. */
export const MIN_SCALE = 0.6;
export const MAX_SCALE = 2.4;
export const SCALE_STEP = 0.2;
/** Horizontal gutter (px) left beside the page when fitting to width; matches pdf.js page-width. */
export const FIT_WIDTH_GUTTER_PX = 40;

export function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(value.toFixed(2))));
}

/** 0-based index of the toolbar page ("Page X / Y") within a document of `pageCount` pages. */
export function fitWidthPageIndex(pageNumber: number, pageCount: number): number {
  if (pageCount <= 0) {
    return 0;
  }
  return Math.min(pageCount - 1, Math.max(1, pageNumber) - 1);
}

/**
 * Scale that makes the current page fill the container width, leaving
 * {@link FIT_WIDTH_GUTTER_PX}. `pageOffsetWidth` is the page's already-scaled
 * layout width; `currentScale` is the viewer scale that produced it.
 */
export function computeFitWidthScale(
  containerClientWidth: number,
  pageOffsetWidth: number,
  currentScale: number
): number | null {
  if (!(containerClientWidth > 0) || !(pageOffsetWidth > 0) || !(currentScale > 0)) {
    return null;
  }
  const available = containerClientWidth - FIT_WIDTH_GUTTER_PX;
  if (available <= 0) {
    return null;
  }
  const unscaledWidth = pageOffsetWidth / currentScale;
  if (!(unscaledWidth > 0) || !Number.isFinite(unscaledWidth)) {
    return null;
  }
  const next = available / unscaledWidth;
  return Number.isFinite(next) && next > 0 ? next : null;
}

/**
 * Next manual zoom level. Fit-to-width can land outside the manual range, so a
 * step never moves against its direction (e.g. zooming out from a 45% fit stays at 45%).
 */
export function stepScale(current: number, direction: -1 | 1): number {
  const next = clampScale(current + direction * SCALE_STEP);
  return direction > 0 ? Math.max(next, current) : Math.min(next, current);
}
