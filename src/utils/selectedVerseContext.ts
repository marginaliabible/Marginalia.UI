import type { VerseContext } from '../models/tab';

/**
 * Resolve the currently selected verse into a panel VerseContext, if any.
 */
export const resolveSelectedVerseContext = (
  selectedBook: string | null | undefined,
  selectedChapter: number,
  selectedVerses: number[]
): VerseContext | null => {
  if (!selectedBook) {
    return null;
  }

  const verse = selectedVerses.find((entry) => Number.isInteger(entry) && entry > 0);
  if (!verse) {
    return null;
  }

  return {
    book: selectedBook,
    chapter: selectedChapter,
    verse,
  };
};
