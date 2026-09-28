import type { BibleBook } from '../models/bible';
import { BOOK_ALIAS_MATCHERS, getCanonicalBookName } from './book-aliases';
import type { DocumentScriptureReference } from './pageVerseReferences';
import { expandVerseSpec } from './verseSpec';
import { normalizeVerseNumbers } from './selectedVerseContext';

const chapterVersePattern = /^(\d{1,3}):(\d{1,3}(?:\s*[-–,]\s*\d{1,3})*)/;

/**
 * Find scripture citations in free text (e.g. document page OCR / PDF text layer).
 * Supports ranges (`Rom. 12:1-3`) and comma lists (`Rom. 10:9, 10`).
 */
export function findScriptureReferences(
  text: string,
  books: readonly BibleBook[]
): DocumentScriptureReference[] {
  const results: DocumentScriptureReference[] = [];
  if (!text.trim() || books.length === 0) {
    return results;
  }

  const bookByCanonical = new Map(
    books.map((book) => [getCanonicalBookName(book.name) ?? book.name, book.name] as const)
  );

  let index = 0;
  while (index < text.length) {
    const slice = text.slice(index);
    let matched: { book: string; matchedLength: number; remainder: string } | null = null;

    for (const matcher of BOOK_ALIAS_MATCHERS) {
      const match = slice.match(matcher.regex);
      if (!match) {
        continue;
      }
      matched = {
        book: matcher.book,
        matchedLength: match[0].length,
        remainder: slice.slice(match[0].length),
      };
      break;
    }

    if (!matched) {
      index += 1;
      continue;
    }

    const remainder = matched.remainder.replace(/^\s+/, '');
    const leadingWs = matched.remainder.length - remainder.length;
    const chapterMatch = remainder.match(chapterVersePattern);
    if (!chapterMatch) {
      index += matched.matchedLength;
      continue;
    }

    const chapter = Number.parseInt(chapterMatch[1] ?? '', 10);
    const verseSpec = chapterMatch[2] ?? '';
    const verses = expandVerseSpec(verseSpec);
    const bibleBook = bookByCanonical.get(matched.book);
    if (!bibleBook || !Number.isInteger(chapter) || chapter <= 0 || verses.length === 0) {
      index += matched.matchedLength;
      continue;
    }

    const chapterEntry = books.find((book) => book.name === bibleBook)
      ?.chapters.find((entry) => entry.chapter === chapter);
    const validVerses = chapterEntry
      ? verses.filter((verse) => chapterEntry.verses.some((entry) => entry.verse === verse))
      : verses;

    if (validVerses.length === 0) {
      index += matched.matchedLength;
      continue;
    }

    const rawLength = matched.matchedLength + leadingWs + chapterMatch[0].length;
    const raw = text.slice(index, index + rawLength).replace(/\s+/g, ' ').trim();

    results.push({
      raw,
      book: bibleBook,
      chapter,
      verses: normalizeVerseNumbers(validVerses),
    });

    index += rawLength;
  }

  return dedupeReferences(results);
}

function dedupeReferences(references: DocumentScriptureReference[]): DocumentScriptureReference[] {
  const seen = new Set<string>();
  const output: DocumentScriptureReference[] = [];
  for (const reference of references) {
    const key = `${reference.raw}|${reference.book}|${reference.chapter}|${reference.verses.join(',')}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(reference);
  }
  return output;
}
