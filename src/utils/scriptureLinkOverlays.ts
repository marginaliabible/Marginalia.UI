import {
  SCRIPTURE_LINK_CLASS,
  buildTextLayerHaystack,
  findNeedleInHaystack,
  getMatchClientRects,
  normalizeDocumentMatchText,
  placeOverlayOnPage,
  type TextMatchHit,
} from './documentTextMatch';
import { toVerseContext, type DocumentScriptureReference } from './pageVerseReferences';
import { formatVerseReference } from './selectedVerseContext';

export type ScriptureLinkClickHandler = (reference: DocumentScriptureReference) => void;

function clearScriptureLinks(root: ParentNode | null | undefined): void {
  root?.querySelectorAll(`.${SCRIPTURE_LINK_CLASS}`).forEach((node) => node.remove());
}

function encodeReference(reference: DocumentScriptureReference): string {
  return JSON.stringify({
    raw: reference.raw,
    book: reference.book,
    chapter: reference.chapter,
    verses: reference.verses,
  });
}

function decodeReference(value: string | null): DocumentScriptureReference | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as DocumentScriptureReference;
    if (
      typeof parsed.raw !== 'string'
      || typeof parsed.book !== 'string'
      || !Number.isInteger(parsed.chapter)
      || !Array.isArray(parsed.verses)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function appendLinkOverlays(
  pageElement: HTMLElement,
  hit: TextMatchHit,
  reference: DocumentScriptureReference,
  onClick: ScriptureLinkClickHandler
): void {
  const encoded = encodeReference(reference);
  const label = formatVerseReference(toVerseContext(reference));
  const rects = hit.ranges.flatMap((range) => getMatchClientRects(range, hit.start, hit.end));

  for (const rect of rects) {
    if (rect.width < 0.5 || rect.height < 0.5) {
      continue;
    }

    const link = pageElement.ownerDocument.createElement('button');
    link.type = 'button';
    link.className = SCRIPTURE_LINK_CLASS;
    link.dataset['scriptureRef'] = encoded;
    link.setAttribute('aria-label', `Open ${label} in Translations`);
    link.title = label;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const decoded = decodeReference(link.dataset['scriptureRef'] ?? null) ?? reference;
      onClick(decoded);
    });
    placeOverlayOnPage(link, pageElement, rect);
  }
}

/**
 * Paint dashed blue scripture-link overlays for each reference whose `raw` text
 * appears in the page text layer. Longer needles are applied first so ranges win
 * over nested shorter citations when both appear.
 */
export function applyScriptureLinkOverlays(
  pageElement: HTMLElement,
  textNodes: HTMLElement[],
  references: DocumentScriptureReference[],
  onClick: ScriptureLinkClickHandler
): number {
  clearScriptureLinks(pageElement);

  if (references.length === 0 || textNodes.length === 0) {
    return 0;
  }

  const { haystack, ranges } = buildTextLayerHaystack(textNodes);
  if (!haystack) {
    return 0;
  }

  const sorted = [...references].sort((left, right) => (
    normalizeDocumentMatchText(right.raw).length - normalizeDocumentMatchText(left.raw).length
  ));

  let applied = 0;
  const claimed: Array<{ start: number; end: number }> = [];

  for (const reference of sorted) {
    let searchFrom = 0;
    while (searchFrom < haystack.length) {
      const hit = findNeedleInHaystack(haystack, ranges, reference.raw, searchFrom);
      if (!hit) {
        break;
      }

      const overlaps = claimed.some((span) => hit.start < span.end && hit.end > span.start);
      if (!overlaps) {
        appendLinkOverlays(pageElement, hit, reference, onClick);
        claimed.push({ start: hit.start, end: hit.end });
        applied += 1;
      }

      searchFrom = hit.end;
    }
  }

  return applied;
}

export { clearScriptureLinks };
