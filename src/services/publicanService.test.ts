import { loadPublicanCommitted, loadSyncPlanLedger } from './publicanService';
import { fetchStorageAware, getStorageSessionUserId } from './storageAuthenticatedFetch';

jest.mock('./storageAuthenticatedFetch', () => ({
  fetchStorageAware: jest.fn(),
  getStorageSessionUserId: jest.fn(() => 'user@example.com'),
}));

jest.mock('./storageEnv', () => ({
  getConfiguredStorageBaseUrl: jest.fn(() => 'https://storage.example.com'),
}));

const mockFetch = fetchStorageAware as jest.Mock;
const mockUserId = getStorageSessionUserId as jest.Mock;

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

describe('publicanService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserId.mockReturnValue('user@example.com');
  });

  it('loads and parses publican committed entries', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({
      modifiedOn: '2026-01-01T00:00:00Z',
      committed: [
        { type: 'del', size: 50, documentId: 'doc-1', hash: 'AbCd', provider: 'G' },
      ],
    }));

    const committed = await loadPublicanCommitted();
    expect(committed).toEqual([
      expect.objectContaining({ type: 'del', size: 50, documentId: 'doc-1', hash: 'abcd' }),
    ]);
    expect(String(mockFetch.mock.calls[0][0])).toContain('/users/user@example.com/publican.json');
  });

  it('builds documentId → hash maps from provider documents.json', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ committed: [] }))
      .mockResolvedValueOnce(jsonResponse({
        documents: [{ documentId: 'g1', title: 'Notes', tags: [], hash: 'deadbeef' }],
      }));

    const ledger = await loadSyncPlanLedger(['google']);
    expect(ledger.publishedByDocumentId.get('g1')).toBe('deadbeef');
  });
});
