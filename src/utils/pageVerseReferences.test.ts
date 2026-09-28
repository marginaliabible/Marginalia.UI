import type { BibleBook } from '../models/bible';
import {
  groupPageVerseEntries,
  parsePageVerseEntries,
  parseReferenceRef,
  toVerseContext,
} from './pageVerseReferences';

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

describe('pageVerseReferences', () => {
  it('parses research-style refs', () => {
    expect(parseReferenceRef('ROM.10.9')).toEqual({
      bookToken: 'ROM',
      chapter: 10,
      verse: 9,
    });
  });

  it('groups a range citation into one multi-verse reference', () => {
    const entries = parsePageVerseEntries([
      { ref: 'ROM.12.1', raw: 'Rom. 12:1-3' },
      { ref: 'ROM.12.2', raw: 'Rom. 12:1-3' },
      { ref: 'ROM.12.3', raw: 'Rom. 12:1-3' },
    ]);

    expect(groupPageVerseEntries(entries, books)).toEqual([
      {
        raw: 'Rom. 12:1-3',
        book: 'Romans',
        chapter: 12,
        verses: [1, 2, 3],
      },
    ]);
  });

  it('groups comma citations into one multi-verse reference', () => {
    const entries = parsePageVerseEntries([
      { ref: 'ROM.10.9', raw: 'Rom. 10:9, 10' },
      { ref: 'ROM.10.10', raw: 'Rom. 10:9, 10' },
    ]);

    const grouped = groupPageVerseEntries(entries, books);
    expect(toVerseContext(grouped[0])).toEqual({
      book: 'Romans',
      chapter: 10,
      verse: 9,
      verses: [9, 10],
    });
  });
});
