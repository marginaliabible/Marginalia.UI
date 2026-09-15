import { resolveSelectedVerseContext } from './selectedVerseContext';

describe('resolveSelectedVerseContext', () => {
  it('returns null when no book or verse is selected', () => {
    expect(resolveSelectedVerseContext(null, 1, [1])).toBeNull();
    expect(resolveSelectedVerseContext('Romans', 10, [])).toBeNull();
  });

  it('returns the first valid selected verse', () => {
    expect(resolveSelectedVerseContext('Romans', 10, [9, 10])).toEqual({
      book: 'Romans',
      chapter: 10,
      verse: 9,
    });
  });
});
