import { act, fireEvent, getDefaultNormalizer, render, screen, waitFor, within } from '@testing-library/react';
import AccountControl from './AccountControl';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { bibleService } from '../services/bibleService';
import {
  beginFederatedAuthorization,
  completeFederatedAuthorizationFromUrl,
  getFreshFederatedSessions,
  getStoredFederatedSessions,
  rekeyStoredRefreshTokens,
} from '../services/federatedAuthService';
import {
  listFolderChildrenForSession,
  computeSupportedFolderSizeForSession,
  readCloudConfigForSession,
  writeCloudConfigForSession,
} from '../services/cloudConfigProviderService';
import { fetchCloudSyncStatus, queueCloudFolderSelection } from '../services/cloudControlService';
import { getFileSyncExclusionSnapshot, requestFileSyncExclusionToggle } from '../services/fileSyncExclusionService';
import { addSourceUrl } from '../store/slices/uiSlice';
import { __resetToastsForTests, getToasts } from '../services/toastService';

jest.mock('../store/hooks', () => ({
  useAppDispatch: jest.fn(),
  useAppSelector: jest.fn(),
}));

jest.mock('../store/slices/bibleSlice', () => ({
  loadTranslation: jest.fn((translationId: string) => ({ type: 'bible/loadTranslation', payload: translationId })),
  setCurrentBibleFromId: jest.fn((translationId: string) => ({ type: 'bible/setCurrentBibleFromId', payload: translationId })),
}));

jest.mock('../store/slices/uiSlice', () => ({
  addSourceUrl: jest.fn((payload: unknown) => ({ type: 'ui/addSourceUrl', payload })),
  removeSourceUrl: jest.fn((payload: unknown) => ({ type: 'ui/removeSourceUrl', payload })),
  replaceUserId: jest.fn((payload: unknown) => ({ type: 'ui/replaceUserId', payload })),
  restoreState: jest.fn((payload: unknown) => ({ type: 'ui/restoreState', payload })),
  setUserId: jest.fn((payload: unknown) => ({ type: 'ui/setUserId', payload })),
}));

jest.mock('../services/bibleService', () => ({
  bibleService: {
    readState: jest.fn(),
    persistState: jest.fn(),
    replaceUserId: jest.fn(),
  },
}));

jest.mock('../services/federatedAuthService', () => ({
  beginFederatedAuthorization: jest.fn(),
  completeFederatedAuthorizationFromUrl: jest.fn(),
  getFreshFederatedSessions: jest.fn(),
  getMostRecentlyGrantedSession: jest.fn((sessions) => sessions.microsoft ?? sessions.google ?? null),
  getStoredFederatedSessions: jest.fn(),
  removeStoredFederatedSession: jest.fn((provider) => {
    const sessions = { ...(getStoredFederatedSessions as jest.Mock).mock.results.at(-1)?.value ?? {} };
    delete sessions[provider];
    return sessions;
  }),
  rekeyStoredRefreshTokens: jest.fn(),
  revokeStoredRefreshToken: jest.fn(),
  writeStoredSessions: jest.fn(),
}));

jest.mock('../services/cloudControlService', () => ({
  fetchCloudSyncStatus: jest.fn(async () => null),
  queueCloudFolderSelection: jest.fn(),
  reportSyncActivity: jest.fn(),
}));

jest.mock('../services/storageAuthenticatedFetch', () => ({
  clearStorageSession: jest.fn(),
  establishStorageSession: jest.fn(),
  setStorageSessionUserId: jest.fn(),
}));

jest.mock('../services/cloudConfigProviderService', () => ({
  listFolderChildrenForSession: jest.fn(),
  mergeLinkedAccounts: jest.requireActual('../services/cloudConfigProviderService').mergeLinkedAccounts,
  computeSupportedFolderSizeForSession: jest.fn(),
  readCloudConfigForSession: jest.fn(),
  writeCloudConfigForSession: jest.fn(),
}));

const mockUseAppDispatch = useAppDispatch as unknown as jest.Mock;
const mockUseAppSelector = useAppSelector as unknown as jest.Mock;
const mockReadState = bibleService.readState as jest.Mock;
const mockPersistState = bibleService.persistState as jest.Mock;
const mockBeginAuth = beginFederatedAuthorization as jest.Mock;
const mockCompleteAuth = completeFederatedAuthorizationFromUrl as jest.Mock;
const mockGetStoredSessions = getStoredFederatedSessions as jest.Mock;
const mockGetFreshSessions = getFreshFederatedSessions as jest.Mock;
const mockListFolderChildrenForSession = listFolderChildrenForSession as jest.Mock;
const mockComputeSupportedFolderSizeForSession = computeSupportedFolderSizeForSession as jest.Mock;
const mockReadCloudConfigForSession = readCloudConfigForSession as jest.Mock;
const mockWriteCloudConfigForSession = writeCloudConfigForSession as jest.Mock;
const mockQueueCloudFolderSelection = queueCloudFolderSelection as jest.Mock;
const mockFetchCloudSyncStatus = fetchCloudSyncStatus as jest.Mock;
const mockRekeyStoredRefreshTokens = rekeyStoredRefreshTokens as jest.Mock;
const mockAddSourceUrl = addSourceUrl as unknown as jest.Mock;

const baseUiState = {
  selectedTranslationId: 'KJV',
  selectedTranslationIds: ['KJV'],
  translationRecords: [{ id: 'KJV', starred: true }],
  selectedBook: 'John',
  selectedChapter: 3,
  selectedLanguages: [],
  sourceUrls: [],
  resourceHiddenTags: [],
  theme: 'light',
  translatorItalics: true,
  translatorParagraphMarks: true,
  ready: true,
};

const msSession = {
  provider: 'microsoft',
  accessToken: 'ms-access-token',
  refreshToken: 'ms-refresh-token',
  expiresAt: Date.now() + 60 * 60 * 1000,
  grantedAt: Date.now(),
  profile: {
    providerAccountId: 'ms-user-1',
    displayName: 'MS User',
    email: 'ms@example.com',
  },
};

const googleSession = {
  provider: 'google',
  accessToken: 'google-access-token',
  refreshToken: 'google-refresh-token',
  expiresAt: Date.now() + 60 * 60 * 1000,
  grantedAt: Date.now(),
  profile: {
    providerAccountId: 'g-user-1',
    displayName: 'Google User',
    email: 'g@example.com',
  },
};

function linkedBothProviders() {
  return [
    {
      provider: 'google',
      providerAccountId: 'g-user-1',
      email: 'g@example.com',
      linkedAt: Date.now() - 5000,
    },
    {
      provider: 'microsoft',
      providerAccountId: 'ms-user-1',
      email: 'ms@example.com',
      linkedAt: Date.now() - 1000,
    },
  ];
}

// The picker inserts zero-width spaces after slashes so long paths can wrap.
const pathTextOptions = {
  normalizer: (text: string) => getDefaultNormalizer()(text).replace(/\u200B/g, ''),
};

function openAccountModal() {
  fireEvent.click(screen.getByRole('button', { name: /open account controls/i }));
}

