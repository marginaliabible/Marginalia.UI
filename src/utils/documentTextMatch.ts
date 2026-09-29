/** Shared text-layer matching for document scripture link overlays. */

export type TextNodeRange = {
  node: HTMLElement;
  /** Normalized node text as it appears in the haystack (without the trailing separator). */
  text: string;
  start: number;
  end: number;
};

export type TextMatchHit = {
  start: number;
  end: number;
  ranges: TextNodeRange[];
};

export type ClientRectBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * Per-character equivalent of a haystack normalizer, used to map normalized
 * offsets back to DOM text positions. Must produce the same output as the
 * full-string normalizer (whitespace collapsed and trimmed) for the mapping to apply.
 */
export type MatchTextFolding = {
  foldChar: (ch: string) => string;
  isSpace: (ch: string) => boolean;
};

const WHITESPACE_CHAR = /\s/;

export const DOCUMENT_MATCH_FOLDING: MatchTextFolding = {
  foldChar: (ch) => ch.normalize('NFKC').toLowerCase(),
  isSpace: (ch) => WHITESPACE_CHAR.test(ch),
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
    ranges.push({ node, text, start, end: haystack.length });
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

type FoldedCharSource = { node: Text; start: number; end: number };

function foldElementText(
  element: HTMLElement,
  folding: MatchTextFolding
): { text: string; sources: FoldedCharSource[] } {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let text = '';
  const sources: FoldedCharSource[] = [];
  let pendingSpace: FoldedCharSource | null = null;

  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    let offset = 0;
    for (const ch of node.data) {
      const source: FoldedCharSource = { node, start: offset, end: offset + ch.length };
      offset += ch.length;
      for (const folded of folding.foldChar(ch)) {
        if (folding.isSpace(folded)) {
          if (text && !pendingSpace) {
            pendingSpace = source;
          }
          continue;
        }
        if (pendingSpace) {
          text += ' ';
          sources.push(pendingSpace);
          pendingSpace = null;
        }
        text += folded;
        for (let i = 0; i < folded.length; i += 1) {
          sources.push(source);
        }
      }
    }
  }

  return { text, sources };
}

function mergeLineRects(rects: ClientRectBox[]): ClientRectBox[] {
  const merged: ClientRectBox[] = [];
  const sorted = [...rects].sort((a, b) => a.top - b.top || a.left - b.left);
  for (const rect of sorted) {
    const line = merged.find((candidate) => {
      const overlap = Math.min(candidate.top + candidate.height, rect.top + rect.height)
        - Math.max(candidate.top, rect.top);
      return overlap > Math.min(candidate.height, rect.height) / 2;
    });
    if (!line) {
      merged.push({ ...rect });
      continue;
    }
    const right = Math.max(line.left + line.width, rect.left + rect.width);
    const bottom = Math.max(line.top + line.height, rect.top + rect.height);
    line.left = Math.min(line.left, rect.left);
    line.top = Math.min(line.top, rect.top);
    line.width = right - line.left;
    line.height = bottom - line.top;
  }
  return merged;
}

/**
 * Client rects covering only the portion of `range.node` that falls inside the
 * haystack match `[matchStart, matchEnd)`. Falls back to the whole node's rect
 * when the matched characters can't be located in the DOM text.
 */
export function getMatchClientRects(
  range: TextNodeRange,
  matchStart: number,
  matchEnd: number,
  folding: MatchTextFolding = DOCUMENT_MATCH_FOLDING
): ClientRectBox[] {
  const localStart = Math.max(matchStart - range.start, 0);
  const localEnd = Math.min(matchEnd - range.start, range.text.length);
  if (localEnd <= localStart) {
    return [];
  }

  const wholeNode = (): ClientRectBox[] => {
    const rect = range.node.getBoundingClientRect();
    return [{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }];
  };

  if (localStart === 0 && localEnd === range.text.length) {
    return wholeNode();
  }

  const { text, sources } = foldElementText(range.node, folding);
  if (text !== range.text) {
    return wholeNode();
  }

  const first = sources[localStart];
  const last = sources[localEnd - 1];
  if (!first || !last) {
    return wholeNode();
  }

  const domRange = range.node.ownerDocument.createRange();
  domRange.setStart(first.node, first.start);
  domRange.setEnd(last.node, last.end);
  const rects = Array.from(domRange.getClientRects?.() ?? [])
    .filter((rect) => rect.width >= 0.5 && rect.height >= 0.5)
    .map((rect) => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }));
  domRange.detach();

  return rects.length > 0 ? mergeLineRects(rects) : wholeNode();
}

/** Overlay padding on each side, as a fraction of the text rect's height. */
const OVERLAY_PADDING_RATIO = 0.15;

/**
 * Position an absolutely-positioned overlay over `rect` (client coordinates) as
 * percentages of the page's padding box, so it tracks the text when the page is
 * resized by zooming. Returns false when the page has no measurable size.
 */
export function placeOverlayOnPage(overlay: HTMLElement, pageElement: HTMLElement, textRect: ClientRectBox): boolean {
  const pad = textRect.height * OVERLAY_PADDING_RATIO;
  const rect: ClientRectBox = {
    left: textRect.left - pad,
    top: textRect.top - pad,
    width: textRect.width + pad * 2,
    height: textRect.height + pad * 2,
  };
  const pageRect = pageElement.getBoundingClientRect();
  if (pageRect.width < 0.5 || pageRect.height < 0.5 || pageElement.offsetWidth === 0 || pageElement.offsetHeight === 0) {
    return false;
  }

  const scaleX = pageRect.width / pageElement.offsetWidth;
  const scaleY = pageRect.height / pageElement.offsetHeight;
  const innerLeft = pageRect.left + pageElement.clientLeft * scaleX;
  const innerTop = pageRect.top + pageElement.clientTop * scaleY;
  const innerWidth = pageElement.clientWidth * scaleX;
  const innerHeight = pageElement.clientHeight * scaleY;
  if (innerWidth < 0.5 || innerHeight < 0.5) {
    return false;
  }

  const percent = (value: number) => `${(value * 100).toFixed(4)}%`;
  overlay.style.left = percent((rect.left - innerLeft) / innerWidth);
  overlay.style.top = percent((rect.top - innerTop) / innerHeight);
  overlay.style.width = percent(rect.width / innerWidth);
  overlay.style.height = percent(rect.height / innerHeight);
  overlay.style.minWidth = '2px';
  overlay.style.minHeight = '2px';
  pageElement.style.position = pageElement.style.position || 'relative';
  pageElement.appendChild(overlay);
  return true;
}

export const SCRIPTURE_LINK_CLASS = 'document-scripture-link';
export const MAX_PANEL_VISIBLE_VERSES = 5;
