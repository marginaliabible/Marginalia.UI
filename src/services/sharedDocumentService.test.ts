import {
  SHARED_DOCUMENT_FALLBACK_TITLE,
  buildSharedDocumentPackageUrl,
  findSharedDocument,
  findSharedDocumentPageRaws,
  normalizeSharedDocumentHash,
  readContentTitle,
  resolveSharedDocumentStorageBaseUrl,
  resolveSharedDocumentTitle,
} from './sharedDocumentService';
import { DOCUMENT_RENDER_EPOCH } from './storageAuthenticatedFetch';

jest.mock('./storageEnv', () => ({
  getAuthServiceUrl: () => '',
  getConfiguredStorageBaseUrl: () => '',
  getDocumentRenderEpochOverride: () => '',
}));

const GATEWAY = 'https://storage.marginaliabible.com';
const HASH = '0123456789abcdef'.repeat(4);
const PACKAGE_URL = `${GATEWAY}/documents/01/23/${HASH}/`;

const fakeResponse = (status: number, text: string) => ({
  status,
  ok: status >= 200 && status < 300,
  text: async () => text,
  json: async () => JSON.parse(text) as unknown,
}) as Response;
const jsonResponse = (status: number, body: unknown) => fakeResponse(status, JSON.stringify(body));
const htmlResponse = (status: number, body: string) => fakeResponse(status, body);

