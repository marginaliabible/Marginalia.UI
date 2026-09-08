import {
  applyUrlTemplate,
  buildDocumentPageUrl,
  buildDocumentStorePageUrl,
  buildFetchUrlCandidates,
  inferSourceFileKindFromPayload,
  inferSourceFileKindFromUrl,
  readLibrarySourceAddresses,
  validateDocumentsFile,
  validateHyperlinksFile,
} from './resourceLibraryConfig';

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
      { documentId: 'abc123' },
      1
    );

    expect(result).toBe('https://example.com/work/documents/ab/c1/abc123/pages/');
  });
});

describe('library source helpers', () => {
  it('rejects library files that define both source and sources', () => {
    expect(() => readLibrarySourceAddresses({ source: 'resources.json', sources: ['translations.json'] }))
      .toThrow(/source or sources/);
  });

  it('infers source file kind by filename', () => {
    expect(inferSourceFileKindFromUrl('https://example.com/data/resources.json')).toBe('resources');
    expect(inferSourceFileKindFromUrl('data/translations.json')).toBe('translations');
  });

  it('infers source file kind by strict root properties', () => {
    expect(inferSourceFileKindFromPayload({ modifiedOn: '2026-09-01', shards: [] })).toBe('resources');
    expect(inferSourceFileKindFromPayload({ modifiedOn: '2026-09-01', translations: [] })).toBe('translations');
    expect(inferSourceFileKindFromPayload({ documents: [] })).toBe('documents');
  });
});

describe('address helpers', () => {
  it('builds document store URLs from a library-level template with an absolute address', () => {
    const result = buildDocumentStorePageUrl(
      'https://paperless.example.com/api/documents/{documentId}/preview/#page={pageNumber}',
      'https://example.com/resources.json',
      { documentId: 'abc123' },
      4
    );

    expect(result).toBe('https://paperless.example.com/api/documents/abc123/preview/#page=4');
  });

  it('builds document store URLs relative to the source file', () => {
    const result = buildDocumentStorePageUrl('documents/{documentId}?page={pageNumber}', 'data/library.json', { documentId: 'abc123' }, 3);

    expect(result).toBe('data/documents/abc123?page=3');
  });

  it('builds document store URLs using a hash placeholder, including sliced segments', () => {
    const result = buildDocumentStorePageUrl(
      'documents/{hash[0..1]}/{hash[2..3]}/{hash}/pages/?page={pageNumber}',
      'data/library.json',
      { documentId: 'abc123', hash: 'deadbeef' },
      3
    );

    expect(result).toBe('data/documents/de/ad/deadbeef/pages/?page=3');
  });

  it('prefers CDN candidates for raw GitHub URLs', () => {
    const candidates = buildFetchUrlCandidates('https://raw.githubusercontent.com/owner/repo/main/data/library.json');

    expect(candidates[0]).toBe('https://cdn.jsdelivr.net/gh/owner/repo@main/data/library.json');
    expect(candidates).toContain('https://raw.githubusercontent.com/owner/repo/main/data/library.json');
  });

  it('normalizes GitHub blob URLs before building CDN candidates', () => {
    const candidates = buildFetchUrlCandidates('https://github.com/owner/repo/blob/main/data/library.json');

    expect(candidates[0]).toBe('https://cdn.jsdelivr.net/gh/owner/repo@main/data/library.json');
  });
});

describe('documents validation', () => {
  it('rejects legacy root-array documents payloads', () => {
    expect(() => validateDocumentsFile([{ documentId: 'doc-1' }], 'documents.json')).toThrow(/payload is invalid/);
  });
});

describe('hyperlinks sources', () => {
  const payload = { hyperlinks: [{ label: 'Bible Hub', url: 'https://biblehub.com/{book}/{chapter}-{verse}.htm' }] };

  it('detects the kind by filename', () => {
    expect(inferSourceFileKindFromUrl('https://example.com/data/hyperlinks.json')).toBe('hyperlinks');
  });

  it('detects the kind by payload shape', () => {
    expect(inferSourceFileKindFromPayload(payload)).toBe('hyperlinks');
  });

  it('accepts a valid hyperlinks payload', () => {
    expect(validateHyperlinksFile(payload, 'hyperlinks.json')).toBe(payload);
  });

  it('rejects entries missing a label or url', () => {
    expect(() => validateHyperlinksFile({ hyperlinks: [{ label: 'Bible Hub' }] }, 'hyperlinks.json'))
      .toThrow(/entry 1 is missing a required label or url/);
  });

  it('rejects payloads without a hyperlinks array', () => {
    expect(() => validateHyperlinksFile({}, 'hyperlinks.json')).toThrow(/missing required hyperlinks/);
  });
});
