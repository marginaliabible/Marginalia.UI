import {
  compareBibleReferences,
  isNewTestamentBook,
} from './book-aliases';

describe('compareBibleReferences', () => {
  it('sorts references canonically by book, chapter, and verse', () => {
    const references = [
      { book: 'Revelation', chapter: 1, verse: 1 },
      { book: 'Genesis', chapter: 2, verse: 1 },
      { book: 'Matthew', chapter: 1, verse: 1 },
      { book: 'Genesis', chapter: 1, verse: 2 },
      { book: 'Genesis', chapter: 1, verse: 1 },
    ];

    expect(references.sort(compareBibleReferences)).toEqual([
      { book: 'Genesis', chapter: 1, verse: 1 },
      { book: 'Genesis', chapter: 1, verse: 2 },
      { book: 'Genesis', chapter: 2, verse: 1 },
      { book: 'Matthew', chapter: 1, verse: 1 },
      { book: 'Revelation', chapter: 1, verse: 1 },
    ]);
  });
});

describe('isNewTestamentBook', () => {
  it('classifies canonical names and aliases by Testament', () => {
    expect(isNewTestamentBook('Malachi')).toBe(false);
    expect(isNewTestamentBook('Matt')).toBe(true);
  });
});