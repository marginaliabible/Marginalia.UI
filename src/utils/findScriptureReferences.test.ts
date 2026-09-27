import type { BibleBook } from '../models/bible';
import { findScriptureReferences } from './findScriptureReferences';

const books: BibleBook[] = [
  {
    name: 'Romans',
    chapters: [
      {
        chapter: 10,
        verses: [
          { verse: 9, text: 'a' },
          { verse: 10, text: 'b' },
        ],
      },
      {
        chapter: 12,
        verses: [
          { verse: 1, text: 'c' },
          { verse: 2, text: 'd' },
          { verse: 3, text: 'e' },
        ],
      },
    ],
  },
];

describe('findScriptureReferences', () => {
  it('finds a verse range in free text', () => {
    expect(findScriptureReferences('See Rom. 12:1-3 for more.', books)).toEqual([
      {
        raw: 'Rom. 12:1-3',
        book: 'Romans',
        chapter: 12,
        verses: [1, 2, 3],
      },
    ]);
  });

  it('finds comma-separated verses', () => {
    expect(findScriptureReferences('As in Rom. 10:9, 10.', books)).toEqual([
      {
        raw: 'Rom. 10:9, 10',
        book: 'Romans',
        chapter: 10,
        verses: [9, 10],
      },
    ]);
  });
});
