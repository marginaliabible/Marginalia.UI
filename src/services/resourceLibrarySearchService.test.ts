import { searchResourceDocumentTitles } from './resourceLibrarySearchService';

const mockPayloads = new Map<string, unknown>();

jest.mock('./searchNormalizer', () => ({
  normalizeEnglishTerm: (term: string) => term.toLowerCase(),
}));

jest.mock('./storageAuthenticatedFetch', () => ({
  fetchStorageAware: jest.fn(async (url: string) => {
    const payload = mockPayloads.get(url);
    return {
      ok: payload !== undefined,
      status: payload === undefined ? 404 : 200,
      json: async () => payload,
    };
  }),
}));

const STORE_ADDRESS = 'https://storage.example.com/documents/{hash[0..1]}/{hash[2..3]}/{hash}/pages/';

function seedCloudLibrary(root: string, resourcesModifiedOn: string, documents: unknown[]): string {
  const libraryUrl = `${root}/library.json`;
  mockPayloads.set(libraryUrl, { name: 'Cloud', modifiedOn: '2026-09-01T00:00:00Z', sources: ['OneDrive/resources.json'] });
  mockPayloads.set(`${root}/OneDrive/resources.json`, {
    name: 'OneDrive',
    modifiedOn: resourcesModifiedOn,
    documentStoreAddress: STORE_ADDRESS,
    documentViewer: 'markup',
    shards: [],
  });
  mockPayloads.set(`${root}/OneDrive/documents.json`, { documents });
  return libraryUrl;
}

describe('searchResourceDocumentTitles', () => {
  beforeEach(() => {
    mockPayloads.clear();
    window.localStorage.clear();
  });

  it('refreshes cached documents when resources.json changes but library.json does not', async () => {
    const root = 'https://storage.example.com/users/refresh';
    const libraryUrl = seedCloudLibrary(root, '2026-09-01T00:00:00Z', [
      { documentId: 'cloud-1', title: 'Romans Commentary', tags: [] },
    ]);

    const beforeProcessing = await searchResourceDocumentTitles('romans', [libraryUrl]);
    expect(beforeProcessing?.matches).toEqual([]);

    seedCloudLibrary(root, '2026-09-02T00:00:00Z', [
      { documentId: 'cloud-1', title: 'Romans Commentary', tags: [], hash: 'abcdef123' },
    ]);

    const afterProcessing = await searchResourceDocumentTitles('romans', [libraryUrl]);
    expect(afterProcessing?.matches).toHaveLength(1);
    expect(afterProcessing?.matches[0]).toMatchObject({
      documentId: 'cloud-1',
      viewer: 'markup',
      url: 'https://storage.example.com/documents/ab/cd/abcdef123/pages/',
    });
  });

  it('keeps unhashed documents when the store address does not need a hash', async () => {
    const root = 'https://storage.example.com/users/by-id';
    const libraryUrl = `${root}/library.json`;
    mockPayloads.set(libraryUrl, { name: 'Local', modifiedOn: '2026-09-01T00:00:00Z', sources: ['resources.json'] });
    mockPayloads.set(`${root}/resources.json`, { modifiedOn: '2026-09-01T00:00:00Z', shards: [] });
    mockPayloads.set(`${root}/documents.json`, { documents: [{ documentId: 'doc-1', title: 'Romans Notes' }] });

    const result = await searchResourceDocumentTitles('romans', [libraryUrl]);
    expect(result?.matches.map((match) => match.url)).toEqual([`${root}/documents/doc-1`]);
  });
});
