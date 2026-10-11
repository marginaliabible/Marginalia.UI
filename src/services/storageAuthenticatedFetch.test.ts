import {
  DOCUMENT_RENDER_EPOCH,
  fetchStorageAware,
  withDocumentRenderEpoch,
} from './storageAuthenticatedFetch';

jest.mock('./storageEnv', () => ({
  getAuthServiceUrl: () => '',
  getConfiguredStorageBaseUrl: () => '',
  getDocumentRenderEpochOverride: () => '',
}));

const GATEWAY = 'https://storage.marginaliabible.com';

describe('withDocumentRenderEpoch', () => {
  it('appends the epoch to gateway /documents/ URLs', () => {
    expect(withDocumentRenderEpoch(`${GATEWAY}/documents/ab/cd/abcd/pages/page1.page`))
      .toBe(`${GATEWAY}/documents/ab/cd/abcd/pages/page1.page?r=${DOCUMENT_RENDER_EPOCH}`);
  });

  it('preserves existing query parameters and replaces a stale epoch', () => {
    const result = new URL(withDocumentRenderEpoch(`${GATEWAY}/documents/ab/cd/abcd/document.css?x=1&r=old`));
    expect(result.searchParams.get('x')).toBe('1');
    expect(result.searchParams.get('r')).toBe(DOCUMENT_RENDER_EPOCH);
  });

  it('leaves assets, user JSON, and non-gateway URLs unchanged', () => {
    for (const url of [
      `${GATEWAY}/assets/images/ab/cd/abcd.png`,
      `${GATEWAY}/users/me@example.com/library.json`,
      'https://example.com/documents/ab/cd/abcd/pages/index.html',
    ]) {
      expect(withDocumentRenderEpoch(url)).toBe(url);
    }
  });
});

describe('fetchStorageAware', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn(async () => ({ status: 200, ok: true }) as Response);
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('does not force no-store and sends credentials for gateway URLs', async () => {
    await fetchStorageAware(`${GATEWAY}/assets/fonts/ab/cd/abcd.woff`);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${GATEWAY}/assets/fonts/ab/cd/abcd.woff`);
    expect(init.credentials).toBe('include');
    expect(init.cache).toBeUndefined();
  });

  it('passes an explicit cache mode through', async () => {
    await fetchStorageAware(`${GATEWAY}/users/me@example.com/library.json`, { cache: 'no-cache' });
    expect(fetchMock.mock.calls[0][1].cache).toBe('no-cache');
  });

  it('fetches document URLs with the render epoch', async () => {
    await fetchStorageAware(`${GATEWAY}/documents/ab/cd/abcd/pages/index.html`);
    expect(fetchMock.mock.calls[0][0]).toBe(`${GATEWAY}/documents/ab/cd/abcd/pages/index.html?r=${DOCUMENT_RENDER_EPOCH}`);
  });

  it('passes non-gateway URLs through untouched', async () => {
    const init = { cache: 'no-store' as RequestCache };
    await fetchStorageAware('https://example.com/documents/x.json', init);
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/documents/x.json', init);
  });
});
