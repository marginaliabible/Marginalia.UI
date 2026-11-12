/** Ignore glyph-metric .hN/.wN classes; page boxes are letter-size and up. */
export const PAGE_SIZE_MIN_PX = 200;

/**
 * Pull page-box geometry out of a (possibly huge) pdf2htmlEX document.css.
 * Mega-stylesheets can leave these rules unapplied in the browser; we re-emit
 * them as a tiny stylesheet and use the maps for pdf2htmlEX original_* sizes.
 */
export function extractPageSizeRules(documentCssText: string): {
  cssText: string;
  heights: Record<string, number>;
  widths: Record<string, number>;
} {
  const heights: Record<string, number> = {};
  const widths: Record<string, number> = {};
  // pdf2htmlEX uses hex suffixes (h48b, wc) — not decimal-only class names.
  const heightRe = /\.(h[0-9a-f]+)\{height:([\d.]+)px;\}/gi;
  const widthRe = /\.(w[0-9a-f]+)\{width:([\d.]+)px;\}/gi;
  for (const match of documentCssText.matchAll(heightRe)) {
    const cls = match[1]?.toLowerCase();
    const px = Number.parseFloat(match[2] ?? '');
    if (cls && px > 0) {
      heights[cls] = px;
    }
  }
  for (const match of documentCssText.matchAll(widthRe)) {
    const cls = match[1]?.toLowerCase();
    const px = Number.parseFloat(match[2] ?? '');
    if (cls && px > 0) {
      widths[cls] = px;
    }
  }

  const parts: string[] = [];
  for (const [cls, px] of Object.entries(heights)) {
    if (px >= PAGE_SIZE_MIN_PX) {
      parts.push(`.${cls}{height:${px}px;}`);
    }
  }
  for (const [cls, px] of Object.entries(widths)) {
    if (px >= PAGE_SIZE_MIN_PX) {
      parts.push(`.${cls}{width:${px}px;}`);
    }
  }
  return { cssText: parts.join(''), heights, widths };
}
