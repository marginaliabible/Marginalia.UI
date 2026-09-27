import type { BibleBook } from '../models/bible';
import type { VerseContext } from '../models/tab';
import { resolveBibleBookName } from './osisBookCodes';
import { normalizeVerseNumbers } from './selectedVerseContext';

export interface PageVerseEntry {
  ref: string;
  raw: string;
  occurrences?: Array<{ documentId: string; page: number }>;
}

export interface DocumentScriptureReference {
  /** Citation text as it appears on the page (search needle). */
  raw: string;
  book: string;
  chapter: number;
  verses: number[];
}

export function parseReferenceRef(ref: string): { bookToken: string; chapter: number; verse: number } | null {
  const parts = ref.split('.');
  if (parts.length < 3) {
    return null;
  }

  const verseRaw = parts.pop();
  const chapterRaw = parts.pop();
  const bookToken = parts.join('.');
  const chapter = Number(chapterRaw);
  const verse = Number(verseRaw);

  if (!bookToken || !Number.isInteger(chapter) || !Number.isInteger(verse) || chapter <= 0 || verse <= 0) {
    return null;
  }

  return { bookToken, chapter, verse };
}

export function parsePageVerseEntries(payload: unknown): PageVerseEntry[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  const entries: PageVerseEntry[] = [];
  for (const item of payload) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const record = item as Record<string, unknown>;
    const ref = typeof record['ref'] === 'string' ? record['ref'].trim() : '';
    const raw = typeof record['raw'] === 'string' ? record['raw'].trim() : '';
    if (!ref || !raw) {
      continue;
    }
    entries.push({ ref, raw });
  }
  return entries;
}

/**
 * Group per-verse shard entries that share the same `raw` citation into one
 * clickable multi-verse reference (ranges / comma lists expand to many refs).
 */
export function groupPageVerseEntries(
  entries: PageVerseEntry[],
  books: readonly BibleBook[]
): DocumentScriptureReference[] {
  const byRaw = new Map<string, {
    book: string;
    chapter: number;
    verses: number[];
  }>();

  for (const entry of entries) {
    const parsed = parseReferenceRef(entry.ref);
    if (!parsed) {
      continue;
    }

    const book = resolveBibleBookName(parsed.bookToken, books);
    if (!book) {
      continue;
    }

    const existing = byRaw.get(entry.raw);
    if (!existing) {
      byRaw.set(entry.raw, {
        book,
        chapter: parsed.chapter,
        verses: [parsed.verse],
      });
      continue;
    }

    // Same citation text on one page should not span books/chapters; keep first.
    if (existing.book !== book || existing.chapter !== parsed.chapter) {
      continue;
    }
    existing.verses.push(parsed.verse);
  }

  return Array.from(byRaw.entries()).map(([raw, value]) => ({
    raw,
    book: value.book,
    chapter: value.chapter,
    verses: normalizeVerseNumbers(value.verses),
  })).filter((entry) => entry.verses.length > 0);
}

export function toVerseContext(reference: DocumentScriptureReference): VerseContext {
  const verses = normalizeVerseNumbers(reference.verses);
  return {
    book: reference.book,
    chapter: reference.chapter,
    verse: verses[0] ?? 1,
    verses,
  };
}

export function buildPageVersesJsonUrl(pagesBaseUrl: string, pageNumber: number): string {
  const page = Math.max(1, Math.floor(pageNumber));
  try {
    return new URL(`page${page}.verses.json`, pagesBaseUrl).toString();
  } catch {
    const base = pagesBaseUrl.endsWith('/') ? pagesBaseUrl : `${pagesBaseUrl}/`;
    return `${base}page${page}.verses.json`;
  }
}
