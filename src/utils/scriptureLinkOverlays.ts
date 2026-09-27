import {
  SCRIPTURE_LINK_CLASS,
  buildTextLayerHaystack,
  findNeedleInHaystack,
  normalizeDocumentMatchText,
  type TextNodeRange,
} from './documentTextMatch';
import type { DocumentScriptureReference } from './pageVerseReferences';

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
  hitRanges: TextNodeRange[],
  reference: DocumentScriptureReference,
  onClick: ScriptureLinkClickHandler
): void {
  const pageRect = pageElement.getBoundingClientRect();
  const encoded = encodeReference(reference);

  for (const range of hitRanges) {
    const rect = range.node.getBoundingClientRect();
    if (rect.width < 0.5 || rect.height < 0.5 || pageRect.width < 0.5 || pageRect.height < 0.5) {
      continue;
    }

    const link = pageElement.ownerDocument.createElement('button');
    link.type = 'button';
    link.className = SCRIPTURE_LINK_CLASS;
    link.dataset['scriptureRef'] = encoded;
    link.setAttribute('aria-label', `Open ${reference.raw} in Translations`);
    link.title = reference.raw;
    link.style.left = `${rect.left - pageRect.left}px`;
    link.style.top = `${rect.top - pageRect.top}px`;
    link.style.width = `${Math.max(rect.width, 2)}px`;
    link.style.height = `${Math.max(rect.height, 2)}px`;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const decoded = decodeReference(link.dataset['scriptureRef'] ?? null) ?? reference;
      onClick(decoded);
    });
    pageElement.style.position = pageElement.style.position || 'relative';
    pageElement.appendChild(link);
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
        appendLinkOverlays(pageElement, hit.ranges, reference, onClick);
        claimed.push({ start: hit.start, end: hit.end });
        applied += 1;
      }

      searchFrom = hit.end;
    }
  }

  return applied;
}

export { clearScriptureLinks };
