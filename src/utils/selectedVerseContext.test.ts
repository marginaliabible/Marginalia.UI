import {
  firstVerseContext,
  formatVerseRange,
  formatVerseReference,
  resolveSelectedVerseContext,
  sameVerseContext,
  versesFromContext,
} from './selectedVerseContext';

describe('resolveSelectedVerseContext', () => {
  it('returns null when no book or verse is selected', () => {
    expect(resolveSelectedVerseContext(null, 1, [1])).toBeNull();
    expect(resolveSelectedVerseContext('Romans', 10, [])).toBeNull();
  });

  it('returns the first valid selected verse and the full selection', () => {
    expect(resolveSelectedVerseContext('Romans', 10, [9, 10])).toEqual({
      book: 'Romans',
      chapter: 10,
      verse: 9,
      verses: [9, 10],
    });
  });
});

describe('verse context helpers', () => {
  it('treats a missing verses array as the single primary verse', () => {
    expect(versesFromContext({ book: 'John', chapter: 3, verse: 16 })).toEqual([16]);
  });

  it('formats compressed verse ranges', () => {
    expect(formatVerseRange([1])).toBe('1');
    expect(formatVerseRange([1, 2, 3])).toBe('1-3');
    expect(formatVerseRange([1, 3, 5, 6])).toBe('1, 3, 5-6');
  });

  it('formats a multi-verse reference', () => {
    expect(formatVerseReference({
      book: 'Genesis',
      chapter: 1,
      verse: 1,
      verses: [1, 2, 3],
    })).toBe('Genesis 1:1-3');
  });

  it('compares verse contexts by the full selected range', () => {
    const single = { book: 'Genesis', chapter: 1, verse: 1 };
    const sameSingle = { book: 'Genesis', chapter: 1, verse: 1, verses: [1] };
    const range = { book: 'Genesis', chapter: 1, verse: 1, verses: [1, 2] };

    expect(sameVerseContext(single, sameSingle)).toBe(true);
    expect(sameVerseContext(single, range)).toBe(false);
  });

  it('reduces a selection to the first verse for outbound links', () => {
    expect(firstVerseContext({
      book: 'Genesis',
      chapter: 1,
      verse: 1,
      verses: [1, 2, 3],
    })).toEqual({
      book: 'Genesis',
      chapter: 1,
      verse: 1,
      verses: [1],
    });
  });
});
