import { resolveHyperlinkTemplate } from './hyperlinkTemplate';

describe('resolveHyperlinkTemplate', () => {
  const romans = { book: 'Romans', chapter: 4, verse: 20 };

  it('resolves the bundled Blue Letter Bible template', () => {
    const result = resolveHyperlinkTemplate('https://www.blueletterbible.org/{abbr_book}/{chapter}/{verse}/', romans);

    expect(result).toBe('https://www.blueletterbible.org/rom/4/20/');
  });

  it('resolves the bundled Bible Hub template', () => {
    const result = resolveHyperlinkTemplate('https://biblehub.com/{book}/{chapter}-{verse}.htm', romans);

    expect(result).toBe('https://biblehub.com/romans/4-20.htm');
  });

  it('resolves the bundled Bible Gateway template', () => {
    const result = resolveHyperlinkTemplate(
      'https://www.biblegateway.com/passage/?search={Book}%20{chapter}%3A{verse}',
      romans
    );

    expect(result).toBe('https://www.biblegateway.com/passage/?search=Romans%204%3A20');
  });

  it('uses arabic numerals and url-encodes spaces for multi-word books', () => {
    const result = resolveHyperlinkTemplate('https://example.com/{Book}', { book: 'I Corinthians', chapter: 1, verse: 2 });

    expect(result).toBe('https://example.com/1%20Corinthians');
  });

  it('joins multi-word books with an explicit separator token', () => {
    const verse = { book: 'I Corinthians', chapter: 1, verse: 2 };

    expect(resolveHyperlinkTemplate('https://example.com/{book_}', verse)).toBe('https://example.com/1_corinthians');
    expect(resolveHyperlinkTemplate('https://example.com/{book-}', verse)).toBe('https://example.com/1-corinthians');
  });

  it('applies casing variants to book names and abbreviations', () => {
    expect(resolveHyperlinkTemplate('https://example.com/{BOOK}', romans)).toBe('https://example.com/ROMANS');
    expect(resolveHyperlinkTemplate('https://example.com/{Abbr_Book}', romans)).toBe('https://example.com/Rom');
    expect(resolveHyperlinkTemplate('https://example.com/{ABBR_BOOK}', romans)).toBe('https://example.com/ROM');
  });

  it('accepts book aliases as input', () => {
    const result = resolveHyperlinkTemplate('https://example.com/{abbr_book}', { book: '1 cor', chapter: 1, verse: 2 });

    expect(result).toBe('https://example.com/1co');
  });

  it('leaves unknown tokens untouched', () => {
    const result = resolveHyperlinkTemplate('https://example.com/{translation}/{chapter}', romans);

    expect(result).toBe('https://example.com/{translation}/4');
  });

  it('rejects templates that do not resolve to an http(s) url', () => {
    expect(resolveHyperlinkTemplate('javascript:alert({verse})', romans)).toBeNull();
    expect(resolveHyperlinkTemplate('/{book}/{chapter}', romans)).toBeNull();
  });
});