describe('sharedDocumentService', () => {
  const originalFetch = global.fetch;
  let routes: Record<string, () => Response>;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    routes = {};
    fetchMock = jest.fn(async (input: string) => {
      const { pathname } = new URL(input);
      return routes[pathname]?.() ?? jsonResponse(404, { error: 'not_found' });
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('normalizeSharedDocumentHash', () => {
    it('accepts 64 hex characters and lowercases them', () => {
      expect(normalizeSharedDocumentHash(HASH.toUpperCase())).toBe(HASH);
      expect(normalizeSharedDocumentHash(` ${HASH} `)).toBe(HASH);
    });

    it('rejects anything else', () => {
      for (const value of ['', 'abc', HASH.slice(1), `${HASH}0`, 'g'.repeat(64), `../${HASH.slice(3)}`]) {
        expect(normalizeSharedDocumentHash(value)).toBeNull();
      }
    });
  });

  describe('storage location', () => {
    it("uses the gateway the user's libraries live on, else the default", () => {
      expect(resolveSharedDocumentStorageBaseUrl(['https://example.com/library.json'])).toBe(GATEWAY);
      expect(resolveSharedDocumentStorageBaseUrl([`${GATEWAY}/users/u1/library.json`])).toBe(GATEWAY);
    });

    it('builds the package path from the hash prefix', () => {
      expect(buildSharedDocumentPackageUrl(HASH, `${GATEWAY}/`)).toBe(PACKAGE_URL);
    });
  });

  describe('findSharedDocument', () => {
    const shellPath = `/documents/01/23/${HASH}/pages/index.html`;

    it('finds a rendered package and resolves its title', async () => {
      routes[shellPath] = () => htmlResponse(200, '<html><head><title></title></head><body></body></html>');
      const resolveTitle = jest.fn().mockResolvedValue('From Resolver');

      await expect(findSharedDocument(HASH, [], resolveTitle)).resolves.toEqual({
        status: 'found',
        pagesUrl: `${PACKAGE_URL}pages/`,
        shellUrl: `${PACKAGE_URL}pages/index.html`,
        title: 'From Resolver',
      });
      expect(resolveTitle).toHaveBeenCalledWith({
        packageUrl: PACKAGE_URL,
        shellHtml: '<html><head><title></title></head><body></body></html>',
      });
      expect(fetchMock).toHaveBeenCalledWith(`${PACKAGE_URL}pages/index.html?r=${DOCUMENT_RENDER_EPOCH}`, expect.objectContaining({ credentials: 'include' }));
    });

    it('falls back to the generic title when the resolver fails', async () => {
      routes[shellPath] = () => htmlResponse(200, '');
      const result = await findSharedDocument(HASH, [], () => Promise.reject(new Error('boom')));
      expect(result).toEqual(expect.objectContaining({ status: 'found', title: SHARED_DOCUMENT_FALLBACK_TITLE }));
    });

    it.each([
      [404, 'not-found'],
      [401, 'unauthorized'],
      [403, 'unauthorized'],
      [500, 'error'],
    ])('maps a %i shell response to %s', async (status, expected) => {
      routes[shellPath] = () => jsonResponse(status, { error: 'x' });
      await expect(findSharedDocument(HASH, [])).resolves.toEqual({ status: expected });
    });

    it('reports a network failure as an error', async () => {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
      await expect(findSharedDocument(HASH, [])).resolves.toEqual({ status: 'error' });
    });
  });

  describe('resolveSharedDocumentTitle', () => {
    const metaPath = `/documents/01/23/${HASH}/meta.json`;

    it('prefers the package meta.json title', async () => {
      routes[metaPath] = () => jsonResponse(200, { title: '  Romans \n Commentary ', pageCount: 12 });
      await expect(resolveSharedDocumentTitle({ packageUrl: PACKAGE_URL, shellHtml: '<title>Shell</title>' }))
        .resolves.toBe('Romans Commentary');
    });

    it('falls back to the content title when meta.json is missing or unusable', async () => {
      await expect(resolveSharedDocumentTitle({ packageUrl: PACKAGE_URL, shellHtml: '<title>Shell &amp; Co</title>' }))
        .resolves.toBe('Shell & Co');

      routes[metaPath] = () => jsonResponse(200, { title: 42 });
      await expect(resolveSharedDocumentTitle({ packageUrl: PACKAGE_URL, shellHtml: '<h1>Heading</h1>' }))
        .resolves.toBe('Heading');
    });

    it('uses the generic title when nothing names the document', async () => {
      await expect(resolveSharedDocumentTitle({ packageUrl: PACKAGE_URL, shellHtml: '<title></title><div class="pf"></div>' }))
        .resolves.toBe(SHARED_DOCUMENT_FALLBACK_TITLE);
    });
  });

  describe('readContentTitle', () => {
    it('reads text only, on one line, without bidi overrides', () => {
      expect(readContentTitle('<title>A\u202E\nB</title>')).toBe('A B');
      expect(readContentTitle('<h2 class="x"><span>Part</span> <b>Two</b></h2>')).toBe('Part Two');
      expect(readContentTitle('<title> </title>')).toBeNull();
    });
  });

  describe('findSharedDocumentPageRaws', () => {
    const versesPath = `/documents/01/23/${HASH}/pages/page3.verses.json`;

    it('returns the citations on the page for the linked verses', async () => {
      routes[versesPath] = () => jsonResponse(200, [
        { ref: 'Rom.8.28', raw: 'Rom. 8:28' },
        { ref: 'Rom.8.29', raw: 'Rom. 8:28-29' },
        { ref: 'Rom.8.29', raw: 'v. 29' },
        { ref: 'Rom.9.28', raw: 'Rom. 9:28' },
        { ref: 'John.8.28', raw: 'John 8:28' },
      ]);

      await expect(findSharedDocumentPageRaws(`${PACKAGE_URL}pages/`, 3, { book: 'Romans', chapter: 8, verses: [28] }))
        .resolves.toEqual(['Rom. 8:28']);
      await expect(findSharedDocumentPageRaws(`${PACKAGE_URL}pages/`, 3, { book: 'Romans', chapter: 8, verses: [28, 29] }))
        .resolves.toEqual(['Rom. 8:28', 'Rom. 8:28-29', 'v. 29']);
    });

    it('returns nothing when the page index is missing', async () => {
      await expect(findSharedDocumentPageRaws(`${PACKAGE_URL}pages/`, 3, { book: 'Romans', chapter: 8, verses: [28] }))
        .resolves.toEqual([]);
    });
  });
});
