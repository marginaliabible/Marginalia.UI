import type { BibleBook } from '../models/bible';
import { BOOK_ALIAS_MATCHERS, getCanonicalBookName } from './book-aliases';
import type { DocumentScriptureReference } from './pageVerseReferences';
import { expandVerseSpec } from './verseSpec';
import { normalizeVerseNumbers } from './selectedVerseContext';
import { readRomanNumeral } from './romanNumerals';

const chapterVersePattern = /^(\d{1,3}):(\d{1,3}(?:\s*[-–,]\s*\d{1,3})*)/;
// Older citations: `Rev. xviii. 21, 22, 23` — chapter as a roman numeral, period or space (never `:`) before the verse.
const romanChapterPattern =
  /^([ivxlcIVXLC]{1,8})(?:([ \t]*\.\s*|[ \t]+)([0-9Iil|]{1,3}(?:\s*[-–,]\s*\d{1,3})*)(?![A-Za-z0-9])|(?![A-Za-z0-9]|[ \t]*[:;][ \t]*[0-9Iil|]))/;
// A look-alike verse must not be the pronoun `I` (`Rom. iii. I think`) or start `i.e.`.
const glyphVerseFollowedByWord = /^(?:[ \t]*['\u2019]|[ \t]+[A-Za-z]|\.[A-Za-z])/;
const bookNumberPrefix = /^(?:[123](?:st|nd|rd)?\s*|i{1,3}\s+|(?:first|second|third)\s+)/i;

/**
 * Find scripture citations in free text (e.g. document page OCR / PDF text layer).
 * Supports ranges (`Rom. 12:1-3`), comma lists (`Rom. 10:9, 10`), and roman-numeral chapters
 * (`Rev. xviii. 21, 22, 23`).
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
    let matched: { book: string; matchedLength: number; remainder: string; rawBook: string } | null = null;

    for (const matcher of BOOK_ALIAS_MATCHERS) {
      const match = slice.match(matcher.regex);
      if (!match) {
        continue;
      }
      matched = {
        book: matcher.book,
        matchedLength: match[0].length,
        remainder: slice.slice(match[0].length),
        rawBook: match[0],
      };
      break;
    }

    if (!matched) {
      index += 1;
      continue;
    }

    const bibleBook = bookByCanonical.get(matched.book);
    if (!bibleBook) {
      index += matched.matchedLength;
      continue;
    }

    const arabic = tryArabicCitation(matched.remainder, bibleBook, books);
    if (arabic) {
      const rawLength = matched.matchedLength + arabic.consumed;
      results.push({
        raw: text.slice(index, index + rawLength).replace(/\s+/g, ' ').trim(),
        book: bibleBook,
        chapter: arabic.chapter,
        verses: normalizeVerseNumbers(arabic.verses),
      });
      index += rawLength;
      continue;
    }

    const roman = tryRomanCitation(matched.rawBook, matched.remainder, bibleBook, books);
    if (roman) {
      const rawLength = matched.matchedLength + roman.consumed;
      results.push({
        raw: text.slice(index, index + rawLength).replace(/\s+/g, ' ').trim(),
        book: bibleBook,
        chapter: roman.chapter,
        verses: normalizeVerseNumbers(roman.verses),
      });
      index += rawLength;
      continue;
    }

    index += matched.matchedLength;
  }

  return dedupeReferences(results);
}

function tryArabicCitation(
  remainder: string,
  bibleBook: string,
  books: readonly BibleBook[]
): { chapter: number; verses: number[]; consumed: number } | null {
  const trimmed = remainder.replace(/^\s+/, '');
  const leadingWs = remainder.length - trimmed.length;
  const chapterMatch = trimmed.match(chapterVersePattern);
  if (!chapterMatch) {
    return null;
  }

  const chapter = Number.parseInt(chapterMatch[1] ?? '', 10);
  const verses = expandVerseSpec(chapterMatch[2] ?? '');
  if (!Number.isInteger(chapter) || chapter <= 0 || verses.length === 0) {
    return null;
  }

  const validVerses = filterExistingVerses(books, bibleBook, chapter, verses);
  if (validVerses.length === 0) {
    return null;
  }

  return { chapter, verses: validVerses, consumed: leadingWs + chapterMatch[0].length };
}

function tryRomanCitation(
  rawBook: string,
  remainder: string,
  bibleBook: string,
  books: readonly BibleBook[]
): { chapter: number; verses: number[]; consumed: number } | null {
  const bookHadPeriod = /\.\s*$/.test(rawBook);
  // When the alias match ate the period (`Rev.`), treat that as a `.` separator; otherwise require
  // whitespace (or a leftover period) before the numeral.
  const separatorMatch = bookHadPeriod
    ? remainder.match(/^(\s*)/)
    : remainder.match(/^(\.\s+|\s+)/);
  if (!separatorMatch || (separatorMatch[0] === '' && !bookHadPeriod)) {
    return null;
  }

  const afterSeparator = remainder.slice(separatorMatch[0].length);
  const chapterMatch = afterSeparator.match(romanChapterPattern);
  if (!chapterMatch) {
    return null;
  }

  const numeral = chapterMatch[1] ?? '';
  const chapterSeparator = chapterMatch[2] ?? '';
  const verseList = chapterMatch[3] ?? '';
  const bookSeparator = bookHadPeriod ? `.${separatorMatch[0]}` : separatorMatch[0];

  if (!isCitationBookSpelling(rawBook, bookSeparator)) {
    return null;
  }

  const chapters = readRomanNumeral(numeral);
  if (chapters.length === 0) {
    return null;
  }

  const following = afterSeparator.slice(chapterMatch[0].length);
  const verses = readRomanCitationVerses(verseList, following);
  // The pronoun `I` (`Mark I 5 times`) only counts as chapter one in full `Gen. I. 3` notation.
  if (
    numeral === 'I'
    && !(bookSeparator.startsWith('.') && chapterSeparator.includes('.') && verses && !verses.corrected)
  ) {
    return null;
  }
  if (!verses) {
    return null;
  }

  // An OCR `Ix` that reads as both lx and ix is kept only when exactly one reading names an existing verse.
  // Unlike Arabic citations, a missing chapter never counts — otherwise both lx and ix can "succeed".
  const book = books.find((entry) => entry.name === bibleBook);
  const readings = chapters
    .map((chapter) => {
      const chapterEntry = book?.chapters.find((entry) => entry.chapter === chapter.value);
      if (!chapterEntry) {
        return { chapter: chapter.value, verses: [] as number[] };
      }
      const valid = expandVerseSpec(verses.spec)
        .filter((verse) => chapterEntry.verses.some((entry) => entry.verse === verse));
      return { chapter: chapter.value, verses: valid };
    })
    .filter((reading) => reading.verses.length > 0);
  if (readings.length !== 1) {
    return null;
  }

  const reading = readings[0]!;
  return {
    chapter: reading.chapter,
    verses: reading.verses,
    consumed: separatorMatch[0].length + chapterMatch[0].length,
  };
}

/** Roman-chapter citations capitalize the book, and a two-letter abbreviation needs its period (`Ps.`, not `Am`). */
function isCitationBookSpelling(rawBook: string, bookSeparator: string): boolean {
  const name = rawBook.replace(bookNumberPrefix, '').replace(/\.+\s*$/, '');
  return /^[A-Z]/.test(name) && (name.replace(/\s+/g, '').length > 2 || bookSeparator.startsWith('.'));
}

/** The verse spec of a roman-chapter citation, reading a look-alike first verse (`II`, `i8`) as digits. */
function readRomanCitationVerses(
  verseList: string,
  following: string
): { spec: string; corrected: boolean } | null {
  // Keep `-` at the end of the class so it stays literal (not a range through en-dash that would exclude digits).
  const first = verseList.match(/^[^\s,–-]+/)?.[0];
  if (!first) {
    return null;
  }
  if (/^\d+$/.test(first)) {
    return { spec: verseList, corrected: false };
  }
  if (first.length === verseList.length && glyphVerseFollowedByWord.test(following)) {
    return null;
  }
  const digits = first.replace(/[Iil|]/g, '1');
  return /^[1-9]\d*$/.test(digits) ? { spec: digits + verseList.slice(first.length), corrected: true } : null;
}

function filterExistingVerses(
  books: readonly BibleBook[],
  bibleBook: string,
  chapter: number,
  verses: number[]
): number[] {
  const chapterEntry = books.find((book) => book.name === bibleBook)
    ?.chapters.find((entry) => entry.chapter === chapter);
  return chapterEntry
    ? verses.filter((verse) => chapterEntry.verses.some((entry) => entry.verse === verse))
    : verses;
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
