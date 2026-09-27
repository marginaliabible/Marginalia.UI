import { expandVerseSpec } from './verseSpec';

describe('expandVerseSpec', () => {
  it('expands inclusive ranges', () => {
    expect(expandVerseSpec('1-3')).toEqual([1, 2, 3]);
  });

  it('expands comma-separated verses', () => {
    expect(expandVerseSpec('9, 10')).toEqual([9, 10]);
  });

  it('expands mixed ranges and lists', () => {
    expect(expandVerseSpec('1-2, 5, 8-9')).toEqual([1, 2, 5, 8, 9]);
  });
});
