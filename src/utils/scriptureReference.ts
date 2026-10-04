/** Verse list suffix such as "16-18, 20": runs longer than two verses collapse into a range. */
export const formatVerseList = (verses: readonly number[]): string => {
  const normalizedVerses = Array.from(new Set(verses.filter((verse) => Number.isInteger(verse) && verse > 0)))
    .sort((left, right) => left - right);
  if (normalizedVerses.length === 0) {
    return '';
  }

  const parts: string[] = [];
  let rangeStart = normalizedVerses[0];
  let previousVerse = normalizedVerses[0];

  const pushRun = () => {
    const runLength = previousVerse - rangeStart + 1;
    parts.push(
      runLength > 2
        ? `${rangeStart}-${previousVerse}`
        : normalizedVerses
          .slice(normalizedVerses.indexOf(rangeStart), normalizedVerses.indexOf(previousVerse) + 1)
          .join(', ')
    );
  };

  for (let index = 1; index < normalizedVerses.length; index += 1) {
    const verseNumber = normalizedVerses[index];
    if (verseNumber === previousVerse + 1) {
      previousVerse = verseNumber;
      continue;
    }

    pushRun();
    rangeStart = verseNumber;
    previousVerse = verseNumber;
  }

  pushRun();
  return parts.join(', ');
};

/** "John 3:16-18, 20", or "John 3" when no verse is selected. */
export const formatVerseReference = (book: string, chapter: number, verses: readonly number[] = []): string => {
  const suffix = formatVerseList(verses);
  return suffix ? `${book} ${chapter}:${suffix}` : `${book} ${chapter}`;
};
