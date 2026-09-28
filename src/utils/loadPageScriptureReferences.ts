import type { BibleBook } from '../models/bible';
import { fetchStorageAware } from '../services/storageAuthenticatedFetch';
import { findScriptureReferences } from './findScriptureReferences';
import {
  buildPageVersesJsonUrl,
  groupPageVerseEntries,
  parsePageVerseEntries,
  type DocumentScriptureReference,
} from './pageVerseReferences';

/**
 * Resolve scripture citations for one document page.
 * Prefers `pageN.verses.json` when a pages base URL is available; otherwise
 * (or on fetch failure) detects references from the visible page text.
 */
export async function loadPageScriptureReferences(options: {
  pageNumber: number;
  books: readonly BibleBook[];
  pagesBaseUrl: string | null;
  pageText: string;
}): Promise<DocumentScriptureReference[]> {
  const { pageNumber, books, pagesBaseUrl, pageText } = options;
  if (!books.length) {
    return [];
  }

  if (pagesBaseUrl) {
    try {
      const versesUrl = buildPageVersesJsonUrl(pagesBaseUrl, pageNumber);
      const response = await fetchStorageAware(versesUrl);
      if (response.ok) {
        const payload = await response.json();
        const fromJson = groupPageVerseEntries(parsePageVerseEntries(payload), books);
        if (fromJson.length > 0) {
          return fromJson;
        }
      }
    } catch {
      // Fall through to client-side detection.
    }
  }

  if (!pageText.trim()) {
    return [];
  }

  return findScriptureReferences(pageText, books);
}
