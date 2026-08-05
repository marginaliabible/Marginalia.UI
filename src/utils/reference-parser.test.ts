import type { BibleBook } from '../models/bible';
import { parseQuickJump } from './reference-parser';

const books: BibleBook[] = [
  {
    name: 'II Corinthians',
    chapters: [
      {
        chapter: 9,
        verses: [
          { verse: 8, text: 'And God is able to make all grace abound toward you.' },
          { verse: 9, text: 'As it is written, He hath dispersed abroad.' },
        ],
      },
    ],
  },
  {
    name: 'I Corinthians',
    chapters: [
      {
        chapter: 13,
        verses: [
          { verse: 4, text: 'Charity suffereth long, and is kind.' },
          { verse: 5, text: 'Doth not behave itself unseemly.' },
          { verse: 6, text: 'Rejoiceth not in iniquity.' },
        ],
      },
    ],
  },
  {
    name: 'John',
    chapters: [
      {
        chapter: 3,
        verses: [
          { verse: 16, text: 'For God so loved the world.' },
          { verse: 17, text: 'For God sent not his Son into the world to condemn the world.' },
          { verse: 18, text: 'He that believeth on him is not condemned.' },
        ],
      },
    ],
  },
];

describe('parseQuickJump', () => {
  describe('Roman and Arabic numerals', () => {
    it('accepts arabic numerals for numbered books', () => {
      expect(parseQuickJump('2 Cor 9:8', books)).toEqual({
        book: 'II Corinthians',
        chapter: 9,
        verse: 8,
      });
    });

    it('accepts roman numerals for numbered books', () => {
      expect(parseQuickJump('II Cor 9:8', books)).toEqual({
        book: 'II Corinthians',
        chapter: 9,
        verse: 8,
      });
    });

    it('accepts first/second ordinal aliases', () => {
      expect(parseQuickJump('first corinthians 13:4', books)).toEqual({
        book: 'I Corinthians',
        chapter: 13,
        verse: 4,
      });

      expect(parseQuickJump('2nd corinthians 9:8', books)).toEqual({
        book: 'II Corinthians',
        chapter: 9,
        verse: 8,
      });
    });
  });

  describe('Full name and abbreviated book names', () => {
    it('accepts full book names', () => {
      expect(parseQuickJump('II Corinthians 9:8', books)).toEqual({
        book: 'II Corinthians',
        chapter: 9,
        verse: 8,
      });
    });

    it('accepts abbreviated names and compact aliases', () => {
      expect(parseQuickJump('2 Cor 9:8', books)).toEqual({
        book: 'II Corinthians',
        chapter: 9,
        verse: 8,
      });

      expect(parseQuickJump('2co 9:8', books)).toEqual({
        book: 'II Corinthians',
        chapter: 9,
        verse: 8,
      });
    });
  });

  describe('Period and no-period variants', () => {
    it('accepts abbreviated names with a trailing period', () => {
      expect(parseQuickJump('2 Cor. 9:8', books)).toEqual({
        book: 'II Corinthians',
        chapter: 9,
        verse: 8,
      });
    });

    it('accepts abbreviated names without a trailing period', () => {
      expect(parseQuickJump('2 Cor 9:8', books)).toEqual({
        book: 'II Corinthians',
        chapter: 9,
        verse: 8,
      });
    });
  });

  describe('Other fundamental quickjump variations', () => {
    it('accepts chapter-only jumps', () => {
      expect(parseQuickJump('John 3', books)).toEqual({
        book: 'John',
        chapter: 3,
      });
    });

    it('accepts verse ranges with hyphen and en dash', () => {
      expect(parseQuickJump('John 3:16-18', books)).toEqual({
        book: 'John',
        chapter: 3,
        verse: 16,
        rangeEnd: 18,
      });

      expect(parseQuickJump('John 3:16–18', books)).toEqual({
        book: 'John',
        chapter: 3,
        verse: 16,
        rangeEnd: 18,
      });
    });

    it('is case-insensitive and tolerates extra whitespace', () => {
      expect(parseQuickJump('   jOhN   3:16   ', books)).toEqual({
        book: 'John',
        chapter: 3,
        verse: 16,
      });
    });

    it('rejects invalid chapter and verse references', () => {
      expect(parseQuickJump('John 99:1', books)).toBeNull();
      expect(parseQuickJump('John 3:99', books)).toBeNull();
      expect(parseQuickJump('John', books)).toBeNull();
    });
  });
});