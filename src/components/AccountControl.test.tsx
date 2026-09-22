import { act, fireEvent, getDefaultNormalizer, render, screen, waitFor, within } from '@testing-library/react';
import AccountControl from './AccountControl';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { bibleService } from '../services/bibleService';
import {
  beginFederatedAuthorization,
  completeFederatedAuthorizationFromUrl,
  getFreshFederatedSessions,
  getStoredFederatedSessions,
} from '../services/federatedAuthService';
import {
  listFolderChildrenForSession,
  computeSupportedFolderSizeForSession,
  readCloudConfigForSession,
  writeCloudConfigForSession,
} from '../services/cloudConfigProviderService';
import { queueCloudFolderSelection } from '../services/cloudControlService';
import { addSourceUrl } from '../store/slices/uiSlice';

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
  restoreState: jest.fn((payload: unknown) => ({ type: 'ui/restoreState', payload })),
  setUserId: jest.fn((payload: unknown) => ({ type: 'ui/setUserId', payload })),
}));

jest.mock('../services/bibleService', () => ({
  bibleService: {
    readState: jest.fn(),
    persistState: jest.fn(),
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
  revokeStoredRefreshToken: jest.fn(),
  writeStoredSessions: jest.fn(),
}));

jest.mock('../services/cloudControlService', () => ({
  queueCloudFolderSelection: jest.fn(),
  reportSyncActivity: jest.fn(),
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
const mockAddSourceUrl = addSourceUrl as jest.Mock;

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

function expandProvider(provider: 'Google' | 'Microsoft') {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`(Connect|Connected) to ${provider}`, 'i') }));
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
    window.localStorage.clear();

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

  it('auto-opens reconnect modal when linked providers include one missing on this device', async () => {
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
      expect(screen.getByText('Reconnect required')).toBeInTheDocument();
      expect(screen.getByText(/Reconnect Google on this device/i)).toBeInTheDocument();
    });
  });

  it('expands the accordion for the provider that requires reconnect', async () => {
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
      expect(screen.getByRole('button', { name: /Connected to Google/i })).toHaveAttribute('aria-expanded', 'true');
    });

    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Connected to Microsoft/i })).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows reconnect modal again after remount when a linked provider is still missing', async () => {

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
      expect(screen.getByText(/Reconnect Google on this device/i)).toBeInTheDocument();
    });
    first.unmount();

    await renderAccountControl();
    await waitFor(() => {
      expect(screen.getByText(/Reconnect Google on this device/i)).toBeInTheDocument();
    });
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

    mockReadCloudConfigForSession.mockResolvedValue({
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
    });

    await renderAccountControl();

    await waitFor(() => {
      expect(mockReadCloudConfigForSession).toHaveBeenCalled();
    });

    await act(async () => {
      jest.advanceTimersByTime(1500);
    });

    await waitFor(() => {
      expect(mockWriteCloudConfigForSession).toHaveBeenCalledTimes(2);
    });

    const providersWritten = mockWriteCloudConfigForSession.mock.calls
      .map((call) => call[0].provider)
      .sort();
    expect(providersWritten).toEqual(['google', 'microsoft']);

    const writePayload = mockWriteCloudConfigForSession.mock.calls[0][1];
    const linkedProviders = writePayload.linkedAccounts
      .map((entry: { provider: string }) => entry.provider)
      .sort();

    expect(linkedProviders).toEqual(['google', 'microsoft']);
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
    mockReadCloudConfigForSession.mockResolvedValue(null);

    await renderAccountControl();

    await waitFor(() => {
      expect(mockReadCloudConfigForSession).toHaveBeenCalled();
    });

    await act(async () => {
      jest.runOnlyPendingTimers();
    });

    await waitFor(() => {
      expect(mockWriteCloudConfigForSession).toHaveBeenCalledTimes(1);
    });

    expect(mockWriteCloudConfigForSession.mock.calls[0][0].provider).toBe('microsoft');
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
    expandProvider('Google');

    const connectButton = screen.getByRole('button', { name: 'Connect' });
    expect(connectButton).toBeDisabled();

    fireEvent.click(getProviderCheckbox('google-sync-settings'));
    expect(connectButton).toBeEnabled();

    fireEvent.click(connectButton);
    expect(mockBeginAuth).toHaveBeenCalledWith('google', {
      syncSettings: true,
      syncFiles: false,
    });
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

    render(<AccountControl />);

    await waitFor(() => {
      expect(screen.getByText(/Reconnect Google on this device/i)).toBeInTheDocument();
    });

    // The reconnect flow auto-expands the affected provider's accordion.
    const syncSettingsCheckbox = getProviderCheckbox('google-sync-settings');
    const syncFilesCheckbox = getProviderCheckbox('google-sync-files');

    expect(syncSettingsCheckbox).toBeDisabled();
    expect(syncFilesCheckbox).toBeDisabled();
    expect(syncSettingsCheckbox).toHaveAttribute('title', 'Reconnect to modify');
    expect(syncFilesCheckbox).toHaveAttribute('title', 'Reconnect to modify');
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Modify' })).not.toBeInTheDocument();
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
    expandProvider('Google');
    fireEvent.click(getProviderCheckbox('google-sync-files'));
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
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
    expandProvider('Google');

    expect(screen.getByRole('button', { name: /Connected to Google/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toHaveClass('btn-danger');

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));

    expect(confirmSpy).toHaveBeenCalledWith(
      'Your synchronization data will be kept for 30 days. If you reconnect after 30 days than you may incur additional data usage to reprocess your files. Are you sure you wish to disconnect this service from file sync?'
    );

    expect(mockPersistState).not.toHaveBeenCalledWith(expect.objectContaining({
      cloudLinkedAccounts: [],
    }));

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));

    expect(mockPersistState).toHaveBeenCalledWith(expect.objectContaining({
      cloudLinkedAccounts: [],
    }));

    confirmSpy.mockRestore();
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
    expandProvider('Google');

    expect(screen.getByText('File Sync')).toBeInTheDocument();

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
    expandProvider('Google');

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
    expandProvider('Google');

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
    expandProvider('Google');

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
    expandProvider('Google');

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
    expandProvider('Google');

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
    expandProvider('Google');

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
    expandProvider('Google');

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
    expandProvider('Google');

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
    expandProvider('Google');

    await waitFor(() => {
      expect(screen.getByText('Google Drive')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Expand Google Drive'));

    await waitFor(() => {
      expect(screen.getByLabelText('Google Drive/Bible Notes Folder')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Google Drive/Bible Notes Folder'));

    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Google Drive/Bible Notes Folder')).not.toBeChecked();
    });

    const persisted = JSON.parse(window.localStorage.getItem('marginalia:provider-sync-preferences') || '{}');
    expect(persisted.google.selectedTargets).toEqual([]);
  });

  it('only shows a left-panel chevron for subfolders that themselves contain a subfolder', async () => {
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
    expandProvider('Google');

    await waitFor(() => {
      expect(screen.getByText('Google Drive')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Expand Google Drive'));

    await waitFor(() => {
      expect(screen.getByLabelText('Google Drive/HasSub')).toBeInTheDocument();
      expect(screen.getByLabelText('Google Drive/NoSub')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Expand HasSub')).toBeInTheDocument();
    });

    expect(screen.queryByLabelText('Expand NoSub')).not.toBeInTheDocument();
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
    expandProvider('Google');

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
    expandProvider('Google');

    expect(screen.getByText('File Sync')).toBeInTheDocument();

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
    expandProvider('Google');

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
    expandProvider('Microsoft');

    expect(screen.getByText('File Sync')).toBeInTheDocument();
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
    expandProvider('Microsoft');

    await waitFor(() => {
      expect(screen.getByText('OneDrive')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Expand OneDrive'));

    await waitFor(() => {
      expect(screen.getByText(/Unable to load folders: Graph unavailable/i)).toBeInTheDocument();
    });
  });
});
