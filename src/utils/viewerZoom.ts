/** Zoom limits shared by the PDF and markup document viewers. */
export const MIN_SCALE = 0.6;
export const MAX_SCALE = 2.4;
export const SCALE_STEP = 0.2;
/** Horizontal gutter (px) left beside the page when fitting to width; matches pdf.js page-width. */
export const FIT_WIDTH_GUTTER_PX = 40;

export function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(value.toFixed(2))));
}

/**
 * Next manual zoom level. Fit-to-width can land outside the manual range, so a
 * step never moves against its direction (e.g. zooming out from a 45% fit stays at 45%).
 */
export function stepScale(current: number, direction: -1 | 1): number {
  const next = clampScale(current + direction * SCALE_STEP);
  return direction > 0 ? Math.max(next, current) : Math.min(next, current);
}
