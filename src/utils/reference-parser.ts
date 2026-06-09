import type { BibleBook, QuickJumpTarget } from '../models/bible';
import { BOOK_ALIAS_MATCHERS } from './book-aliases';

const chapterPattern = /^(\d{1,3})(?::(\d{1,3})(?:[-–](\d{1,3}))?)?$/;

export function parseQuickJump(query: string, books: readonly BibleBook[]): QuickJumpTarget | null {
  const trimmed = query.trim();
  if (!trimmed) {
    return null;
  }

  const bookMatch = findBook(trimmed, books);
  if (!bookMatch) {
    return null;
  }

  const book = books.find((b) => b.name.toLowerCase() === bookMatch.book.toLowerCase());
  if (!book) {
    return null;
  }

  const remainder = bookMatch.remainder.trim();
  if (!remainder) {
    return null;
  }

  const chapterMatch = remainder.match(chapterPattern);
  if (!chapterMatch) {
    return null;
  }

  const chapterNumber = Number.parseInt(chapterMatch[1] ?? '', 10);
  if (!Number.isFinite(chapterNumber)) {
    return null;
  }

  const chapter = book.chapters.find((c) => c.chapter === chapterNumber);
  if (!chapter) {
    return null;
  }

  const verseNumber = chapterMatch[2] ? Number.parseInt(chapterMatch[2], 10) : undefined;
  let verseExists = true;
  if (verseNumber !== undefined) {
    verseExists = chapter.verses.some((v) => v.verse === verseNumber);
  }

  if (!verseExists) {
    return null;
  }

  const rangeEnd = chapterMatch[3] ? Number.parseInt(chapterMatch[3], 10) : undefined;

  return {
    book: book.name,
    chapter: chapter.chapter,
    verse: verseNumber,
    rangeEnd
  };
}

function findBook(query: string, books: readonly BibleBook[]): { book: string; remainder: string } | null {
  // First try default English alias matching
  for (const matcher of BOOK_ALIAS_MATCHERS) {
    const match = query.match(matcher.regex);
    if (!match) {
      continue;
    }

    const matchedAlias = match[0];
    const remainder = query.slice(matchedAlias.length);
    return { book: matcher.book, remainder };
  }

  // Fallback: try matching directly against book names in the translation
  const lowerQuery = query.toLowerCase();
  for (const book of books) {
    const lowerBookName = book.name.toLowerCase();
    if (lowerQuery.startsWith(lowerBookName)) {
      const remainder = query.slice(book.name.length);
      return { book: book.name, remainder };
    }
  }

  return null;
}
