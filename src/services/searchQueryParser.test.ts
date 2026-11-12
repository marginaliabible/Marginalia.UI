import { parseSearchQuery, textContainsAllPhrases } from './searchQueryParser';

describe('parseSearchQuery', () => {
  it('treats a fully quoted query as one literal phrase', () => {
    expect(parseSearchQuery('"it is written"')).toEqual({
      raw: '"it is written"',
      indexQuery: 'it is written',
      phrases: ['it is written'],
    });
  });

  it('supports curly quotes around the whole query', () => {
    expect(parseSearchQuery('“it is written”')).toEqual({
      raw: '“it is written”',
      indexQuery: 'it is written',
      phrases: ['it is written'],
    });
  });

  it('extracts an inline quoted phrase and keeps free terms', () => {
    expect(parseSearchQuery('faith "it is written" hope')).toEqual({
      raw: 'faith "it is written" hope',
      indexQuery: 'faith it is written hope',
      phrases: ['it is written'],
    });
  });

  it('leaves unquoted queries without phrases', () => {
    expect(parseSearchQuery('living water')).toEqual({
      raw: 'living water',
      indexQuery: 'living water',
      phrases: [],
    });
  });

  it('collapses whitespace inside phrases', () => {
    expect(parseSearchQuery('"it   is   written"').phrases).toEqual(['it is written']);
  });
});

describe('textContainsAllPhrases', () => {
  it('matches phrases case-insensitively in order', () => {
    expect(textContainsAllPhrases('And It Is Written in the law', ['it is written'])).toBe(true);
    expect(textContainsAllPhrases('it was written', ['it is written'])).toBe(false);
    expect(textContainsAllPhrases('written it is', ['it is written'])).toBe(false);
  });

  it('requires every phrase when several are provided', () => {
    expect(
      textContainsAllPhrases('love one another and it is written', ['it is written', 'love one']),
    ).toBe(true);
    expect(
      textContainsAllPhrases('it is written here', ['it is written', 'love one']),
    ).toBe(false);
  });
});
