import { formatVerseList, formatVerseReference } from './scriptureReference';

describe('formatVerseList', () => {
  it('collapses runs longer than two verses into ranges', () => {
    expect(formatVerseList([16, 17, 18, 20])).toBe('16-18, 20');
    expect(formatVerseList([1, 2, 5, 6, 7, 8])).toBe('1, 2, 5-8');
  });

  it('sorts, de-duplicates, and drops invalid verse numbers', () => {
    expect(formatVerseList([20, 18, 16, 17, 17, 0, -1, 2.5])).toBe('16-18, 20');
    expect(formatVerseList([])).toBe('');
  });
});

describe('formatVerseReference', () => {
  it('formats a book, chapter, and verse list', () => {
    expect(formatVerseReference('John', 3, [16, 17, 18, 20])).toBe('John 3:16-18, 20');
    expect(formatVerseReference('Romans', 10, [12])).toBe('Romans 10:12');
  });

  it('omits the verse suffix when no verse is selected', () => {
    expect(formatVerseReference('John', 3)).toBe('John 3');
    expect(formatVerseReference('John', 3, [])).toBe('John 3');
  });
});
