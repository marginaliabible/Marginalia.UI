import type { BibleBook } from '../models/bible';
import { findScriptureReferences } from './findScriptureReferences';

function chapter(n: number, verses: number): BibleBook['chapters'][number] {
  return {
    chapter: n,
    verses: Array.from({ length: verses }, (_, i) => ({ verse: i + 1, text: '' })),
  };
}

const books: BibleBook[] = [
  {
    name: 'Genesis',
    chapters: [chapter(1, 31), chapter(2, 25), chapter(4, 26)],
  },
  {
    name: 'Psalms',
    chapters: [chapter(13, 6), chapter(42, 11), chapter(119, 176), chapter(150, 6)],
  },
  {
    name: 'Isaiah',
    chapters: [chapter(6, 13), chapter(9, 21), chapter(53, 12), chapter(57, 21), chapter(60, 22)],
  },
  {
    name: 'Matthew',
    chapters: [chapter(2, 23), chapter(5, 48)],
  },
  {
    name: 'John',
    chapters: [chapter(1, 51)],
  },
  {
    name: 'Romans',
    chapters: [
      chapter(2, 29),
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
  {
    name: 'I Corinthians',
    chapters: [chapter(13, 13)],
  },
  {
    name: 'II Corinthians',
    chapters: [chapter(4, 18)],
  },
  {
    name: 'Philippians',
    chapters: [chapter(1, 30)],
  },
  {
    name: 'Jude',
    chapters: [chapter(1, 25)],
  },
  {
    name: 'Revelation',
    chapters: [chapter(8, 13), chapter(18, 24)],
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

  it('finds roman-numeral chapter citations', () => {
    expect(findScriptureReferences('Rev. xviii. 21, 22, 23.', books)).toEqual([
      {
        raw: 'Rev. xviii. 21, 22, 23',
        book: 'Revelation',
        chapter: 18,
        verses: [21, 22, 23],
      },
    ]);
    expect(findScriptureReferences('Gen. i. 3', books)).toEqual([
      { raw: 'Gen. i. 3', book: 'Genesis', chapter: 1, verses: [3] },
    ]);
    expect(findScriptureReferences('Ps. cxix. 105', books)).toEqual([
      { raw: 'Ps. cxix. 105', book: 'Psalms', chapter: 119, verses: [105] },
    ]);
    expect(findScriptureReferences('Matt. v. 3-12', books)[0]).toMatchObject({
      book: 'Matthew',
      chapter: 5,
      verses: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    });
    expect(findScriptureReferences('1 Cor. xiii. 4', books)).toEqual([
      { raw: '1 Cor. xiii. 4', book: 'I Corinthians', chapter: 13, verses: [4] },
    ]);
    expect(findScriptureReferences('Isa. liii. 5, 6', books)).toEqual([
      { raw: 'Isa. liii. 5, 6', book: 'Isaiah', chapter: 53, verses: [5, 6] },
    ]);
    expect(findScriptureReferences('II Cor. iv. 6', books)).toEqual([
      { raw: 'II Cor. iv. 6', book: 'II Corinthians', chapter: 4, verses: [6] },
    ]);
    expect(findScriptureReferences('Gen. I. 3', books)).toEqual([
      { raw: 'Gen. I. 3', book: 'Genesis', chapter: 1, verses: [3] },
    ]);
    expect(findScriptureReferences('Jude i. 3', books)).toEqual([
      { raw: 'Jude i. 3', book: 'Jude', chapter: 1, verses: [3] },
    ]);
    expect(findScriptureReferences('Rev xviii 21', books)).toEqual([
      { raw: 'Rev xviii 21', book: 'Revelation', chapter: 18, verses: [21] },
    ]);
  });

  it('reads an OCR capital I inside a lowercase numeral as l', () => {
    expect(findScriptureReferences('in Isa. Ivii. 19, he does not', books)).toEqual([
      { raw: 'Isa. Ivii. 19', book: 'Isaiah', chapter: 57, verses: [19] },
    ]);
    // Psalm 13 has 6 verses, so xlii (42) is the only reading of `xIii` that holds verse 11.
    expect(findScriptureReferences('Ps. xIii. 11', books)).toEqual([
      { raw: 'Ps. xIii. 11', book: 'Psalms', chapter: 42, verses: [11] },
    ]);
  });

  it('keeps an ambiguous OCR I only when one reading exists', () => {
    // Isaiah 9:7 and 60:7 both exist.
    expect(findScriptureReferences('Isa. Ix. 7', books)).toEqual([]);
    // Isaiah 9 has 21 verses, so only lx (60) holds verse 22.
    expect(findScriptureReferences('Isa. Ix. 22', books)).toEqual([
      { raw: 'Isa. Ix. 22', book: 'Isaiah', chapter: 60, verses: [22] },
    ]);
    expect(findScriptureReferences('Gen. Iv. 7', books)).toEqual([
      { raw: 'Gen. Iv. 7', book: 'Genesis', chapter: 4, verses: [7] },
    ]);
  });

  it('rejects roman look-alikes that are not references', () => {
    for (const text of [
      'Ivii. 19 and xxvi. 3',
      'see i.e. 3 things',
      'Smith v. 3 Jones',
      'Gen. i.e. 3',
      'Mark I 5 times',
      'Am I 3',
      'Is v 3',
      'is v. 3',
      'Gen. iiii. 3',
      'Gen. vx. 3',
      'Jude ii. 3',
      'Ps. ii. 13',
      'Gen. i. 3000',
      'gen. i. 3',
      'Gen. ii:16',
    ]) {
      expect(findScriptureReferences(text, books)).toEqual([]);
    }
  });

  it('reads an OCR look-alike first verse after a roman chapter as digits', () => {
    expect(findScriptureReferences('John i. II. In the beginning', books)).toEqual([
      { raw: 'John i. II', book: 'John', chapter: 1, verses: [11] },
    ]);
    expect(findScriptureReferences('Matt. ii. II', books)).toEqual([
      { raw: 'Matt. ii. II', book: 'Matthew', chapter: 2, verses: [11] },
    ]);
    expect(findScriptureReferences('Rom. ii. i8', books)).toEqual([
      { raw: 'Rom. ii. i8', book: 'Romans', chapter: 2, verses: [18] },
    ]);
    expect(findScriptureReferences('Phil. i. I', books)).toEqual([
      { raw: 'Phil. i. I', book: 'Philippians', chapter: 1, verses: [1] },
    ]);
  });

  it('rejects a look-alike verse that reads as a word', () => {
    for (const text of ['Rom. iii. I think', 'Rom. iii. I\'ll', 'Gen. ii. i.e. the', 'Matt. ii. II And when']) {
      expect(findScriptureReferences(text, books)).toEqual([]);
    }
  });
});
