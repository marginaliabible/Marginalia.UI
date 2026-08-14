import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  readFolderSizeForSession,
  readFolderRootSizeForSession,
  readCloudConfigForSession,
  writeCloudConfigForSession,
} from '../services/cloudConfigProviderService';

jest.mock('../store/hooks', () => ({
  useAppDispatch: jest.fn(),
  useAppSelector: jest.fn(),
}));

jest.mock('../store/slices/bibleSlice', () => ({
  loadTranslation: jest.fn((translationId: string) => ({ type: 'bible/loadTranslation', payload: translationId })),
  setCurrentBibleFromId: jest.fn((translationId: string) => ({ type: 'bible/setCurrentBibleFromId', payload: translationId })),
}));

jest.mock('../store/slices/uiSlice', () => ({
  restoreState: jest.fn((payload: unknown) => ({ type: 'ui/restoreState', payload })),
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
  writeStoredSessions: jest.fn(),
}));

jest.mock('../services/cloudConfigProviderService', () => ({
  listFolderChildrenForSession: jest.fn(),
  mergeLinkedAccounts: jest.requireActual('../services/cloudConfigProviderService').mergeLinkedAccounts,
  readFolderSizeForSession: jest.fn(),
  readFolderRootSizeForSession: jest.fn(),
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
const mockReadFolderSizeForSession = readFolderSizeForSession as jest.Mock;
const mockReadFolderRootSizeForSession = readFolderRootSizeForSession as jest.Mock;
const mockReadCloudConfigForSession = readCloudConfigForSession as jest.Mock;
const mockWriteCloudConfigForSession = writeCloudConfigForSession as jest.Mock;

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

function openAccountModal() {
  fireEvent.click(screen.getByRole('button', { name: /open account controls/i }));
}

function expandProvider(provider: 'Google' | 'Microsoft') {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`(Connect|Connected) to ${provider}`, 'i') }));
}

function getProviderCheckbox(id: 'google-sync-settings' | 'google-sync-files' | 'microsoft-sync-settings' | 'microsoft-sync-files') {
  return document.getElementById(id) as HTMLInputElement;
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
    mockReadFolderRootSizeForSession.mockResolvedValue(0);
    mockReadCloudConfigForSession.mockResolvedValue(null);
    mockWriteCloudConfigForSession.mockResolvedValue(undefined);
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

    mockReadFolderSizeForSession.mockResolvedValue(0);
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

    expandProvider('Google');

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
      syncSettings: false,
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
        syncSettings: false,
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
    mockReadFolderRootSizeForSession.mockResolvedValue(0);
    mockReadFolderSizeForSession.mockResolvedValue(24 * 1024 * 1024);
    mockListFolderChildrenForSession.mockResolvedValue([
      {
        id: 'g-folder-1',
        name: 'Bible Notes Folder',
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
        },
      ]);
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
        syncSettings: false,
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
    mockReadFolderRootSizeForSession.mockResolvedValue(0);
    mockReadFolderSizeForSession.mockResolvedValue(24 * 1024 * 1024);
    mockListFolderChildrenForSession.mockResolvedValue([
      {
        id: 'g-folder-1',
        name: 'Bible Notes Folder',
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
        syncSettings: false,
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
    mockReadFolderRootSizeForSession.mockResolvedValue(0);
    mockReadFolderSizeForSession.mockResolvedValue(4096);

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
        syncSettings: false,
        syncFiles: true,
        selectedTargets: [],
      },
    }));

    mockGetStoredSessions.mockReturnValue({ microsoft: msSession });
    mockGetFreshSessions.mockResolvedValue({ microsoft: msSession });
    mockReadFolderRootSizeForSession.mockResolvedValue(0);

    await renderAccountControl();
    openAccountModal();
    expandProvider('Microsoft');

    expect(screen.getByText('File Sync')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('OneDrive')).toBeInTheDocument();
      expect(screen.getByText('Google Drive')).toBeInTheDocument();
    });
  });

  it('shows a helpful message when root loading fails', async () => {
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
        syncSettings: false,
        syncFiles: true,
        selectedTargets: [],
      },
    }));

    mockGetStoredSessions.mockReturnValue({ microsoft: msSession });
    mockGetFreshSessions.mockResolvedValue({ microsoft: msSession });
    mockReadFolderRootSizeForSession.mockRejectedValue(new Error('Graph unavailable'));

    await renderAccountControl();
    openAccountModal();
    expandProvider('Microsoft');

    await waitFor(() => {
      expect(screen.getByText('File Sync')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText(/Unable to initialize folder picker: Graph unavailable/i)).toBeInTheDocument();
    });
  });
});
