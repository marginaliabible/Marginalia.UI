import type { BibleBook } from '../models/bible';
import { parseQuickJump } from './reference-parser';

describe('parseQuickJump', () => {
  const mockBooks: BibleBook[] = [
    {
      name: 'Genesis',
      chapters: [
        {
          chapter: 1,
          verses: [
            { verse: 1, text: 'In the beginning...' },
            { verse: 2, text: 'And the earth was...' },
            { verse: 3, text: 'And God said...' }
          ]
        },
        {
          chapter: 2,
          verses: [
            { verse: 1, text: 'Thus the heavens...' }
          ]
        }
      ]
    },
    {
      name: 'Romans',
      chapters: [
        {
          chapter: 10,
          verses: [
            { verse: 1, text: 'Brethren, my heart\'s desire...' },
            { verse: 9, text: 'That if thou shalt confess...' },
            { verse: 13, text: 'For whosoever shall call...' }
          ]
        }
      ]
    },
    {
      name: '1 Corinthians',
      chapters: [
        {
          chapter: 13,
          verses: [
            { verse: 1, text: 'Though I speak with the tongues...' },
            { verse: 13, text: 'And now abideth faith, hope, charity...' }
          ]
        }
      ]
    },
    {
      name: 'John',
      chapters: [
        {
          chapter: 3,
          verses: [
            { verse: 16, text: 'For God so loved the world...' }
          ]
        }
      ]
    }
  ];

  describe('book name with chapter and verse', () => {
    it('should parse "Gen 1:3"', () => {
      const result = parseQuickJump('Gen 1:3', mockBooks);
      expect(result).not.toBeNull();
      expect(result?.book).toBe('Genesis');
      expect(result?.chapter).toBe(1);
      expect(result?.verse).toBe(3);
    });

    it('should parse "John 3:16"', () => {
      const result = parseQuickJump('John 3:16', mockBooks);
      expect(result).not.toBeNull();
      expect(result?.book).toBe('John');
      expect(result?.chapter).toBe(3);
      expect(result?.verse).toBe(16);
    });

    it('should parse lowercase "gen 1:3"', () => {
      const result = parseQuickJump('gen 1:3', mockBooks);
      expect(result).not.toBeNull();
      expect(result?.book).toBe('Genesis');
      expect(result?.chapter).toBe(1);
      expect(result?.verse).toBe(3);
    });
  });

  describe('book name with chapter only', () => {
    it('should parse "Romans 10"', () => {
      const result = parseQuickJump('Romans 10', mockBooks);
      expect(result).not.toBeNull();
      expect(result?.book).toBe('Romans');
      expect(result?.chapter).toBe(10);
      expect(result?.verse).toBeUndefined();
    });

    it('should parse "Gen 2"', () => {
      const result = parseQuickJump('Gen 2', mockBooks);
      expect(result).not.toBeNull();
      expect(result?.book).toBe('Genesis');
      expect(result?.chapter).toBe(2);
      expect(result?.verse).toBeUndefined();
    });
  });

  describe('abbreviated book names', () => {
    it('should parse "Rom 10"', () => {
      const result = parseQuickJump('Rom 10', mockBooks);
      expect(result).not.toBeNull();
      expect(result?.book).toBe('Romans');
      expect(result?.chapter).toBe(10);
    });

    it('should parse "1 Cor 13"', () => {
      const result = parseQuickJump('1 Cor 13', mockBooks);
      expect(result).not.toBeNull();
      expect(result?.book).toBe('1 Corinthians');
      expect(result?.chapter).toBe(13);
    });

    it('should parse "1Cor 13" (no space)', () => {
      const result = parseQuickJump('1Cor 13', mockBooks);
      expect(result).not.toBeNull();
      expect(result?.book).toBe('1 Corinthians');
      expect(result?.chapter).toBe(13);
    });
  });

  describe('verse ranges', () => {
    it('should parse "Rom 10:9-13"', () => {
      const result = parseQuickJump('Rom 10:9-13', mockBooks);
      expect(result).not.toBeNull();
      expect(result?.book).toBe('Romans');
      expect(result?.chapter).toBe(10);
      expect(result?.verse).toBe(9);
      expect(result?.rangeEnd).toBe(13);
    });

    it('should parse "Gen 1:1–3" (en dash)', () => {
      const result = parseQuickJump('Gen 1:1–3', mockBooks);
      expect(result).not.toBeNull();
      expect(result?.book).toBe('Genesis');
      expect(result?.chapter).toBe(1);
      expect(result?.verse).toBe(1);
      expect(result?.rangeEnd).toBe(3);
    });
  });

  describe('invalid inputs', () => {
    it('should return null for empty string', () => {
      const result = parseQuickJump('', mockBooks);
      expect(result).toBeNull();
    });

    it('should return null for whitespace only', () => {
      const result = parseQuickJump('   ', mockBooks);
      expect(result).toBeNull();
    });

    it('should return null for unknown book', () => {
      const result = parseQuickJump('Hezekiah 9:12', mockBooks);
      expect(result).toBeNull();
    });

    it('should return null for invalid chapter', () => {
      const result = parseQuickJump('Gen 999', mockBooks);
      expect(result).toBeNull();
    });

    it('should return null for invalid verse', () => {
      const result = parseQuickJump('Gen 1:999', mockBooks);
      expect(result).toBeNull();
    });

    it('should return null for book name only', () => {
      const result = parseQuickJump('Genesis', mockBooks);
      expect(result).toBeNull();
    });

    it('should return null for incomplete reference', () => {
      const result = parseQuickJump('Gen ', mockBooks);
      expect(result).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should handle extra whitespace', () => {
      const result = parseQuickJump('  Gen  1:3  ', mockBooks);
      expect(result).not.toBeNull();
      expect(result?.book).toBe('Genesis');
      expect(result?.chapter).toBe(1);
      expect(result?.verse).toBe(3);
    });

    it('should handle mixed case', () => {
      const result = parseQuickJump('GeN 1:3', mockBooks);
      expect(result).not.toBeNull();
      expect(result?.book).toBe('Genesis');
      expect(result?.chapter).toBe(1);
      expect(result?.verse).toBe(3);
    });
  });
});
