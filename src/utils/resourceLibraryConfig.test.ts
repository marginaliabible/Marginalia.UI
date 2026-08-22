import { applyUrlTemplate, buildDocumentPageUrl } from './resourceLibraryConfig';

describe('applyUrlTemplate', () => {
  it('substitutes plain placeholders', () => {
    const result = applyUrlTemplate('{baseUrl}/documents/{documentId}?page={page}', {
      baseUrl: 'https://example.com',
      documentId: 'abc123',
      page: '2',
    });

    expect(result).toBe('https://example.com/documents/abc123?page=2');
  });

  it('slices a placeholder using inclusive [start..end] ranges', () => {
    const result = applyUrlTemplate('/work/documents/{documentId[0..1]}/{documentId[2..3]}/{documentId}/pages/', {
      documentId: 'abc123',
    });

    expect(result).toBe('/work/documents/ab/c1/abc123/pages/');
  });

  it('supports slicing on any placeholder, not just documentId', () => {
    const result = applyUrlTemplate('{baseUrl[0..3]}/{documentId}', {
      baseUrl: 'https://example.com',
      documentId: 'abc123',
    });

    expect(result).toBe('http/abc123');
  });

  it('leaves unknown placeholders untouched', () => {
    const result = applyUrlTemplate('{baseUrl}/{unknown}', { baseUrl: 'https://example.com' });

    expect(result).toBe('https://example.com/{unknown}');
  });
});

describe('buildDocumentPageUrl', () => {
  it('resolves a sliced documentId template against the base URL', () => {
    const result = buildDocumentPageUrl(
      '/work/documents/{documentId[0..1]}/{documentId[2..3]}/{documentId}/pages/',
      'https://example.com',
      'abc123',
      1
    );

    expect(result).toBe('https://example.com/work/documents/ab/c1/abc123/pages/');
  });
});
