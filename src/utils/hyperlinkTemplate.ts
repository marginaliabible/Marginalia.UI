import type { VerseContext } from '../models/tab';
import { getBookAbbreviation, getBookUrlName } from './book-aliases';

// abbr_book alternatives must precede book so the shorter token cannot match first.
const TOKEN_PATTERN = /\{(chapter|verse|abbr_book|Abbr_Book|ABBR_BOOK|book|Book|BOOK)([_-])?\}/g;

type BookToken = 'book' | 'Book' | 'BOOK' | 'abbr_book' | 'Abbr_Book' | 'ABBR_BOOK';

const toTitleCase = (value: string): string =>
  value.replace(/[^\s_-]+/g, (word) => word.replace(/[a-z]/, (letter) => letter.toUpperCase()));

const applyCasing = (value: string, token: BookToken): string => {
  if (token === 'BOOK' || token === 'ABBR_BOOK') {
    return value.toUpperCase();
  }
  if (token === 'Book' || token === 'Abbr_Book') {
    return toTitleCase(value);
  }
  return value.toLowerCase();
};

const applySeparator = (value: string, separator: string | undefined): string =>
  separator ? value.replace(/\s+/g, separator) : encodeURIComponent(value);

const isSafeHttpUrl = (value: string): boolean => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * Substitutes verse tokens into a hyperlink template. Returns null when the result
 * is not a well-formed http(s) URL.
 */
export function resolveHyperlinkTemplate(template: string, verse: VerseContext): string | null {
  const abbreviation = getBookAbbreviation(verse.book);
  const bookName = getBookUrlName(verse.book);

  const resolved = template.replace(TOKEN_PATTERN, (_match, token: string, separator?: string) => {
    if (token === 'chapter') {
      return String(verse.chapter);
    }
    if (token === 'verse') {
      return String(verse.verse);
    }

    const bookToken = token as BookToken;
    const base = bookToken.toLowerCase() === 'abbr_book' ? abbreviation : bookName;
    return applySeparator(applyCasing(base, bookToken), separator);
  });

  return isSafeHttpUrl(resolved) ? resolved : null;
}
