import type { VerseContext } from '../models/tab';

export const normalizeVerseNumbers = (verses: number[]): number[] => (
  Array.from(new Set(
    verses.filter((entry) => Number.isInteger(entry) && entry > 0)
  )).sort((left, right) => left - right)
);

export const versesFromContext = (context: VerseContext): number[] => {
  const fromArray = Array.isArray(context.verses) ? normalizeVerseNumbers(context.verses) : [];
  if (fromArray.length > 0) {
    return fromArray;
  }

  return Number.isInteger(context.verse) && context.verse > 0 ? [context.verse] : [];
};

export const formatVerseRange = (verses: number[]): string => {
  const normalized = normalizeVerseNumbers(verses);
  if (normalized.length === 0) {
    return '';
  }

  const parts: string[] = [];
  let rangeStart = normalized[0];
  let previousVerse = normalized[0];

  const flush = () => {
    parts.push(rangeStart === previousVerse ? `${rangeStart}` : `${rangeStart}-${previousVerse}`);
  };

  for (let index = 1; index < normalized.length; index += 1) {
    const verseNumber = normalized[index];
    if (verseNumber === previousVerse + 1) {
      previousVerse = verseNumber;
      continue;
    }

    flush();
    rangeStart = verseNumber;
    previousVerse = verseNumber;
  }

  flush();
  return parts.join(', ');
};

export const formatVerseReference = (context: VerseContext): string => {
  const verses = versesFromContext(context);
  const range = formatVerseRange(verses.length > 0 ? verses : [context.verse]);
  return `${context.book} ${context.chapter}:${range}`;
};

export const sameVerseContext = (
  left: VerseContext | null | undefined,
  right: VerseContext | null | undefined
): boolean => {
  if (!left || !right) {
    return false;
  }

  if (left.book !== right.book || left.chapter !== right.chapter) {
    return false;
  }

  const leftVerses = versesFromContext(left);
  const rightVerses = versesFromContext(right);
  return leftVerses.length === rightVerses.length
    && leftVerses.every((verse, index) => verse === rightVerses[index]);
};

export const firstVerseContext = (context: VerseContext): VerseContext => {
  const verse = versesFromContext(context)[0] ?? context.verse;
  return {
    book: context.book,
    chapter: context.chapter,
    verse,
    verses: [verse],
  };
};

/**
 * Resolve the currently selected verses into a panel VerseContext, if any.
 */
export const resolveSelectedVerseContext = (
  selectedBook: string | null | undefined,
  selectedChapter: number,
  selectedVerses: number[]
): VerseContext | null => {
  if (!selectedBook) {
    return null;
  }

  const verses = normalizeVerseNumbers(selectedVerses);
  if (verses.length === 0) {
    return null;
  }

  return {
    book: selectedBook,
    chapter: selectedChapter,
    verse: verses[0],
    verses,
  };
};
