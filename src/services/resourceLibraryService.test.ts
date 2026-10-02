import type { IDBPDatabase } from 'idb';
import type { BibleTranslationMeta } from '../models/bible';
import { ResourceLibraryService, buildResourceDocumentLinkKey } from './resourceLibraryService';
import { resourcesUrlKey } from '../utils/sourceSubscriptions';

const mockPayloads = new Map<string, unknown>();

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

const CLOUD_RESOURCES = 'https://storage.example.com/users/u1/GoogleDrive/resources.json';
const PUBLISHER_RESOURCES = 'https://publisher.example.com/library/resources.json';

function seedLibraries(): void {
  mockPayloads.set(CLOUD_RESOURCES, {
    modifiedOn: '2026-09-01T00:00:00Z',
    documentStoreAddress: '../../../documents/{hash[0..1]}/{hash[2..3]}/{hash}/pages/',
    documentViewer: 'markup',
    shards: [],
  });
  mockPayloads.set('https://storage.example.com/users/u1/GoogleDrive/documents.json', {
    documents: [{ documentId: 'drive-file-1', title: 'Synced Commentary', hash: 'abcdef0123' }],
  });

  mockPayloads.set(PUBLISHER_RESOURCES, {
    modifiedOn: '2026-09-01T00:00:00Z',
    documentStoreAddress: 'pdfs/{documentId}.pdf#page={page}',
    shards: [],
  });
  mockPayloads.set('https://publisher.example.com/library/documents.json', {
    documents: [{ documentId: 'romans-notes', title: 'Romans Notes' }],
  });
}

function createService(): ResourceLibraryService {
  const artifacts = [
    { id: 'cloud', label: 'Google Drive', source: CLOUD_RESOURCES },
    { id: 'publisher', label: 'Publisher', source: PUBLISHER_RESOURCES },
  ].map((entry) => ({ ...entry, artifactType: 'resource-library' }) as unknown as BibleTranslationMeta);

  const database = {
    get: async () => undefined,
    put: async () => undefined,
  } as unknown as IDBPDatabase<any>;

  return new ResourceLibraryService({
    fetchSettings: async () => ({ artifacts, translationLibraryUrls: [] }),
    getDatabase: async () => database,
  });
}

describe('buildResourceDocumentLinkKey', () => {
  it('uses the content hash when the manifest publishes one', () => {
    expect(buildResourceDocumentLinkKey(CLOUD_RESOURCES, { documentId: 'drive-file-1', hash: 'abcdef0123' }))
      .toEqual({ doc: 'abcdef0123' });
  });

  it('falls back to the library key and documentId', () => {
    expect(buildResourceDocumentLinkKey(PUBLISHER_RESOURCES, { documentId: 'romans-notes' }))
      .toEqual({ doc: 'romans-notes', lib: resourcesUrlKey(PUBLISHER_RESOURCES) });
  });
});

describe('ResourceLibraryService.findDocumentByLink', () => {
  beforeEach(() => {
    mockPayloads.clear();
    seedLibraries();
  });

  it('finds a document by content hash in whichever library has it', async () => {
    const resolved = await createService().findDocumentByLink({ doc: 'abcdef0123', page: 4 });

    expect(resolved).toEqual({
      libraryId: 'cloud',
      documentId: 'drive-file-1',
      title: 'Synced Commentary',
      hash: 'abcdef0123',
      cloudProvider: 'google',
      viewer: 'markup',
      url: 'https://storage.example.com/documents/ab/cd/abcdef0123/pages/',
    });
  });

  it('finds a publisher document by library key and documentId', async () => {
    const resolved = await createService().findDocumentByLink({
      doc: 'romans-notes',
      lib: resourcesUrlKey(PUBLISHER_RESOURCES),
      page: 12,
    });

    expect(resolved).toMatchObject({
      libraryId: 'publisher',
      documentId: 'romans-notes',
      title: 'Romans Notes',
      cloudProvider: null,
      viewer: 'pdf',
      url: 'https://publisher.example.com/library/pdfs/romans-notes.pdf#page=12',
    });
  });

  it('does not match a documentId under a different library key', async () => {
    const resolved = await createService().findDocumentByLink({
      doc: 'romans-notes',
      lib: resourcesUrlKey(CLOUD_RESOURCES),
      page: 1,
    });

    expect(resolved).toBeNull();
  });

  it('does not treat a bare documentId as a content hash', async () => {
    expect(await createService().findDocumentByLink({ doc: 'drive-file-1', page: 1 })).toBeNull();
  });

  it('returns null for a document the user does not have', async () => {
    expect(await createService().findDocumentByLink({ doc: 'ffffffffff', page: 1 })).toBeNull();
  });
});
