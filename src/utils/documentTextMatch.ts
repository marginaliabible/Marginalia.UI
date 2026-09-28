/** Shared text-layer matching for document scripture link overlays. */

export type TextNodeRange = {
  node: HTMLElement;
  start: number;
  end: number;
};

export type TextMatchHit = {
  start: number;
  end: number;
  ranges: TextNodeRange[];
};

export function normalizeDocumentMatchText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function buildTextLayerHaystack(
  textNodes: HTMLElement[],
  normalize: (value: string) => string = normalizeDocumentMatchText
): { haystack: string; ranges: TextNodeRange[] } {
  let haystack = '';
  const ranges: TextNodeRange[] = [];
  for (const node of textNodes) {
    const text = normalize(node.textContent ?? '');
    if (!text) {
      continue;
    }
    const start = haystack.length;
    haystack += `${text} `;
    ranges.push({ node, start, end: haystack.length });
  }
  return { haystack, ranges };
}

export function findNeedleInHaystack(
  haystack: string,
  ranges: TextNodeRange[],
  needle: string,
  fromIndex = 0
): TextMatchHit | null {
  const normalizedNeedle = normalizeDocumentMatchText(needle);
  if (!normalizedNeedle || !haystack) {
    return null;
  }

  const matchStart = haystack.indexOf(normalizedNeedle, fromIndex);
  if (matchStart < 0) {
    return null;
  }
  const matchEnd = matchStart + normalizedNeedle.length;
  const hitRanges = ranges.filter((range) => range.end > matchStart && range.start < matchEnd);
  if (hitRanges.length === 0) {
    return null;
  }

  return { start: matchStart, end: matchEnd, ranges: hitRanges };
}

export const SCRIPTURE_LINK_CLASS = 'document-scripture-link';
export const MAX_PANEL_VISIBLE_VERSES = 5;
