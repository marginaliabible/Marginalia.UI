import {
  buildDocumentLinkRoute,
  parseDocumentLinkFromHash,
  parseHashRoute,
  parseSearchFromHash,
  stripDocumentLinkFromHash,
} from './App';

describe('document link routes', () => {
  it('builds a hash-keyed link on the verse route', () => {
    expect(buildDocumentLinkRoute({ book: 'Romans', chapter: 8, verse: 28 }, { doc: 'abc123', page: 12 }))
      .toBe('#/Romans/8/28?doc=abc123&page=12');
  });

  it('builds a library-keyed link and encodes the book and documentId', () => {
    expect(buildDocumentLinkRoute(
      { book: '1 Peter', chapter: 2, verse: 24 },
      { doc: 'notes/ch 2', lib: '0a1b2c3d', page: 3 }
    )).toBe('#/1%20Peter/2/24?lib=0a1b2c3d&doc=notes%2Fch+2&page=3');
  });

  it('builds a link without a verse reference', () => {
    expect(buildDocumentLinkRoute(null, { doc: 'abc123', page: 1 })).toBe('#/?doc=abc123&page=1');
  });

  it('round-trips through the parsers', () => {
    const hash = buildDocumentLinkRoute(
      { book: '1 Peter', chapter: 2, verse: 24 },
      { doc: 'notes/ch 2', lib: '0a1b2c3d', page: 3 }
    );

    expect(parseHashRoute(hash)).toEqual({ book: '1 Peter', chapter: 2, verse: 24 });
    expect(parseDocumentLinkFromHash(hash)).toEqual({ doc: 'notes/ch 2', lib: '0a1b2c3d', page: 3 });
  });

  it('defaults a missing or invalid page to 1 and ignores hashes without doc', () => {
    expect(parseDocumentLinkFromHash('#/John/3/16?doc=abc&page=zero')).toEqual({ doc: 'abc', page: 1 });
    expect(parseDocumentLinkFromHash('#/John/3/16?q=love')).toBeNull();
    expect(parseDocumentLinkFromHash('#/John/3/16')).toBeNull();
    expect(parseDocumentLinkFromHash('')).toBeNull();
  });

  it('strips document params and keeps the search query', () => {
    expect(stripDocumentLinkFromHash('#/John/3/16?q=love&lib=0a1b2c3d&doc=abc&page=2')).toBe('#/John/3/16?q=love');
    expect(parseSearchFromHash(stripDocumentLinkFromHash('#/John/3/16?q=god+so&doc=abc&page=2'))).toBe('god so');
    expect(stripDocumentLinkFromHash('#/John/3/16?doc=abc&page=2')).toBe('#/John/3/16');
    expect(stripDocumentLinkFromHash('#/John/3/16')).toBe('#/John/3/16');
  });
});