async function openProviderModal(rootLabel: 'Google Drive' | 'OneDrive') {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^(Connect|Manage) ${rootLabel}$`) }));
  return within(await screen.findByRole('dialog', { name: /Connect(ed)? to/ }));
}

function getProviderCheckbox(id: 'google-sync-settings' | 'google-sync-files' | 'microsoft-sync-settings' | 'microsoft-sync-files') {
  return document.getElementById(id) as HTMLInputElement;
}

async function assignFileSyncTag(itemLabel: string, tagName = 'Teaching') {
  const rightPanel = within(document.querySelector('.cloud-folder-picker-right') as HTMLElement);
  fireEvent.click(rightPanel.getByRole('button', { name: '+ Tags' }));

  await waitFor(() => {
    expect(screen.getByText(`Tags for ${itemLabel}`)).toBeInTheDocument();
  });

  const tagInput = document.getElementById('fileSyncTagInput') as HTMLInputElement;
  fireEvent.change(tagInput, { target: { value: tagName } });
  fireEvent.keyDown(tagInput, { key: 'Enter' });
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));

  await waitFor(() => {
    expect(screen.queryByText(`Tags for ${itemLabel}`)).not.toBeInTheDocument();
  });
}

// Reads return whatever was last written, like the real per-provider marginalia-config.json.
function installFakeCloud(initial: Partial<Record<'google' | 'microsoft', any>> = {}) {
  const cloud: Record<'google' | 'microsoft', any> = { google: null, microsoft: null, ...initial };
  mockReadCloudConfigForSession.mockImplementation(async (session: { provider: 'google' | 'microsoft' }) => cloud[session.provider]);
  mockWriteCloudConfigForSession.mockImplementation(async (session: { provider: 'google' | 'microsoft' }, payload: unknown) => {
    cloud[session.provider] = JSON.parse(JSON.stringify(payload));
  });
  return cloud;
}

async function renderAccountControl() {
  let view: ReturnType<typeof render> | null = null;
  await act(async () => {
    view = render(<AccountControl />);
    await Promise.resolve();
  });

  return view as unknown as ReturnType<typeof render>;
}

describe('AccountControl', () => {
  beforeEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    __resetToastsForTests();
    window.localStorage.clear();
    Element.prototype.scrollIntoView = jest.fn();

    mockUseAppDispatch.mockReturnValue(jest.fn());
    mockUseAppSelector.mockImplementation((selector: (state: any) => any) => selector({ ui: baseUiState }));

    mockPersistState.mockImplementation((update: any) => ({
      ...mockReadState(),
      ...update,
    }));

    mockCompleteAuth.mockResolvedValue({ handled: false });
    mockBeginAuth.mockResolvedValue(undefined);
    mockListFolderChildrenForSession.mockResolvedValue([]);
    mockComputeSupportedFolderSizeForSession.mockResolvedValue(0);
    mockReadCloudConfigForSession.mockResolvedValue(null);
    mockWriteCloudConfigForSession.mockResolvedValue(undefined);
    mockQueueCloudFolderSelection.mockResolvedValue(null);
    mockFetchCloudSyncStatus.mockReset().mockResolvedValue(null);
    mockRekeyStoredRefreshTokens.mockResolvedValue('moved');
    mockGetFreshSessions.mockResolvedValue({});
    mockGetStoredSessions.mockReturnValue({});
    mockReadState.mockReturnValue({
      lastTranslationId: 'KJV',
      lastTranslationIds: ['KJV'],
      cloudLinkedAccounts: [],
      cloudConfigUpdatedAt: Date.now() - 10_000,
      cloudConfigLastSyncedAt: Date.now() - 10_000,
    });
  });

  it('shows a passive reconnect notice without auto-opening the modal when a linked provider is missing on this device', async () => {
    mockReadState.mockReturnValue({
      lastTranslationId: 'KJV',
      lastTranslationIds: ['KJV'],
      cloudLinkedAccounts: linkedBothProviders(),
      cloudConfigUpdatedAt: Date.now() - 10_000,
      cloudConfigLastSyncedAt: Date.now() - 10_000,
    });

    mockGetStoredSessions.mockReturnValue({ microsoft: msSession });
    mockGetFreshSessions.mockResolvedValue({ microsoft: msSession });

    await renderAccountControl();

    await waitFor(() => {
      expect(mockGetFreshSessions).toHaveBeenCalled();
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    openAccountModal();

    await waitFor(() => {
      expect(screen.getByText('Reconnect required')).toBeInTheDocument();
      expect(screen.getByText(/Reconnect Google on this device/i)).toBeInTheDocument();
    });
  });

  it('offers Reconnect in the Manage modal for the missing provider', async () => {
    mockReadState.mockReturnValue({
      lastTranslationId: 'KJV',
      lastTranslationIds: ['KJV'],
      cloudLinkedAccounts: linkedBothProviders(),
      cloudConfigUpdatedAt: Date.now() - 10_000,
      cloudConfigLastSyncedAt: Date.now() - 10_000,
    });

    mockGetStoredSessions.mockReturnValue({ microsoft: msSession });
    mockGetFreshSessions.mockResolvedValue({ microsoft: msSession });

    await renderAccountControl();
    openAccountModal();

    expect(await screen.findByRole('button', { name: 'Manage Google Drive' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage OneDrive' })).toBeInTheDocument();

    const modal = await openProviderModal('Google Drive');
    expect(modal.getByRole('heading', { name: /Connected to Google/ })).toBeInTheDocument();
    expect(modal.getByText('g@example.com')).toBeInTheDocument();
    expect(modal.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
    expect(modal.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();
  });

  it('shows Connect on file sync roots for providers that were never linked', async () => {
    await renderAccountControl();
    openAccountModal();

    expect(await screen.findByRole('button', { name: 'Connect Google Drive' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect OneDrive' })).toBeInTheDocument();
  });

  it('does not auto-open the reconnect modal after remount when a linked provider is still missing', async () => {
    mockReadState.mockReturnValue({
      lastTranslationId: 'KJV',
      lastTranslationIds: ['KJV'],
      cloudLinkedAccounts: linkedBothProviders(),
      cloudConfigUpdatedAt: Date.now() - 10_000,
      cloudConfigLastSyncedAt: Date.now() - 10_000,
    });

    mockGetStoredSessions.mockReturnValue({ microsoft: msSession });
    mockGetFreshSessions.mockResolvedValue({ microsoft: msSession });

    const first = await renderAccountControl();
    await waitFor(() => {
      expect(mockGetFreshSessions).toHaveBeenCalled();
    });
    first.unmount();

    await renderAccountControl();
    await waitFor(() => {
      expect(mockGetFreshSessions.mock.calls.length).toBeGreaterThan(1);
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    openAccountModal();
    expect(screen.getByText(/Reconnect Google on this device/i)).toBeInTheDocument();
  });

  it('pushes merged linked-account metadata to all active linked providers after second provider sign-in', async () => {
    jest.useFakeTimers();

    window.localStorage.setItem('marginalia:provider-sync-preferences', JSON.stringify({
      google: {
        syncSettings: true,
        syncFiles: false,
        selectedTargets: [],
      },
      microsoft: {
        syncSettings: true,
        syncFiles: false,
        selectedTargets: [],
      },
    }));

    mockComputeSupportedFolderSizeForSession.mockResolvedValue(0);
    mockReadState.mockReturnValue({
      lastTranslationId: 'KJV',
      lastTranslationIds: ['KJV'],
      cloudLinkedAccounts: [
        {
          provider: 'google',
          providerAccountId: 'g-user-1',
          email: 'g@example.com',
          linkedAt: Date.now() - 5000,
        },
      ],
      cloudConfigUpdatedAt: Date.now() - 10_000,
      cloudConfigLastSyncedAt: Date.now() - 10_000,
    });

    mockGetStoredSessions.mockReturnValue({});
    mockGetFreshSessions.mockResolvedValue({
      microsoft: msSession,
      google: googleSession,
    });

    mockCompleteAuth.mockResolvedValue({
      handled: true,
      provider: 'microsoft',
      session: msSession,
    });

    const googleOnlyCopy = {
      schemaVersion: 1,
      updatedAt: Date.now() - 20_000,
      linkedAccounts: [
        {
          provider: 'google',
          providerAccountId: 'g-user-1',
          email: 'g@example.com',
          linkedAt: Date.now() - 5000,
        },
      ],
      config: {
        lastTranslationId: 'KJV',
        lastTranslationIds: ['KJV'],
        translationRecords: [{ id: 'KJV', starred: true }],
        lastBook: 'John',
        lastChapter: 3,
        languages: [],
        sourceUrls: [],
        resourceHiddenTags: [],
        theme: 'light',
      },
    };
    const cloud = installFakeCloud({ google: googleOnlyCopy, microsoft: googleOnlyCopy });

    await renderAccountControl();

    await waitFor(() => {
      expect(mockReadCloudConfigForSession).toHaveBeenCalled();
    });

    await act(async () => {
      jest.advanceTimersByTime(1500);
    });

    await waitFor(() => {
      for (const provider of ['google', 'microsoft'] as const) {
        const linkedProviders = cloud[provider].linkedAccounts
          .map((entry: { provider: string }) => entry.provider)
          .sort();
        expect(linkedProviders).toEqual(['google', 'microsoft']);
      }
    });

    const providersWritten = new Set(mockWriteCloudConfigForSession.mock.calls.map((call) => call[0].provider));
    expect(providersWritten).toEqual(new Set(['google', 'microsoft']));
  });

  it('merges divergent provider copies on sign-in and writes the same result to both', async () => {
    jest.useFakeTimers();
    let uiState: any = baseUiState;
    const dispatch = jest.fn((action: { type: string; payload?: any }) => {
      if (action.type === 'ui/restoreState') {
        uiState = { ...uiState, ...action.payload };
      }
    });
    mockUseAppDispatch.mockReturnValue(dispatch);
    mockUseAppSelector.mockImplementation((selector: (state: any) => any) => selector({ ui: uiState }));

    window.localStorage.setItem('marginalia:provider-sync-preferences', JSON.stringify({
      google: { syncSettings: true, syncFiles: false, selectedTargets: [] },
      microsoft: { syncSettings: true, syncFiles: false, selectedTargets: [] },
    }));

    const localStamp = Date.now() - 60_000;
    mockReadState.mockReturnValue({
      lastTranslationId: 'KJV',
      lastTranslationIds: ['KJV'],
      cloudLinkedAccounts: [
        { provider: 'google', providerAccountId: 'g-user-1', email: 'g@example.com', linkedAt: localStamp },
      ],
      cloudConfigUpdatedAt: localStamp,
      cloudConfigLastSyncedAt: localStamp,
    });

    const baseConfig = {
      lastTranslationId: 'KJV',
      lastTranslationIds: ['KJV'],
      translationRecords: [{ id: 'KJV', starred: true }],
      lastBook: 'John',
      lastChapter: 3,
      languages: [],
      sourceUrls: ['https://a.example/library.json'],
      resourceHiddenTags: [],
      theme: 'light',
    };
    const oldStamp = Date.now() - 120_000;
    const allFieldsAt = (stamp: number) => ({
      lastTranslationId: stamp,
      lastTranslationIds: stamp,
      translationRecords: stamp,
      position: stamp,
      languages: stamp,
      resourceHiddenTags: stamp,
      theme: stamp,
      userId: stamp,
      'folders.google': stamp,
      'folders.microsoft': stamp,
    });
    // PC #2 changed the theme through Google; mobile moved to Ruth 2 through OneDrive.
    const cloud = installFakeCloud({
      google: {
        schemaVersion: 1,
        updatedAt: Date.now() - 5_000,
        linkedAccounts: [],
        config: { ...baseConfig, theme: 'dark', sourceUrls: [...baseConfig.sourceUrls, 'https://b.example/library.json'] },
        fieldUpdatedAt: { ...allFieldsAt(oldStamp), theme: Date.now() - 5_000 },
      },
      microsoft: {
        schemaVersion: 1,
        updatedAt: Date.now() - 4_000,
        linkedAccounts: [],
        config: { ...baseConfig, lastBook: 'Ruth', lastChapter: 2 },
        fieldUpdatedAt: { ...allFieldsAt(oldStamp), position: Date.now() - 4_000 },
      },
    });

    mockGetStoredSessions.mockReturnValue({ google: googleSession });
    mockGetFreshSessions.mockResolvedValue({ google: googleSession, microsoft: msSession });
    mockCompleteAuth.mockResolvedValue({ handled: true, provider: 'microsoft', session: msSession });

    await renderAccountControl();

    await act(async () => {
      jest.advanceTimersByTime(1500);
    });

    await waitFor(() => {
      expect(cloud.google?.config.theme).toBe('dark');
      expect(cloud.google?.config.lastBook).toBe('Ruth');
      expect(cloud.microsoft?.config).toEqual(cloud.google?.config);
    });

    expect(cloud.google.config.lastChapter).toBe(2);
    expect(cloud.google.config.sourceUrls).toEqual(expect.arrayContaining([
      'https://a.example/library.json',
      'https://b.example/library.json',
    ]));
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ui/restoreState',
      payload: expect.objectContaining({ theme: 'dark', selectedBook: 'Ruth', selectedChapter: 2 }),
    }));
  });

  it('queues CloudControlService when a merge changes a provider\'s own folder selection', async () => {
    window.localStorage.setItem('marginalia:provider-sync-preferences', JSON.stringify({
      google: { syncSettings: true, syncFiles: false, selectedTargets: [] },
      microsoft: { syncSettings: true, syncFiles: true, selectedTargets: [] },
    }));

    const localStamp = Date.now() - 60_000;
    mockReadState.mockReturnValue({
      userId: 'user-cloud-1',
      lastTranslationId: 'KJV',
      lastTranslationIds: ['KJV'],
      cloudLinkedAccounts: linkedBothProviders(),
      cloudConfigUpdatedAt: localStamp,
      cloudConfigLastSyncedAt: localStamp,
    });

    const msTarget = { id: 'ms-documents', kind: 'folder', name: 'Documents', path: 'OneDrive/Documents', tags: ['Teaching'] };
    const config = {
      lastTranslationId: 'KJV',
      lastTranslationIds: ['KJV'],
      translationRecords: [{ id: 'KJV', starred: true }],
      lastBook: 'John',
      lastChapter: 3,
      languages: [],
      sourceUrls: [],
      resourceHiddenTags: [],
      theme: 'light',
    };
    // The OneDrive folder change reached only the Google copy; CCS reads OneDrive selections from OneDrive.
    installFakeCloud({
      google: {
        schemaVersion: 1,
        updatedAt: Date.now() - 1_000,
        linkedAccounts: linkedBothProviders(),
        config: { ...config, providerFolderSelections: { google: [], microsoft: [msTarget] } },
        fieldUpdatedAt: { 'folders.microsoft': Date.now() - 1_000 },
      },
      microsoft: {
        schemaVersion: 1,
        updatedAt: localStamp,
        linkedAccounts: linkedBothProviders(),
        config: { ...config, providerFolderSelections: { google: [], microsoft: [] } },
      },
    });

    mockGetStoredSessions.mockReturnValue({ google: googleSession, microsoft: msSession });
    mockGetFreshSessions.mockResolvedValue({ google: googleSession, microsoft: msSession });

    await renderAccountControl();

    await waitFor(() => {
      expect(mockQueueCloudFolderSelection).toHaveBeenCalledWith({
        userId: 'user-cloud-1',
        provider: 'microsoft',
        removed: [],
        accessToken: msSession.accessToken,
        trigger: 'background',
      });
    });
    expect(mockQueueCloudFolderSelection).not.toHaveBeenCalledWith(expect.objectContaining({ provider: 'google' }));

    const persisted = JSON.parse(window.localStorage.getItem('marginalia:provider-sync-preferences') || '{}');
    expect(persisted.microsoft.selectedTargets).toEqual([msTarget]);
  });

  describe('signing back in to a provider that was signed out', () => {
    const disconnectedAt = '2026-10-01T00:00:00.000Z';
    const restoredTarget = { id: 'g-notes', kind: 'folder', name: 'Notes', path: 'Google Drive/Notes', tags: ['Teaching'] };
    const awaitingApplyStatus = {
      ok: true,
      userId: 'user-cloud-1',
      overall: null,
      pollAfterMs: 60_000,
      providers: { google: { state: 'attention', disconnectedAt } },
    };

    function setUpSignedBackIn(syncFiles: boolean) {
      mockUseAppSelector.mockImplementation((selector: (state: any) => any) => selector({
        ui: { ...baseUiState, userId: 'user-cloud-1' },
      }));
      window.localStorage.setItem('marginalia:provider-sync-preferences', JSON.stringify({
        google: { syncSettings: true, syncFiles, selectedTargets: [restoredTarget] },
        microsoft: { syncSettings: false, syncFiles: false, selectedTargets: [] },
      }));
      mockReadState.mockReturnValue({
        userId: 'user-cloud-1',
        lastTranslationId: 'KJV',
        lastTranslationIds: ['KJV'],
        cloudLinkedAccounts: [linkedBothProviders()[0]],
        cloudConfigUpdatedAt: Date.now() - 10_000,
        cloudConfigLastSyncedAt: Date.now() - 10_000,
      });
      // The provider's own copy still names the restored selection, so no reconcile sees it change.
      installFakeCloud({
        google: {
          schemaVersion: 1,
          updatedAt: Date.now() - 10_000,
          linkedAccounts: [linkedBothProviders()[0]],
          config: { providerFolderSelections: { google: [restoredTarget], microsoft: [] } },
        },
      });
      mockGetStoredSessions.mockReturnValue({ google: googleSession });
      mockGetFreshSessions.mockResolvedValue({ google: googleSession });
      mockFetchCloudSyncStatus.mockResolvedValue(awaitingApplyStatus);
    }

    it('opens Account Sync on load with the restored selection, and Apply resumes syncing without any edits', async () => {
      setUpSignedBackIn(true);

      await renderAccountControl();

      expect(await screen.findByRole('region', { name: 'File Sync' })).toBeInTheDocument();
      expect(await screen.findByText(/Restored 1 folder from your previous Google Drive connection\./)).toBeInTheDocument();
      expect(mockQueueCloudFolderSelection).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();

      mockQueueCloudFolderSelection.mockResolvedValue({ ok: true });
      mockFetchCloudSyncStatus.mockResolvedValue({
        ...awaitingApplyStatus,
        overall: 'queued',
        providers: { google: { state: 'queued', startsAt: new Date(Date.now() + 5 * 60_000).toISOString() } },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

      await waitFor(() => {
        expect(mockQueueCloudFolderSelection).toHaveBeenCalledWith(expect.objectContaining({
          userId: 'user-cloud-1',
          provider: 'google',
          removed: [],
          trigger: 'apply',
        }));
      });
      await waitFor(() => {
        expect(screen.queryByText(/Restored 1 folder/)).not.toBeInTheDocument();
      });
      expect(mockQueueCloudFolderSelection).toHaveBeenCalledTimes(1);
    });

    it('neither prompts nor queues File Sync when the provider was signed back in for settings only', async () => {
      setUpSignedBackIn(false);

      await renderAccountControl();
      await waitFor(() => {
        expect(mockReadCloudConfigForSession).toHaveBeenCalled();
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      expect(screen.queryByRole('region', { name: 'File Sync' })).not.toBeInTheDocument();
      expect(mockFetchCloudSyncStatus).not.toHaveBeenCalled();
      expect(mockQueueCloudFolderSelection).not.toHaveBeenCalled();
    });
  });

  it('copies the User ID\'s original establishment time to a newly linked provider and never advances it', async () => {
    jest.useFakeTimers();
    window.localStorage.setItem('marginalia:provider-sync-preferences', JSON.stringify({
      google: { syncSettings: true, syncFiles: false, selectedTargets: [] },
      microsoft: { syncSettings: true, syncFiles: false, selectedTargets: [] },
    }));
    const establishedAt = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const localStamp = Date.now() - 60_000;
    mockReadState.mockReturnValue({
      userId: 'owner@example.com',
      lastTranslationId: 'KJV',
      lastTranslationIds: ['KJV'],
      cloudLinkedAccounts: [
        { provider: 'microsoft', providerAccountId: 'ms-user-1', email: 'ms@example.com', linkedAt: establishedAt },
      ],
      cloudConfigUpdatedAt: localStamp,
      cloudConfigLastSyncedAt: localStamp,
      cloudFieldUpdatedAt: { userId: establishedAt, theme: localStamp },
    });
    const cloud = installFakeCloud({
      microsoft: {
        schemaVersion: 1,
        updatedAt: localStamp,
        linkedAccounts: [],
        config: {
          lastTranslationId: 'KJV',
          lastTranslationIds: ['KJV'],
          translationRecords: [{ id: 'KJV', starred: true }],
          languages: [],
          sourceUrls: [],
          resourceHiddenTags: [],
          theme: 'light',
          userId: 'owner@example.com',
        },
        fieldUpdatedAt: { userId: establishedAt, theme: localStamp },
      },
    });
    mockGetStoredSessions.mockReturnValue({ microsoft: msSession });
    mockGetFreshSessions.mockResolvedValue({ google: googleSession, microsoft: msSession });
    mockCompleteAuth.mockResolvedValue({ handled: true, provider: 'google', session: googleSession });

    await renderAccountControl();
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });

    await waitFor(() => {
      expect(cloud.google?.config.userId).toBe('owner@example.com');
    });
    expect(cloud.google.fieldUpdatedAt.userId).toBe(establishedAt);
    expect(cloud.microsoft.fieldUpdatedAt.userId).toBe(establishedAt);
    const persistedStamps = mockPersistState.mock.calls
      .map(([update]) => update?.cloudFieldUpdatedAt?.userId)
      .filter((stamp) => stamp !== undefined);
    expect(persistedStamps.length).toBeGreaterThan(0);
    expect(persistedStamps.every((stamp) => stamp === establishedAt)).toBe(true);
  });

  describe('when this device holds a placeholder User ID', () => {
    const placeholderLibrary = 'https://storage.example/users/placeholder@example.com/library.json';
    const ownerLibrary = 'https://storage.example/users/owner@example.com/library.json';

    function setUpPlaceholderDevice(placeholderStamp: number) {
      const dispatch = jest.fn();
      mockUseAppDispatch.mockReturnValue(dispatch);
      window.localStorage.setItem('marginalia:provider-sync-preferences', JSON.stringify({
        google: { syncSettings: true, syncFiles: false, selectedTargets: [] },
        microsoft: { syncSettings: true, syncFiles: false, selectedTargets: [] },
      }));
      const localStamp = Date.now() - 60_000;
      mockReadState.mockReturnValue({
        userId: 'placeholder@example.com',
        lastTranslationId: 'KJV',
        lastTranslationIds: ['KJV'],
        cloudLinkedAccounts: linkedBothProviders(),
        cloudConfigUpdatedAt: localStamp,
        cloudConfigLastSyncedAt: localStamp,
        cloudFieldUpdatedAt: { userId: placeholderStamp },
      });
      const cloud = installFakeCloud({
        microsoft: {
          schemaVersion: 1,
          updatedAt: localStamp,
          linkedAccounts: linkedBothProviders(),
          config: {
            lastTranslationId: 'KJV',
            lastTranslationIds: ['KJV'],
            translationRecords: [{ id: 'KJV', starred: true }],
            languages: [],
            sourceUrls: [placeholderLibrary],
            resourceHiddenTags: [],
            theme: 'light',
            userId: 'owner@example.com',
          },
          fieldUpdatedAt: { userId: Date.now() - 30 * 24 * 60 * 60 * 1000 },
        },
      });
      mockGetStoredSessions.mockReturnValue({ microsoft: msSession });
      mockGetFreshSessions.mockResolvedValue({ microsoft: msSession });
      return { dispatch, cloud };
    }

    it('adopts the account\'s older established User ID, moves its tokens there, and subscribes to its library', async () => {
      const { dispatch, cloud } = setUpPlaceholderDevice(Date.now() - 2 * 60 * 60 * 1000);

      await renderAccountControl();

      await waitFor(() => {
        expect(mockRekeyStoredRefreshTokens).toHaveBeenCalledWith('placeholder@example.com', 'owner@example.com', ['google', 'microsoft']);
      });
      expect(bibleService.replaceUserId).toHaveBeenCalledWith('owner@example.com');
      expect(dispatch).toHaveBeenCalledWith({ type: 'ui/replaceUserId', payload: 'owner@example.com' });
      expect(dispatch).toHaveBeenCalledWith({ type: 'ui/removeSourceUrl', payload: placeholderLibrary });
      expect(dispatch).toHaveBeenCalledWith({ type: 'ui/addSourceUrl', payload: ownerLibrary });
      expect(cloud.microsoft.config.userId).toBe('owner@example.com');
    });

    it('asks before switching when its own User ID has no recorded time, and keeps it when declined', async () => {
      const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
      const { dispatch } = setUpPlaceholderDevice(0);

      try {
        await renderAccountControl();

        await waitFor(() => {
          expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('Switch this device to owner@example.com?'));
        });
        expect(mockRekeyStoredRefreshTokens).not.toHaveBeenCalled();
        expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ui/replaceUserId' }));
      } finally {
        confirmSpy.mockRestore();
      }
    });
  });

  it('writes only to available sessions when another linked provider is missing on this device', async () => {
    jest.useFakeTimers();

    window.localStorage.setItem('marginalia:provider-sync-preferences', JSON.stringify({
      google: {
        syncSettings: true,
        syncFiles: false,
        selectedTargets: [],
      },
      microsoft: {
        syncSettings: true,
        syncFiles: false,
        selectedTargets: [],
      },
    }));

    mockReadState.mockReturnValue({
      lastTranslationId: 'KJV',
      lastTranslationIds: ['KJV'],
      cloudLinkedAccounts: linkedBothProviders(),
      cloudConfigUpdatedAt: Date.now() - 10_000,
      cloudConfigLastSyncedAt: Date.now() - 10_000,
    });

    mockGetStoredSessions.mockReturnValue({ microsoft: msSession });
    mockGetFreshSessions.mockResolvedValue({ microsoft: msSession });
    mockCompleteAuth.mockResolvedValue({
      handled: true,
      provider: 'microsoft',
      session: msSession,
    });
    const cloud = installFakeCloud();

    await renderAccountControl();

    await waitFor(() => {
      expect(mockReadCloudConfigForSession).toHaveBeenCalled();
    });

    await act(async () => {
      jest.runOnlyPendingTimers();
    });

    await waitFor(() => {
      expect(cloud.microsoft).not.toBeNull();
    });

    expect(cloud.google).toBeNull();
    expect(mockWriteCloudConfigForSession.mock.calls.every((call) => call[0].provider === 'microsoft')).toBe(true);
    expect(screen.queryByText(/not signed in on this device/i)).not.toBeInTheDocument();
  });

  it('restores cloud folder selections instead of overwriting them when a never-synced device connects', async () => {
    jest.useFakeTimers();

    window.localStorage.setItem('marginalia:provider-sync-preferences', JSON.stringify({
      google: {
        syncSettings: false,
        syncFiles: false,
        selectedTargets: [],
      },
      microsoft: {
        syncSettings: true,
        syncFiles: true,
        selectedTargets: [],
      },
    }));

    mockReadState.mockReturnValue({
      lastTranslationId: 'KJV',
      lastTranslationIds: ['KJV'],
    });

    mockGetStoredSessions.mockReturnValue({});
    mockGetFreshSessions.mockResolvedValue({ microsoft: msSession });
    mockCompleteAuth.mockResolvedValue({
      handled: true,
      provider: 'microsoft',
      session: msSession,
    });

    const remoteTarget = {
      id: 'ms-documents',
      kind: 'folder',
      name: 'Documents',
      path: 'OneDrive/Documents',
      tags: ['Teaching'],
    };
    mockReadCloudConfigForSession.mockResolvedValue({
      schemaVersion: 1,
      updatedAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
      linkedAccounts: [
        {
          provider: 'microsoft',
          providerAccountId: 'ms-user-1',
          email: 'ms@example.com',
          linkedAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
        },
      ],
      config: {
        lastTranslationId: 'KJV',
        lastTranslationIds: ['KJV'],
        translationRecords: [{ id: 'KJV', starred: true }],
        languages: [],
        sourceUrls: [],
        resourceHiddenTags: [],
        theme: 'light',
        providerFolderSelections: {
          google: [],
          microsoft: [remoteTarget],
        },
      },
    });

    await renderAccountControl();

    await waitFor(() => {
      const persisted = JSON.parse(window.localStorage.getItem('marginalia:provider-sync-preferences') || '{}');
      expect(persisted.microsoft.selectedTargets).toEqual([remoteTarget]);
    });

    await act(async () => {
      jest.advanceTimersByTime(1500);
    });

    await waitFor(() => {
      expect(mockWriteCloudConfigForSession).toHaveBeenCalled();
    });

    for (const [, payload] of mockWriteCloudConfigForSession.mock.calls) {
      expect(payload.config.providerFolderSelections.microsoft).toEqual([remoteTarget]);
    }
  });

  it('does not attempt cloud writes when no linked accounts exist', async () => {
    jest.useFakeTimers();

    await renderAccountControl();

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    expect(mockWriteCloudConfigForSession).not.toHaveBeenCalled();
  });

  it('requires at least one option before connect is enabled', async () => {
    await renderAccountControl();

    openAccountModal();
    const modal = await openProviderModal('Google Drive');

    const connectButton = modal.getByRole('button', { name: 'Connect' });
    expect(getProviderCheckbox('google-sync-settings')).toBeChecked();
    expect(getProviderCheckbox('google-sync-files')).toBeChecked();
    expect(connectButton).toBeEnabled();

    fireEvent.click(getProviderCheckbox('google-sync-settings'));
    expect(getProviderCheckbox('google-sync-files')).not.toBeChecked();
    expect(connectButton).toBeDisabled();

    fireEvent.click(getProviderCheckbox('google-sync-settings'));
    expect(connectButton).toBeEnabled();

    fireEvent.click(connectButton);
    expect(mockBeginAuth).toHaveBeenCalledWith('google', {
      syncSettings: true,
      syncFiles: false,
    });
    expect(screen.queryByRole('dialog', { name: /Connect to Google/ })).not.toBeInTheDocument();
  });

  it('leaves preferences unchanged when the provider modal is cancelled', async () => {
    await renderAccountControl();
    openAccountModal();

    const modal = await openProviderModal('Google Drive');
    fireEvent.click(getProviderCheckbox('google-sync-settings'));
    fireEvent.click(modal.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog', { name: /Connect to Google/ })).not.toBeInTheDocument();
    expect(mockBeginAuth).not.toHaveBeenCalled();
    const stored = JSON.parse(window.localStorage.getItem('marginalia:provider-sync-preferences') ?? '{}');
    expect(stored.google).toEqual(expect.objectContaining({ syncSettings: false, syncFiles: false }));

    await openProviderModal('Google Drive');
    expect(getProviderCheckbox('google-sync-settings')).toBeChecked();
    expect(getProviderCheckbox('google-sync-files')).toBeChecked();
  });

  it('closes only the provider modal when its backdrop is clicked', async () => {
    await renderAccountControl();
    openAccountModal();

    await openProviderModal('Google Drive');
    fireEvent.click(document.querySelector('.provider-connect-modal-backdrop') as HTMLElement);

    expect(screen.queryByRole('dialog', { name: /Connect to Google/ })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'File Sync' })).toBeInTheDocument();
  });

  it('re-runs authorization with file scope when a settings-only provider enables file sync', async () => {
    mockReadState.mockReturnValue({
      lastTranslationId: 'KJV',
      lastTranslationIds: ['KJV'],
      cloudLinkedAccounts: [
        {
          provider: 'google',
          providerAccountId: 'g-user-1',
          email: 'g@example.com',
          linkedAt: Date.now() - 5000,
        },
      ],
      cloudConfigUpdatedAt: Date.now() - 10_000,
      cloudConfigLastSyncedAt: Date.now() - 10_000,
    });

    window.localStorage.setItem('marginalia:provider-sync-preferences', JSON.stringify({
      google: {
        syncSettings: true,
        syncFiles: false,
        selectedTargets: [],
      },
      microsoft: {
        syncSettings: false,
        syncFiles: false,
        selectedTargets: [],
      },
    }));

    mockGetStoredSessions.mockReturnValue({ google: googleSession });
    mockGetFreshSessions.mockResolvedValue({ google: googleSession });

    await renderAccountControl();
    openAccountModal();

    const modal = await openProviderModal('Google Drive');
    expect(getProviderCheckbox('google-sync-settings')).toBeChecked();
    expect(getProviderCheckbox('google-sync-settings')).toBeDisabled();
    expect(getProviderCheckbox('google-sync-files')).toBeChecked();
    expect(getProviderCheckbox('google-sync-files')).toBeEnabled();
    expect(modal.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();

    fireEvent.click(modal.getByRole('button', { name: 'Connect' }));

    expect(mockBeginAuth).toHaveBeenCalledWith('google', {
      syncSettings: true,
      syncFiles: true,
    });
    const stored = JSON.parse(window.localStorage.getItem('marginalia:provider-sync-preferences') ?? '{}');
    expect(stored.google).toEqual(expect.objectContaining({ syncSettings: true, syncFiles: true }));
  });

  it('shows disabled options and reconnect action when linked provider is missing local session', async () => {
    mockReadState.mockReturnValue({
      lastTranslationId: 'KJV',
      lastTranslationIds: ['KJV'],
      cloudLinkedAccounts: [
        {
          provider: 'google',
          providerAccountId: 'g-user-1',
          email: 'g@example.com',
          linkedAt: Date.now() - 5000,
        },
      ],
      cloudConfigUpdatedAt: Date.now() - 10_000,
      cloudConfigLastSyncedAt: Date.now() - 10_000,
    });

    mockGetStoredSessions.mockReturnValue({});
    mockGetFreshSessions.mockResolvedValue({});

    await renderAccountControl();
    openAccountModal();

    await waitFor(() => {
      expect(screen.getByText(/Reconnect Google on this device/i)).toBeInTheDocument();
    });

    const modal = await openProviderModal('Google Drive');
    const syncSettingsCheckbox = getProviderCheckbox('google-sync-settings');
    const syncFilesCheckbox = getProviderCheckbox('google-sync-files');

    expect(syncSettingsCheckbox).toBeDisabled();
    expect(syncFilesCheckbox).toBeDisabled();
    expect(syncSettingsCheckbox).toHaveAttribute('title', 'Reconnect to modify');
    expect(syncFilesCheckbox).toHaveAttribute('title', 'Reconnect to modify');
    expect(modal.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
    expect(modal.queryByRole('button', { name: 'Modify' })).not.toBeInTheDocument();
  });

  it('asks for confirmation before disconnect when file sync was selected', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);

    mockReadState.mockReturnValue({
      lastTranslationId: 'KJV',
      lastTranslationIds: ['KJV'],
      cloudLinkedAccounts: [],
      cloudConfigUpdatedAt: Date.now() - 10_000,
      cloudConfigLastSyncedAt: Date.now() - 10_000,
    });
    mockGetStoredSessions.mockReturnValue({});
    mockGetFreshSessions.mockResolvedValue({});

    const firstRender = await renderAccountControl();
    openAccountModal();
    const connectModal = await openProviderModal('Google Drive');
    expect(getProviderCheckbox('google-sync-files')).toBeChecked();
    fireEvent.click(connectModal.getByRole('button', { name: 'Connect' }));
    expect(mockBeginAuth).toHaveBeenCalledWith('google', {
      syncSettings: true,
      syncFiles: true,
    });
    firstRender.unmount();

    mockReadState.mockReturnValue({
      lastTranslationId: 'KJV',
      lastTranslationIds: ['KJV'],
      cloudLinkedAccounts: [
        {
          provider: 'google',
          providerAccountId: 'g-user-1',
          email: 'g@example.com',
          linkedAt: Date.now() - 5000,
        },
      ],
      cloudConfigUpdatedAt: Date.now() - 10_000,
      cloudConfigLastSyncedAt: Date.now() - 10_000,
    });

    mockGetStoredSessions.mockReturnValue({ google: googleSession });
    mockGetFreshSessions.mockResolvedValue({ google: googleSession });

    await renderAccountControl();
    openAccountModal();
    const manageModal = await openProviderModal('Google Drive');

    expect(manageModal.getByRole('heading', { name: /Connected to Google/ })).toBeInTheDocument();
    expect(manageModal.getByRole('button', { name: 'Disconnect' })).toHaveClass('btn-danger');

    fireEvent.click(manageModal.getByRole('button', { name: 'Disconnect' }));

    expect(confirmSpy).toHaveBeenCalledWith(
      'Your synchronization data will be kept for 10 days. If you reconnect after 10 days then you may incur additional data usage to reprocess your files. Are you sure you wish to disconnect this service from file sync?'
    );

    expect(mockPersistState).not.toHaveBeenCalledWith(expect.objectContaining({
      cloudLinkedAccounts: [],
    }));

    confirmSpy.mockReturnValue(true);
    fireEvent.click(manageModal.getByRole('button', { name: 'Disconnect' }));

    expect(mockPersistState).toHaveBeenCalledWith(expect.objectContaining({
      cloudLinkedAccounts: [],
    }));
    expect(screen.queryByRole('dialog', { name: /Connected to Google/ })).not.toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  describe('file sync completion message', () => {
    const syncingStatus = {
      ok: true,
      userId: 'user-1',
      overall: 'syncing',
      pollAfterMs: 30_000,
      providers: { google: { state: 'syncing' } },
    };
    const idleStatus = (failedCount: number) => ({
      ok: true,
      userId: 'user-1',
      overall: 'idle',
      pollAfterMs: 60_000,
      providers: { google: { state: 'idle', lastCompletedAt: new Date().toISOString(), failedCount } },
    });

    function setUpGoogleFileSync() {
      mockUseAppSelector.mockImplementation((selector: (state: any) => any) => selector({
        ui: { ...baseUiState, userId: 'user-1' },
      }));
      mockReadState.mockReturnValue({
        lastTranslationId: 'KJV',
        lastTranslationIds: ['KJV'],
        userId: 'user-1',
        cloudLinkedAccounts: [linkedBothProviders()[0]],
        cloudConfigUpdatedAt: Date.now() - 10_000,
        cloudConfigLastSyncedAt: Date.now() - 10_000,
      });
      window.localStorage.setItem('marginalia:provider-sync-preferences', JSON.stringify({
        google: { syncSettings: true, syncFiles: true, selectedTargets: [] },
        microsoft: { syncSettings: false, syncFiles: false, selectedTargets: [] },
      }));
      mockGetStoredSessions.mockReturnValue({ google: googleSession });
      mockGetFreshSessions.mockResolvedValue({ google: googleSession });
    }

    // AccountControl reads the status once on load, to spot a provider awaiting its first Apply after signing back in.
    async function renderAfterLoadCheck() {
      await renderAccountControl();
      await waitFor(() => {
        expect(mockFetchCloudSyncStatus).toHaveBeenCalledTimes(1);
      });
    }

    function pollNow() {
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
    }

    function closeAccountModal() {
      fireEvent.click(document.querySelector('.account-modal .btn-close') as HTMLElement);
    }

    it('shows the completion message with a refresh link when syncing finishes while open, and clears it on close', async () => {
      setUpGoogleFileSync();
      mockFetchCloudSyncStatus
        .mockResolvedValueOnce(idleStatus(0))
        .mockResolvedValueOnce(syncingStatus)
        .mockResolvedValueOnce(idleStatus(2))
        .mockResolvedValue(idleStatus(0));

      await renderAfterLoadCheck();
      openAccountModal();
      expect(await screen.findByText('Syncing files...')).toBeInTheDocument();

      pollNow();
      expect(await screen.findByText("Sync complete, 2 files couldn't be processed.")).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Click to refresh' })).toBeInTheDocument();
      expect(mockFetchCloudSyncStatus).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'user-1',
        providers: ['google'],
      }));

      closeAccountModal();
      openAccountModal();
      await waitFor(() => {
        expect(mockFetchCloudSyncStatus).toHaveBeenCalledTimes(4);
      });
      expect(await screen.findByText(/^Last synced/)).toBeInTheDocument();
      expect(screen.queryByText(/^Sync complete/)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Click to refresh' })).not.toBeInTheDocument();
    });

    it('uses the singular form and "Sync complete!" wording based on failed files', async () => {
      setUpGoogleFileSync();
      mockFetchCloudSyncStatus
        .mockResolvedValueOnce(idleStatus(0))
        .mockResolvedValueOnce(syncingStatus)
        .mockResolvedValueOnce(idleStatus(1))
        .mockResolvedValueOnce(syncingStatus)
        .mockResolvedValue(idleStatus(0));

      await renderAfterLoadCheck();
      openAccountModal();
      expect(await screen.findByText('Syncing files...')).toBeInTheDocument();

      pollNow();
      expect(await screen.findByText("Sync complete, 1 file couldn't be processed.")).toBeInTheDocument();

      pollNow();
      expect(await screen.findByText('Syncing files...')).toBeInTheDocument();
      expect(screen.queryByText(/^Sync complete/)).not.toBeInTheDocument();

      pollNow();
      expect(await screen.findByText('Sync complete!')).toBeInTheDocument();
    });

    it('does not report completion on reopen when the kept status was syncing and the first fresh poll is idle', async () => {
      setUpGoogleFileSync();
      mockFetchCloudSyncStatus
        .mockResolvedValueOnce(idleStatus(0))
        .mockResolvedValueOnce(syncingStatus)
        .mockResolvedValue(idleStatus(0));

      await renderAfterLoadCheck();
      openAccountModal();
      expect(await screen.findByText('Syncing files...')).toBeInTheDocument();

      closeAccountModal();
      openAccountModal();
      await waitFor(() => {
        expect(mockFetchCloudSyncStatus).toHaveBeenCalledTimes(3);
      });
      expect(await screen.findByText(/^Last synced/)).toBeInTheDocument();
      expect(screen.queryByText('Syncing files...')).not.toBeInTheDocument();
      expect(screen.queryByText(/^Sync complete/)).not.toBeInTheDocument();
    });

    it('keeps polling after an Account Sync Apply until the queued sync finishes, then toasts once and stops', async () => {
      setUpGoogleFileSync();
      installFakeCloud();
      mockListFolderChildrenForSession.mockResolvedValue([
        { id: 'g-folder-1', name: 'Bible Notes Folder', kind: 'folder', sizeBytes: 1024, hasChildren: false },
      ]);
      let serverStatus: unknown = {
        ok: true,
        userId: 'user-1',
        overall: 'idle',
        pollAfterMs: 60_000,
        providers: { google: { state: 'idle', lastCompletedAt: new Date(Date.now() - 60_000).toISOString() } },
      };
      mockFetchCloudSyncStatus.mockImplementation(async () => serverStatus);

      await renderAccountControl();
      openAccountModal();
      fireEvent.click(await screen.findByLabelText('Expand Google Drive'));
      fireEvent.click(await screen.findByLabelText('Google Drive/Bible Notes Folder'));
      await assignFileSyncTag('Bible Notes Folder');

      serverStatus = { ...syncingStatus, overall: 'queued', providers: { google: { state: 'queued' } } };
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
      await waitFor(() => {
        expect(mockQueueCloudFolderSelection).toHaveBeenCalledTimes(1);
      });
      await waitFor(() => {
        expect(getToasts().map((toast) => toast.message)).toContain(
          "Account Sync changes saved. Google Drive will start syncing in a few minutes; we'll let you know when it's done."
        );
      });

      closeAccountModal();
      pollNow();
      await waitFor(() => {
        expect(mockFetchCloudSyncStatus.mock.results.length).toBeGreaterThan(0);
      });

      serverStatus = idleStatus(0);
      pollNow();
      await waitFor(() => {
        expect(getToasts().at(-1)).toMatchObject({
          tone: 'success',
          message: 'Your Google Drive files finished syncing. Refresh to see the changes.',
          action: expect.objectContaining({ label: 'Refresh' }),
        });
      });

      const callsAfterCompletion = mockFetchCloudSyncStatus.mock.calls.length;
      pollNow();
      await act(async () => {
        await Promise.resolve();
      });
      expect(mockFetchCloudSyncStatus).toHaveBeenCalledTimes(callsAfterCompletion);
    });

    it('does not poll sync status for a document viewer exclusion toggle while the dialog is closed', async () => {
      setUpGoogleFileSync();
      installFakeCloud();
      window.localStorage.setItem('marginalia:provider-sync-preferences', JSON.stringify({
        google: {
          syncSettings: true,
          syncFiles: true,
          selectedTargets: [{ id: 'g-folder-1', kind: 'folder', name: 'Notes', path: 'Google Drive/Notes', tags: ['Teaching'] }],
        },
        microsoft: { syncSettings: false, syncFiles: false, selectedTargets: [] },
      }));

      mockFetchCloudSyncStatus.mockResolvedValue(idleStatus(0));

      await renderAfterLoadCheck();
      await waitFor(() => {
        expect(getFileSyncExclusionSnapshot().google.canEdit).toBe(true);
      });
      mockQueueCloudFolderSelection.mockClear();

      await act(async () => {
        await requestFileSyncExclusionToggle('google', 'g-file-notes');
      });
      expect(mockQueueCloudFolderSelection).toHaveBeenCalled();

      pollNow();
      await act(async () => {
        await Promise.resolve();
      });
      expect(mockFetchCloudSyncStatus).toHaveBeenCalledTimes(1);
    });
  });

  it('saves folder selections from the custom picker after clicking Apply', async () => {
    mockReadState.mockReturnValue({
      lastTranslationId: 'KJV',
      lastTranslationIds: ['KJV'],
      cloudLinkedAccounts: [
        {
          provider: 'google',
          providerAccountId: 'g-user-1',
          email: 'g@example.com',
          linkedAt: Date.now() - 5000,
        },
      ],
      cloudConfigUpdatedAt: Date.now() - 10_000,
      cloudConfigLastSyncedAt: Date.now() - 10_000,
    });

    window.localStorage.setItem('marginalia:provider-sync-preferences', JSON.stringify({
      google: {
        syncSettings: true,
        syncFiles: true,
        selectedTargets: [],
      },
      microsoft: {
        syncSettings: false,
        syncFiles: false,
        selectedTargets: [],
      },
    }));

    mockGetStoredSessions.mockReturnValue({ google: googleSession });
    mockGetFreshSessions.mockResolvedValue({ google: googleSession });
    mockComputeSupportedFolderSizeForSession.mockResolvedValue(24 * 1024 * 1024);
    mockListFolderChildrenForSession.mockResolvedValue([
      {
        id: 'g-folder-1',
        name: 'Bible Notes Folder',
        kind: 'folder',
        sizeBytes: 24 * 1024 * 1024,
        hasChildren: false,
      },
    ]);

    await renderAccountControl();
    openAccountModal();

    expect(screen.getByRole('region', { name: 'File Sync' })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Google Drive')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Expand Google Drive'));

    await waitFor(() => {
      expect(screen.getByLabelText('Google Drive/Bible Notes Folder')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Google Drive/Bible Notes Folder'));

    // The right panel shows the full path for the root selection, not just the folder name.
    await waitFor(() => {
      expect(screen.getByText('Google Drive/Bible Notes Folder', pathTextOptions)).toBeInTheDocument();
    });

    // Folder size in the right panel is computed lazily; wait for it before Apply so the
    // persisted selection includes the resolved size.
    await waitFor(() => {
      expect(screen.getByText('24 MB')).toBeInTheDocument();
    });

    await assignFileSyncTag('Bible Notes Folder');

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      const persisted = JSON.parse(window.localStorage.getItem('marginalia:provider-sync-preferences') || '{}');
      expect(persisted.google.selectedTargets).toEqual([
        {
          id: 'g-folder-1',
          kind: 'folder',
          name: 'Bible Notes Folder',
          path: 'Google Drive/Bible Notes Folder',
          sizeBytes: 25165824,
          sizeKnown: true,
          tags: ['Teaching'],
        },
      ]);
    });
  });

  it('applies a document viewer exclusion toggle to every root selection of that provider', async () => {
    mockReadState.mockReturnValue({
      lastTranslationId: 'KJV',
      lastTranslationIds: ['KJV'],
      cloudLinkedAccounts: [
        {
          provider: 'google',
          providerAccountId: 'g-user-1',
          email: 'g@example.com',
          linkedAt: Date.now() - 5000,
        },
      ],
      cloudConfigUpdatedAt: Date.now() - 10_000,
      cloudConfigLastSyncedAt: Date.now() - 10_000,
    });

    window.localStorage.setItem('marginalia:provider-sync-preferences', JSON.stringify({
      google: {
        syncSettings: true,
        syncFiles: true,
        selectedTargets: [
          { id: 'g-folder-1', kind: 'folder', name: 'Notes', path: 'Google Drive/Notes', tags: ['Teaching'] },
          { id: 'g-folder-2', kind: 'folder', name: 'Papers', path: 'Google Drive/Papers', tags: ['Teaching'] },
        ],
      },
      microsoft: {
        syncSettings: false,
        syncFiles: false,
        selectedTargets: [],
      },
    }));

    mockGetStoredSessions.mockReturnValue({ google: googleSession });
    mockGetFreshSessions.mockResolvedValue({ google: googleSession });

    await renderAccountControl();

    await waitFor(() => {
      expect(getFileSyncExclusionSnapshot().google.canEdit).toBe(true);
    });

    act(() => {
      requestFileSyncExclusionToggle('google', 'g-file-notes');
    });

    await waitFor(() => {
      const persisted = JSON.parse(window.localStorage.getItem('marginalia:provider-sync-preferences') || '{}');
      expect(persisted.google.selectedTargets.map((target: { excludedItemIds?: string[] }) => target.excludedItemIds))
        .toEqual([['g-file-notes'], ['g-file-notes']]);
    });

    act(() => {
      requestFileSyncExclusionToggle('google', 'g-file-notes');
    });

    await waitFor(() => {
      const persisted = JSON.parse(window.localStorage.getItem('marginalia:provider-sync-preferences') || '{}');
      expect(persisted.google.selectedTargets.every((target: { excludedItemIds?: string[] }) => !target.excludedItemIds))
        .toBe(true);
    });
  });

  it('registers the cloud libraryUrl from CCS on Apply and persists it in sourceUrls', async () => {
    const libraryUrl = 'https://documents.example.com/users/user-cloud-1/library.json';
    const dispatch = jest.fn();
    mockUseAppDispatch.mockReturnValue(dispatch);
    mockQueueCloudFolderSelection.mockResolvedValue({
      ok: true,
      libraryUrl,
    });

    mockReadState.mockReturnValue({
      userId: 'user-cloud-1',
      lastTranslationId: 'KJV',
      lastTranslationIds: ['KJV'],
      cloudLinkedAccounts: [
        {
          provider: 'google',
          providerAccountId: 'g-user-1',
          email: 'g@example.com',
          linkedAt: Date.now() - 5000,
        },
      ],
      cloudConfigUpdatedAt: Date.now() - 10_000,
      cloudConfigLastSyncedAt: Date.now() - 10_000,
    });

    window.localStorage.setItem('marginalia:provider-sync-preferences', JSON.stringify({
      google: {
        syncSettings: true,
        syncFiles: true,
        selectedTargets: [],
      },
      microsoft: {
        syncSettings: false,
        syncFiles: false,
        selectedTargets: [],
      },
    }));

    mockGetStoredSessions.mockReturnValue({ google: googleSession });
    mockGetFreshSessions.mockResolvedValue({ google: googleSession });
    mockComputeSupportedFolderSizeForSession.mockResolvedValue(24 * 1024 * 1024);
    mockListFolderChildrenForSession.mockResolvedValue([
      {
        id: 'g-folder-1',
        name: 'Bible Notes Folder',
        kind: 'folder',
        sizeBytes: 24 * 1024 * 1024,
        hasChildren: false,
      },
    ]);

    await renderAccountControl();
    openAccountModal();

    await waitFor(() => {
      expect(screen.getByText('Google Drive')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Expand Google Drive'));

    await waitFor(() => {
      expect(screen.getByLabelText('Google Drive/Bible Notes Folder')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Google Drive/Bible Notes Folder'));
    await assignFileSyncTag('Bible Notes Folder');
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(mockQueueCloudFolderSelection).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'user-cloud-1',
        provider: 'google',
        trigger: 'apply',
      }));
    });

    await waitFor(() => {
      expect(mockAddSourceUrl).toHaveBeenCalledWith(libraryUrl);
      expect(dispatch).toHaveBeenCalledWith({ type: 'ui/addSourceUrl', payload: libraryUrl });
    });

    await waitFor(() => {
      const writes = mockWriteCloudConfigForSession.mock.calls.map((call) => call[1]);
      expect(writes.some((payload) => Array.isArray(payload?.config?.sourceUrls)
        && payload.config.sourceUrls.includes(libraryUrl))).toBe(true);
    });
  });

  it('excludes an individual supported file from sync without affecting unsupported files or the root selection', async () => {
    mockReadState.mockReturnValue({
      lastTranslationId: 'KJV',
      lastTranslationIds: ['KJV'],
      cloudLinkedAccounts: [
        {
          provider: 'google',
          providerAccountId: 'g-user-1',
          email: 'g@example.com',
          linkedAt: Date.now() - 5000,
        },
      ],
      cloudConfigUpdatedAt: Date.now() - 10_000,
      cloudConfigLastSyncedAt: Date.now() - 10_000,
    });

    window.localStorage.setItem('marginalia:provider-sync-preferences', JSON.stringify({
      google: {
        syncSettings: true,
        syncFiles: true,
        selectedTargets: [],
      },
      microsoft: {
        syncSettings: false,
        syncFiles: false,
        selectedTargets: [],
      },
    }));

    mockGetStoredSessions.mockReturnValue({ google: googleSession });
    mockGetFreshSessions.mockResolvedValue({ google: googleSession });
    mockComputeSupportedFolderSizeForSession.mockResolvedValue(1024);
    mockListFolderChildrenForSession.mockImplementation(async (_session: unknown, parentId: string) => {
      if (parentId === 'g-folder-1') {
        return [
          { id: 'g-file-notes', name: 'notes.txt', kind: 'file', sizeBytes: 1024, hasChildren: false },
          { id: 'g-file-video', name: 'clip.mov', kind: 'file', sizeBytes: 2048, hasChildren: false },
        ];
      }

      return [
        { id: 'g-folder-1', name: 'Bible Notes Folder', kind: 'folder', sizeBytes: 0, hasChildren: true },
      ];
    });

    await renderAccountControl();
    openAccountModal();

    await waitFor(() => {
      expect(screen.getByText('Google Drive')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Expand Google Drive'));

    await waitFor(() => {
      expect(screen.getByLabelText('Google Drive/Bible Notes Folder')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Google Drive/Bible Notes Folder'));

    // Expand the selected root row in the right panel to reveal its files.
    const rightPanel = within(document.querySelector('.cloud-folder-picker-right') as HTMLElement);
    fireEvent.click(rightPanel.getByLabelText('Expand Bible Notes Folder'));

    await waitFor(() => {
      expect(rightPanel.getByText('notes.txt')).toBeInTheDocument();
      expect(rightPanel.getByText('clip.mov')).toBeInTheDocument();
    });

    // The unsupported file has no size and no sync-toggle button.
    expect(rightPanel.queryByLabelText(/clip\.mov from sync/i)).not.toBeInTheDocument();

    fireEvent.click(rightPanel.getByLabelText(/Exclude .*notes\.txt from sync/i));

    await assignFileSyncTag('Bible Notes Folder');

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      const persisted = JSON.parse(window.localStorage.getItem('marginalia:provider-sync-preferences') || '{}');
      expect(persisted.google.selectedTargets).toHaveLength(1);
      expect(persisted.google.selectedTargets[0].excludedItemIds).toEqual(['g-file-notes']);
      expect(persisted.google.selectedTargets[0].tags).toEqual(['Teaching']);
    });
  });

  it('assigns a seeded default tag to a selected folder via the tag modal and persists it on Apply', async () => {
    mockReadState.mockReturnValue({
      lastTranslationId: 'KJV',
      lastTranslationIds: ['KJV'],
      cloudLinkedAccounts: [
        {
          provider: 'google',
          providerAccountId: 'g-user-1',
          email: 'g@example.com',
          linkedAt: Date.now() - 5000,
        },
      ],
      cloudConfigUpdatedAt: Date.now() - 10_000,
      cloudConfigLastSyncedAt: Date.now() - 10_000,
    });

    window.localStorage.setItem('marginalia:provider-sync-preferences', JSON.stringify({
      google: {
        syncSettings: true,
        syncFiles: true,
        selectedTargets: [],
      },
      microsoft: {
        syncSettings: false,
        syncFiles: false,
        selectedTargets: [],
      },
    }));

    mockGetStoredSessions.mockReturnValue({ google: googleSession });
    mockGetFreshSessions.mockResolvedValue({ google: googleSession });
    mockComputeSupportedFolderSizeForSession.mockResolvedValue(1024);
    mockListFolderChildrenForSession.mockResolvedValue([
      { id: 'g-folder-1', name: 'Bible Notes Folder', kind: 'folder', sizeBytes: 0, hasChildren: false },
    ]);

    await renderAccountControl();
    openAccountModal();

    await waitFor(() => {
      expect(screen.getByText('Google Drive')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Expand Google Drive'));

    await waitFor(() => {
      expect(screen.getByLabelText('Google Drive/Bible Notes Folder')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Google Drive/Bible Notes Folder'));

    const rightPanel = within(document.querySelector('.cloud-folder-picker-right') as HTMLElement);

    fireEvent.click(rightPanel.getByRole('button', { name: '+ Tags' }));

    await waitFor(() => {
      expect(screen.getByText('Tags for Bible Notes Folder')).toBeInTheDocument();
    });

    // "Teaching" is one of the seeded default tags shown when no tags exist yet.
    const tagInput = document.getElementById('fileSyncTagInput') as HTMLInputElement;
    fireEvent.change(tagInput, { target: { value: 'Teaching' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    // The "+ Tags" button is replaced by the assigned tag chip.
    expect(rightPanel.getByRole('button', { name: 'Teaching' })).toBeInTheDocument();
    expect(rightPanel.queryByRole('button', { name: '+ Tags' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      const persisted = JSON.parse(window.localStorage.getItem('marginalia:provider-sync-preferences') || '{}');
      expect(persisted.google.selectedTargets[0].tags).toEqual(['Teaching']);
    });
  });

  it('flashes the + Tags button when the last tag is removed, but not when a folder is first selected', async () => {
    mockReadState.mockReturnValue({
      lastTranslationId: 'KJV',
      lastTranslationIds: ['KJV'],
      cloudLinkedAccounts: [
        {
          provider: 'google',
          providerAccountId: 'g-user-1',
          email: 'g@example.com',
          linkedAt: Date.now() - 5000,
        },
      ],
      cloudConfigUpdatedAt: Date.now() - 10_000,
      cloudConfigLastSyncedAt: Date.now() - 10_000,
    });

    window.localStorage.setItem('marginalia:provider-sync-preferences', JSON.stringify({
      google: {
        syncSettings: true,
        syncFiles: true,
        selectedTargets: [],
      },
      microsoft: {
        syncSettings: false,
        syncFiles: false,
        selectedTargets: [],
      },
    }));

    mockGetStoredSessions.mockReturnValue({ google: googleSession });
    mockGetFreshSessions.mockResolvedValue({ google: googleSession });
    mockComputeSupportedFolderSizeForSession.mockResolvedValue(1024);
    mockListFolderChildrenForSession.mockResolvedValue([
      { id: 'g-folder-1', name: 'Bible Notes Folder', kind: 'folder', sizeBytes: 0, hasChildren: false },
    ]);

    await renderAccountControl();
    openAccountModal();

    await waitFor(() => {
      expect(screen.getByText('Google Drive')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Expand Google Drive'));

    await waitFor(() => {
      expect(screen.getByLabelText('Google Drive/Bible Notes Folder')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Google Drive/Bible Notes Folder'));

    const rightPanel = within(document.querySelector('.cloud-folder-picker-right') as HTMLElement);

    await waitFor(() => {
      expect(rightPanel.getByRole('button', { name: '+ Tags' })).toBeInTheDocument();
    });

    // Newly selected folders start untagged without a warning flash.
    expect(rightPanel.getByRole('button', { name: '+ Tags' })).not.toHaveClass('is-flashing');

    await assignFileSyncTag('Bible Notes Folder');

    fireEvent.click(rightPanel.getByRole('button', { name: 'Teaching' }));

    await waitFor(() => {
      expect(screen.getByText('Tags for Bible Notes Folder')).toBeInTheDocument();
    });

    const removeTagButton = document.querySelector('.file-sync-tag-select__multi-value__remove');
    expect(removeTagButton).not.toBeNull();
    fireEvent.click(removeTagButton as Element);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    await waitFor(() => {
      expect(rightPanel.getByRole('button', { name: '+ Tags' })).toHaveClass('is-flashing');
    });
  });

  it('blocks Apply when a selected folder has no tags, alerts, and flashes + Tags', async () => {
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => undefined);

    mockReadState.mockReturnValue({
      lastTranslationId: 'KJV',
      lastTranslationIds: ['KJV'],
      cloudLinkedAccounts: [
        {
          provider: 'google',
          providerAccountId: 'g-user-1',
          email: 'g@example.com',
          linkedAt: Date.now() - 5000,
        },
      ],
      cloudConfigUpdatedAt: Date.now() - 10_000,
      cloudConfigLastSyncedAt: Date.now() - 10_000,
    });

    window.localStorage.setItem('marginalia:provider-sync-preferences', JSON.stringify({
      google: {
        syncSettings: true,
        syncFiles: true,
        selectedTargets: [],
      },
      microsoft: {
        syncSettings: false,
        syncFiles: false,
        selectedTargets: [],
      },
    }));

    mockGetStoredSessions.mockReturnValue({ google: googleSession });
    mockGetFreshSessions.mockResolvedValue({ google: googleSession });
    mockComputeSupportedFolderSizeForSession.mockResolvedValue(1024);
    mockListFolderChildrenForSession.mockResolvedValue([
      { id: 'g-folder-1', name: 'Bible Notes Folder', kind: 'folder', sizeBytes: 0, hasChildren: false },
    ]);

    await renderAccountControl();
    openAccountModal();

    await waitFor(() => {
      expect(screen.getByText('Google Drive')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Expand Google Drive'));

    await waitFor(() => {
      expect(screen.getByLabelText('Google Drive/Bible Notes Folder')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Google Drive/Bible Notes Folder'));

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(alertSpy).toHaveBeenCalledWith('You must supply tags for all files before saving.');

    const rightPanel = within(document.querySelector('.cloud-folder-picker-right') as HTMLElement);
    await waitFor(() => {
      expect(rightPanel.getByRole('button', { name: '+ Tags' })).toHaveClass('is-flashing');
    });

    const persisted = JSON.parse(window.localStorage.getItem('marginalia:provider-sync-preferences') || '{}');
    expect(persisted.google.selectedTargets).toEqual([]);

    alertSpy.mockRestore();
  });

  it('shows a folder tag as inherited on its children and lets an inherited tag be excluded for one of them', async () => {
    mockReadState.mockReturnValue({
      lastTranslationId: 'KJV',
      lastTranslationIds: ['KJV'],
      cloudLinkedAccounts: [
        {
          provider: 'google',
          providerAccountId: 'g-user-1',
          email: 'g@example.com',
          linkedAt: Date.now() - 5000,
        },
      ],
      cloudConfigUpdatedAt: Date.now() - 10_000,
      cloudConfigLastSyncedAt: Date.now() - 10_000,
    });

    window.localStorage.setItem('marginalia:provider-sync-preferences', JSON.stringify({
      google: {
        syncSettings: true,
        syncFiles: true,
        selectedTargets: [
          {
            id: 'g-folder-1',
            kind: 'folder',
            name: 'Bible Notes Folder',
            path: 'Google Drive/Bible Notes Folder',
            tags: ['Teaching'],
          },
        ],
      },
      microsoft: {
        syncSettings: false,
        syncFiles: false,
        selectedTargets: [],
      },
    }));

    mockGetStoredSessions.mockReturnValue({ google: googleSession });
    mockGetFreshSessions.mockResolvedValue({ google: googleSession });
    mockComputeSupportedFolderSizeForSession.mockResolvedValue(1024);
    mockListFolderChildrenForSession.mockResolvedValue([
      { id: 'g-file-notes', name: 'notes.txt', kind: 'file', sizeBytes: 1024, hasChildren: false },
    ]);

    await renderAccountControl();
    openAccountModal();

    const rightPanel = within(document.querySelector('.cloud-folder-picker-right') as HTMLElement);

    await waitFor(() => {
      expect(document.querySelector('.cloud-folder-selected-path')).toHaveTextContent('Bible Notes Folder');
    });

    // The seeded default tag color storage isn't populated for this pre-existing tag, so it renders as a fallback-colored chip.
    expect(rightPanel.getByRole('button', { name: 'Teaching' })).toBeInTheDocument();

    fireEvent.click(rightPanel.getByLabelText('Expand Bible Notes Folder'));

    await waitFor(() => {
      expect(rightPanel.getByText('notes.txt')).toBeInTheDocument();
    });

    // The child file shows the ancestor's tag as an inherited chip, distinguishable from an owned one.
    const inheritedChip = rightPanel.getAllByRole('button', { name: 'Teaching' })[1];
    expect(inheritedChip).toHaveClass('is-inherited');

    fireEvent.click(inheritedChip);

    await waitFor(() => {
      expect(screen.getByText('Tags for notes.txt')).toBeInTheDocument();
    });

    // The modal shows the inherited tag alongside any owned ones; removing it here is what
    // records the exclusion instead of trying to edit a tag this item never owned.
    const removeInheritedTagButton = document.querySelector('.file-sync-tag-select__multi-value__remove');
    expect(removeInheritedTagButton).not.toBeNull();
    fireEvent.click(removeInheritedTagButton as Element);

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    // Excluding the inherited tag removes it from the child's display without touching the parent's own chip.
    expect(rightPanel.getAllByRole('button', { name: 'Teaching' })).toHaveLength(1);
    // Clearing the child's last effective tag flashes its + Tags control.
    expect(rightPanel.getByRole('button', { name: '+ Tags' })).toHaveClass('is-flashing');

    // A replacement own tag is required before Apply — every synced item needs at least one tag.
    fireEvent.click(rightPanel.getByRole('button', { name: '+ Tags' }));

    await waitFor(() => {
      expect(screen.getByText('Tags for notes.txt')).toBeInTheDocument();
    });

    const tagInput = document.getElementById('fileSyncTagInput') as HTMLInputElement;
    fireEvent.change(tagInput, { target: { value: 'Research Materials' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    await waitFor(() => {
      expect(rightPanel.getByRole('button', { name: 'Research Materials' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      const persisted = JSON.parse(window.localStorage.getItem('marginalia:provider-sync-preferences') || '{}');
      expect(persisted.google.selectedTargets[0].tags).toEqual(['Teaching']);
      expect(persisted.google.selectedTargets[0].itemTags).toEqual({ 'g-file-notes': ['Research Materials'] });
      expect(persisted.google.selectedTargets[0].itemTagExclusions).toEqual({ 'g-file-notes': ['Teaching'] });
    });
  });

  it('hides (without collapsing layout) the sync toggle for descendants of an excluded subfolder', async () => {
    mockReadState.mockReturnValue({
      lastTranslationId: 'KJV',
      lastTranslationIds: ['KJV'],
      cloudLinkedAccounts: [
        {
          provider: 'google',
          providerAccountId: 'g-user-1',
          email: 'g@example.com',
          linkedAt: Date.now() - 5000,
        },
      ],
      cloudConfigUpdatedAt: Date.now() - 10_000,
      cloudConfigLastSyncedAt: Date.now() - 10_000,
    });

    window.localStorage.setItem('marginalia:provider-sync-preferences', JSON.stringify({
      google: {
        syncSettings: true,
        syncFiles: true,
        selectedTargets: [],
      },
      microsoft: {
        syncSettings: false,
        syncFiles: false,
        selectedTargets: [],
      },
    }));

    mockGetStoredSessions.mockReturnValue({ google: googleSession });
    mockGetFreshSessions.mockResolvedValue({ google: googleSession });
    mockComputeSupportedFolderSizeForSession.mockResolvedValue(0);
    mockListFolderChildrenForSession.mockImplementation(async (_session: unknown, parentId: string) => {
      if (parentId === 'g-folder-1') {
        return [
          { id: 'g-sub-a', name: 'Old Testament', kind: 'folder', sizeBytes: 0, hasChildren: true },
        ];
      }

      if (parentId === 'g-sub-a') {
        return [
          { id: 'g-sub-b', name: 'Genesis', kind: 'folder', sizeBytes: 0, hasChildren: true },
        ];
      }

      if (parentId === 'g-sub-b') {
        return [
          { id: 'g-file-c', name: 'chapter1.txt', kind: 'file', sizeBytes: 100, hasChildren: false },
        ];
      }

      return [
        { id: 'g-folder-1', name: 'Bible Notes Folder', kind: 'folder', sizeBytes: 0, hasChildren: true },
      ];
    });

    await renderAccountControl();
    openAccountModal();

    await waitFor(() => {
      expect(screen.getByText('Google Drive')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Expand Google Drive'));

    await waitFor(() => {
      expect(screen.getByLabelText('Google Drive/Bible Notes Folder')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Google Drive/Bible Notes Folder'));

    const rightPanel = within(document.querySelector('.cloud-folder-picker-right') as HTMLElement);
    fireEvent.click(rightPanel.getByLabelText('Expand Bible Notes Folder'));

    await waitFor(() => {
      expect(rightPanel.getByText('Old Testament')).toBeInTheDocument();
    });

    // Exclude "Old Testament" itself; its own sync toggle should remain visible.
    fireEvent.click(rightPanel.getByLabelText(/Exclude .*Old Testament from sync/i));
    expect(rightPanel.getByLabelText(/Resume syncing .*Old Testament/i)).toBeInTheDocument();

    fireEvent.click(rightPanel.getByLabelText('Expand Old Testament'));

    await waitFor(() => {
      expect(rightPanel.getByText('Genesis')).toBeInTheDocument();
    });

    // A descendant folder of an excluded folder keeps its sync-toggle slot (for layout) but the
    // button itself is hidden and disabled since it's already excluded via its ancestor.
    const genesisSyncButton = rightPanel.getByLabelText(/Exclude .*Genesis from sync/i);
    expect(genesisSyncButton).toHaveStyle({ visibility: 'hidden' });
    expect(genesisSyncButton).toBeDisabled();

    fireEvent.click(rightPanel.getByLabelText('Expand Genesis'));

    await waitFor(() => {
      expect(rightPanel.getByText('chapter1.txt')).toBeInTheDocument();
    });

    // Same for a deeper descendant file.
    const chapterSyncButton = rightPanel.getByLabelText(/Exclude .*chapter1\.txt from sync/i);
    expect(chapterSyncButton).toHaveStyle({ visibility: 'hidden' });
    expect(chapterSyncButton).toBeDisabled();
  });

  it('expands a nested subfolder in the right panel independently of the left panel', async () => {
    mockReadState.mockReturnValue({
      lastTranslationId: 'KJV',
      lastTranslationIds: ['KJV'],
      cloudLinkedAccounts: [
        {
          provider: 'google',
          providerAccountId: 'g-user-1',
          email: 'g@example.com',
          linkedAt: Date.now() - 5000,
        },
      ],
      cloudConfigUpdatedAt: Date.now() - 10_000,
      cloudConfigLastSyncedAt: Date.now() - 10_000,
    });

    window.localStorage.setItem('marginalia:provider-sync-preferences', JSON.stringify({
      google: {
        syncSettings: true,
        syncFiles: true,
        selectedTargets: [],
      },
      microsoft: {
        syncSettings: false,
        syncFiles: false,
        selectedTargets: [],
      },
    }));

    mockGetStoredSessions.mockReturnValue({ google: googleSession });
    mockGetFreshSessions.mockResolvedValue({ google: googleSession });
    mockComputeSupportedFolderSizeForSession.mockResolvedValue(1024);
    mockListFolderChildrenForSession.mockImplementation(async (_session: unknown, parentId: string) => {
      if (parentId === 'g-folder-1') {
        return [
          { id: 'g-subfolder-1', name: 'Old Testament', kind: 'folder', sizeBytes: 0, hasChildren: true },
        ];
      }

      if (parentId === 'g-subfolder-1') {
        return [
          { id: 'g-file-genesis', name: 'genesis.txt', kind: 'file', sizeBytes: 512, hasChildren: false },
        ];
      }

      return [
        { id: 'g-folder-1', name: 'Bible Notes Folder', kind: 'folder', sizeBytes: 0, hasChildren: true },
      ];
    });

    await renderAccountControl();
    openAccountModal();

    await waitFor(() => {
      expect(screen.getByText('Google Drive')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Expand Google Drive'));

    await waitFor(() => {
      expect(screen.getByLabelText('Google Drive/Bible Notes Folder')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Google Drive/Bible Notes Folder'));

    const rightPanel = within(document.querySelector('.cloud-folder-picker-right') as HTMLElement);
    fireEvent.click(rightPanel.getByLabelText('Expand Bible Notes Folder'));

    await waitFor(() => {
      expect(rightPanel.getByText('Old Testament')).toBeInTheDocument();
    });

    fireEvent.click(rightPanel.getByLabelText('Expand Old Testament'));

    await waitFor(() => {
      expect(rightPanel.getByText('genesis.txt')).toBeInTheDocument();
    });
  });

  it('discards folder selections when Cancel is clicked', async () => {
    mockReadState.mockReturnValue({
      lastTranslationId: 'KJV',
      lastTranslationIds: ['KJV'],
      cloudLinkedAccounts: [
        {
          provider: 'google',
          providerAccountId: 'g-user-1',
          email: 'g@example.com',
          linkedAt: Date.now() - 5000,
        },
      ],
      cloudConfigUpdatedAt: Date.now() - 10_000,
      cloudConfigLastSyncedAt: Date.now() - 10_000,
    });

    window.localStorage.setItem('marginalia:provider-sync-preferences', JSON.stringify({
      google: {
        syncSettings: true,
        syncFiles: true,
        selectedTargets: [],
      },
      microsoft: {
        syncSettings: false,
        syncFiles: false,
        selectedTargets: [],
      },
    }));

    mockGetStoredSessions.mockReturnValue({ google: googleSession });
    mockGetFreshSessions.mockResolvedValue({ google: googleSession });
    mockComputeSupportedFolderSizeForSession.mockResolvedValue(24 * 1024 * 1024);
    mockListFolderChildrenForSession.mockResolvedValue([
      {
        id: 'g-folder-1',
        name: 'Bible Notes Folder',
        kind: 'folder',
        sizeBytes: 24 * 1024 * 1024,
        hasChildren: false,
      },
    ]);

    await renderAccountControl();
    openAccountModal();

    await waitFor(() => {
      expect(screen.getByText('Google Drive')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Expand Google Drive'));

    await waitFor(() => {
      expect(screen.getByLabelText('Google Drive/Bible Notes Folder')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Google Drive/Bible Notes Folder'));

    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();

    const confirmSpy = jest.spyOn(window, 'confirm');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
    expect(screen.queryByText('Account Sync')).not.toBeInTheDocument();

    const persisted = JSON.parse(window.localStorage.getItem('marginalia:provider-sync-preferences') || '{}');
    expect(persisted.google.selectedTargets).toEqual([]);

    openAccountModal();
    fireEvent.click(await screen.findByLabelText('Expand Google Drive'));
    expect(await screen.findByLabelText('Google Drive/Bible Notes Folder')).not.toBeChecked();
  });

  it('keeps Cancel enabled and closes the modal when nothing has changed', async () => {
    await renderAccountControl();
    openAccountModal();

    const cancelButton = await screen.findByRole('button', { name: 'Cancel' });
    expect(cancelButton).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();

    fireEvent.click(cancelButton);

    expect(screen.queryByText('Account Sync')).not.toBeInTheDocument();
  });

  it('shows left-panel chevrons immediately, then hides them for subfolders without their own subfolders', async () => {
    mockReadState.mockReturnValue({
      lastTranslationId: 'KJV',
      lastTranslationIds: ['KJV'],
      cloudLinkedAccounts: [
        {
          provider: 'google',
          providerAccountId: 'g-user-1',
          email: 'g@example.com',
          linkedAt: Date.now() - 5000,
        },
      ],
      cloudConfigUpdatedAt: Date.now() - 10_000,
      cloudConfigLastSyncedAt: Date.now() - 10_000,
    });

    window.localStorage.setItem('marginalia:provider-sync-preferences', JSON.stringify({
      google: {
        syncSettings: true,
        syncFiles: true,
        selectedTargets: [],
      },
      microsoft: {
        syncSettings: false,
        syncFiles: false,
        selectedTargets: [],
      },
    }));

    mockGetStoredSessions.mockReturnValue({ google: googleSession });
    mockGetFreshSessions.mockResolvedValue({ google: googleSession });
    mockListFolderChildrenForSession.mockImplementation(async (_session: unknown, parentId: string) => {
      if (parentId === 'root') {
        return [
          { id: 'g-has-sub', name: 'HasSub', kind: 'folder', sizeBytes: 0, hasChildren: true },
          { id: 'g-no-sub', name: 'NoSub', kind: 'folder', sizeBytes: 0, hasChildren: true },
        ];
      }

      if (parentId === 'g-has-sub') {
        return [
          { id: 'g-deeper', name: 'Deeper', kind: 'folder', sizeBytes: 0, hasChildren: true },
        ];
      }

      if (parentId === 'g-no-sub') {
        return [
          { id: 'g-leaf-file', name: 'leaf.txt', kind: 'file', sizeBytes: 10, hasChildren: false },
        ];
      }

      return [];
    });

    await renderAccountControl();
    openAccountModal();

    await waitFor(() => {
      expect(screen.getByText('Google Drive')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Expand Google Drive'));

    await waitFor(() => {
      expect(screen.getByLabelText('Google Drive/HasSub')).toBeInTheDocument();
      expect(screen.getByLabelText('Google Drive/NoSub')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.queryByLabelText('Expand NoSub')).not.toBeInTheDocument();
    });

    expect(screen.getByLabelText('Expand HasSub')).toBeInTheDocument();
  });

  it('renders subfolders before their subfolder checks finish and keeps the chevron when a check fails', async () => {
    mockReadState.mockReturnValue({
      lastTranslationId: 'KJV',
      lastTranslationIds: ['KJV'],
      cloudLinkedAccounts: [
        {
          provider: 'google',
          providerAccountId: 'g-user-1',
          email: 'g@example.com',
          linkedAt: Date.now() - 5000,
        },
      ],
      cloudConfigUpdatedAt: Date.now() - 10_000,
      cloudConfigLastSyncedAt: Date.now() - 10_000,
    });

    window.localStorage.setItem('marginalia:provider-sync-preferences', JSON.stringify({
      google: {
        syncSettings: true,
        syncFiles: true,
        selectedTargets: [],
      },
      microsoft: {
        syncSettings: false,
        syncFiles: false,
        selectedTargets: [],
      },
    }));

    let resolveNoSubCheck: (children: unknown[]) => void = () => undefined;
    mockGetStoredSessions.mockReturnValue({ google: googleSession });
    mockGetFreshSessions.mockResolvedValue({ google: googleSession });
    mockListFolderChildrenForSession.mockImplementation(async (_session: unknown, parentId: string) => {
      if (parentId === 'root') {
        return [
          { id: 'g-no-sub', name: 'NoSub', kind: 'folder', sizeBytes: 0, hasChildren: true },
          { id: 'g-broken', name: 'Broken', kind: 'folder', sizeBytes: 0, hasChildren: true },
        ];
      }

      if (parentId === 'g-no-sub') {
        return new Promise((resolve) => {
          resolveNoSubCheck = resolve;
        });
      }

      if (parentId === 'g-broken') {
        throw new Error('Drive unavailable');
      }

      return [];
    });

    await renderAccountControl();
    openAccountModal();

    await waitFor(() => {
      expect(screen.getByText('Google Drive')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Expand Google Drive'));

    await waitFor(() => {
      expect(screen.getByLabelText('Expand NoSub')).toBeInTheDocument();
      expect(screen.getByLabelText('Expand Broken')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(mockListFolderChildrenForSession).toHaveBeenCalledWith(googleSession, 'g-broken', undefined);
    });

    await act(async () => {
      resolveNoSubCheck([{ id: 'g-leaf-file', name: 'leaf.txt', kind: 'file', sizeBytes: 10, hasChildren: false }]);
    });

    await waitFor(() => {
      expect(screen.queryByLabelText('Expand NoSub')).not.toBeInTheDocument();
    });

    expect(screen.getByLabelText('Expand Broken')).toBeInTheDocument();
  });

  it('loads a subfolder normally when it is expanded before its subfolder check completes', async () => {
    mockReadState.mockReturnValue({
      lastTranslationId: 'KJV',
      lastTranslationIds: ['KJV'],
      cloudLinkedAccounts: [
        {
          provider: 'google',
          providerAccountId: 'g-user-1',
          email: 'g@example.com',
          linkedAt: Date.now() - 5000,
        },
      ],
      cloudConfigUpdatedAt: Date.now() - 10_000,
      cloudConfigLastSyncedAt: Date.now() - 10_000,
    });

    window.localStorage.setItem('marginalia:provider-sync-preferences', JSON.stringify({
      google: {
        syncSettings: true,
        syncFiles: true,
        selectedTargets: [],
      },
      microsoft: {
        syncSettings: false,
        syncFiles: false,
        selectedTargets: [],
      },
    }));

    const pendingChecks: Array<(children: unknown[]) => void> = [];
    mockGetStoredSessions.mockReturnValue({ google: googleSession });
    mockGetFreshSessions.mockResolvedValue({ google: googleSession });
    mockListFolderChildrenForSession.mockImplementation(async (_session: unknown, parentId: string) => {
      if (parentId === 'root') {
        return [
          { id: 'g-slow', name: 'Slow', kind: 'folder', sizeBytes: 0, hasChildren: true },
        ];
      }

      if (parentId === 'g-slow') {
        return new Promise((resolve) => {
          pendingChecks.push(resolve);
        });
      }

      return [];
    });

    await renderAccountControl();
    openAccountModal();

    await waitFor(() => {
      expect(screen.getByText('Google Drive')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Expand Google Drive'));

    await waitFor(() => {
      expect(pendingChecks).toHaveLength(1);
    });

    fireEvent.click(screen.getByLabelText('Expand Slow'));

    await waitFor(() => {
      expect(pendingChecks).toHaveLength(2);
    });

    await act(async () => {
      pendingChecks[1]([{ id: 'g-slow-child', name: 'SlowChild', kind: 'folder', sizeBytes: 0, hasChildren: true }]);
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Google Drive/Slow/SlowChild')).toBeInTheDocument();
    });

    await act(async () => {
      pendingChecks[0]([]);
    });

    expect(screen.getByLabelText('Collapse Slow')).toBeInTheDocument();
  });

  it('hides a right-panel folder chevron once expansion reveals it is completely empty', async () => {
    mockReadState.mockReturnValue({
      lastTranslationId: 'KJV',
      lastTranslationIds: ['KJV'],
      cloudLinkedAccounts: [
        {
          provider: 'google',
          providerAccountId: 'g-user-1',
          email: 'g@example.com',
          linkedAt: Date.now() - 5000,
        },
      ],
      cloudConfigUpdatedAt: Date.now() - 10_000,
      cloudConfigLastSyncedAt: Date.now() - 10_000,
    });

    window.localStorage.setItem('marginalia:provider-sync-preferences', JSON.stringify({
      google: {
        syncSettings: true,
        syncFiles: true,
        selectedTargets: [],
      },
      microsoft: {
        syncSettings: false,
        syncFiles: false,
        selectedTargets: [],
      },
    }));

    mockGetStoredSessions.mockReturnValue({ google: googleSession });
    mockGetFreshSessions.mockResolvedValue({ google: googleSession });
    mockComputeSupportedFolderSizeForSession.mockResolvedValue(0);
    mockListFolderChildrenForSession.mockImplementation(async (_session: unknown, parentId: string) => {
      if (parentId === 'g-folder-1') {
        return [];
      }

      return [
        { id: 'g-folder-1', name: 'Empty Folder', kind: 'folder', sizeBytes: 0, hasChildren: true },
      ];
    });

    await renderAccountControl();
    openAccountModal();

    await waitFor(() => {
      expect(screen.getByText('Google Drive')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Expand Google Drive'));

    await waitFor(() => {
      expect(screen.getByLabelText('Google Drive/Empty Folder')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Google Drive/Empty Folder'));

    const rightPanel = within(document.querySelector('.cloud-folder-picker-right') as HTMLElement);
    expect(rightPanel.getByLabelText('Expand Empty Folder')).toBeInTheDocument();

    fireEvent.click(rightPanel.getByLabelText('Expand Empty Folder'));

    await waitFor(() => {
      expect(rightPanel.queryByLabelText('Expand Empty Folder')).not.toBeInTheDocument();
      expect(rightPanel.queryByLabelText('Collapse Empty Folder')).not.toBeInTheDocument();
    });
  });

  it('keeps prior folder selections when picker is opened', async () => {
    mockReadState.mockReturnValue({
      lastTranslationId: 'KJV',
      lastTranslationIds: ['KJV'],
      cloudLinkedAccounts: [
        {
          provider: 'google',
          providerAccountId: 'g-user-1',
          email: 'g@example.com',
          linkedAt: Date.now() - 5000,
        },
      ],
      cloudConfigUpdatedAt: Date.now() - 10_000,
      cloudConfigLastSyncedAt: Date.now() - 10_000,
    });

    window.localStorage.setItem('marginalia:provider-sync-preferences', JSON.stringify({
      google: {
        syncSettings: true,
        syncFiles: true,
        selectedTargets: [
          {
            id: 'existing-1',
            kind: 'folder',
            name: 'Existing Notes',
            path: 'Google Drive/Existing Notes',
            sizeBytes: 4096,
          },
        ],
      },
      microsoft: {
        syncSettings: false,
        syncFiles: false,
        selectedTargets: [],
      },
    }));

    mockGetStoredSessions.mockReturnValue({ google: googleSession });
    mockGetFreshSessions.mockResolvedValue({ google: googleSession });
    mockComputeSupportedFolderSizeForSession.mockResolvedValue(4096);

    await renderAccountControl();
    openAccountModal();

    expect(screen.getByRole('region', { name: 'File Sync' })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Google Drive')).toBeInTheDocument();
    });

    const persisted = JSON.parse(window.localStorage.getItem('marginalia:provider-sync-preferences') || '{}');
    expect(persisted.google.selectedTargets).toEqual([
      {
        id: 'existing-1',
        kind: 'folder',
        name: 'Existing Notes',
        path: 'Google Drive/Existing Notes',
        sizeBytes: 4096,
      },
    ]);
  });

  it('shows all persisted folder selections in the right panel on load, without expanding the left panel', async () => {
    mockReadState.mockReturnValue({
      lastTranslationId: 'KJV',
      lastTranslationIds: ['KJV'],
      cloudLinkedAccounts: [
        {
          provider: 'google',
          providerAccountId: 'g-user-1',
          email: 'g@example.com',
          linkedAt: Date.now() - 5000,
        },
        {
          provider: 'microsoft',
          providerAccountId: 'ms-user-1',
          email: 'ms@example.com',
          linkedAt: Date.now() - 5000,
        },
      ],
      cloudConfigUpdatedAt: Date.now() - 10_000,
      cloudConfigLastSyncedAt: Date.now() - 10_000,
    });

    window.localStorage.setItem('marginalia:provider-sync-preferences', JSON.stringify({
      google: {
        syncSettings: true,
        syncFiles: true,
        selectedTargets: [
          {
            id: 'g-chicken',
            kind: 'folder',
            name: 'Chicken',
            path: 'Google Drive/Egg/Chicken',
          },
        ],
      },
      microsoft: {
        syncSettings: true,
        syncFiles: true,
        selectedTargets: [
          {
            id: 'ms-documents',
            kind: 'folder',
            name: 'Documents',
            path: 'OneDrive/Documents',
          },
        ],
      },
    }));

    mockGetStoredSessions.mockReturnValue({ google: googleSession, microsoft: msSession });
    mockGetFreshSessions.mockResolvedValue({ google: googleSession, microsoft: msSession });
    mockComputeSupportedFolderSizeForSession.mockResolvedValue(0);

    await renderAccountControl();
    openAccountModal();

    const rightPanel = within(document.querySelector('.cloud-folder-picker-right') as HTMLElement);

    await waitFor(() => {
      expect(rightPanel.getByText('Google Drive/Egg/Chicken', pathTextOptions)).toBeInTheDocument();
      expect(rightPanel.getByText('OneDrive/Documents', pathTextOptions)).toBeInTheDocument();
    });

    // Neither the left-panel root, nor any intermediate folder, was ever expanded.
    expect(screen.queryByLabelText('Google Drive/Egg')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('OneDrive/Documents')).not.toBeInTheDocument();
  });

  it('always shows both provider roots in file sync panel', async () => {
    mockReadState.mockReturnValue({
      lastTranslationId: 'KJV',
      lastTranslationIds: ['KJV'],
      cloudLinkedAccounts: [
        {
          provider: 'microsoft',
          providerAccountId: 'ms-user-1',
          email: 'ms@example.com',
          linkedAt: Date.now() - 5000,
        },
      ],
      cloudConfigUpdatedAt: Date.now() - 10_000,
      cloudConfigLastSyncedAt: Date.now() - 10_000,
    });

    window.localStorage.setItem('marginalia:provider-sync-preferences', JSON.stringify({
      google: {
        syncSettings: false,
        syncFiles: false,
        selectedTargets: [],
      },
      microsoft: {
        syncSettings: true,
        syncFiles: true,
        selectedTargets: [],
      },
    }));

    mockGetStoredSessions.mockReturnValue({ microsoft: msSession });
    mockGetFreshSessions.mockResolvedValue({ microsoft: msSession });

    await renderAccountControl();
    openAccountModal();

    expect(screen.getByRole('region', { name: 'File Sync' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('OneDrive')).toBeInTheDocument();
      expect(screen.getByText('Google Drive')).toBeInTheDocument();
    });
  });

  it('shows a helpful message when folder loading fails', async () => {
    mockReadState.mockReturnValue({
      lastTranslationId: 'KJV',
      lastTranslationIds: ['KJV'],
      cloudLinkedAccounts: [
        {
          provider: 'microsoft',
          providerAccountId: 'ms-user-1',
          email: 'ms@example.com',
          linkedAt: Date.now() - 5000,
        },
      ],
      cloudConfigUpdatedAt: Date.now() - 10_000,
      cloudConfigLastSyncedAt: Date.now() - 10_000,
    });

    window.localStorage.setItem('marginalia:provider-sync-preferences', JSON.stringify({
      google: {
        syncSettings: false,
        syncFiles: false,
        selectedTargets: [],
      },
      microsoft: {
        syncSettings: true,
        syncFiles: true,
        selectedTargets: [],
      },
    }));

    mockGetStoredSessions.mockReturnValue({ microsoft: msSession });
    mockGetFreshSessions.mockResolvedValue({ microsoft: msSession });
    mockListFolderChildrenForSession.mockRejectedValue(new Error('Graph unavailable'));

    await renderAccountControl();
    openAccountModal();

    await waitFor(() => {
      expect(screen.getByText('OneDrive')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Expand OneDrive'));

    await waitFor(() => {
      expect(screen.getByText(/Unable to load folders: Graph unavailable/i)).toBeInTheDocument();
    });
  });
});
