import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import AccountControl from './AccountControl';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { bibleService } from '../services/bibleService';
import {
  completeFederatedAuthorizationFromUrl,
  getFreshFederatedSessions,
  getStoredFederatedSessions,
} from '../services/federatedAuthService';
import {
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
  mergeLinkedAccounts: jest.requireActual('../services/cloudConfigProviderService').mergeLinkedAccounts,
  readCloudConfigForSession: jest.fn(),
  writeCloudConfigForSession: jest.fn(),
}));

const mockUseAppDispatch = useAppDispatch as unknown as jest.Mock;
const mockUseAppSelector = useAppSelector as unknown as jest.Mock;
const mockReadState = bibleService.readState as jest.Mock;
const mockPersistState = bibleService.persistState as jest.Mock;
const mockCompleteAuth = completeFederatedAuthorizationFromUrl as jest.Mock;
const mockGetStoredSessions = getStoredFederatedSessions as jest.Mock;
const mockGetFreshSessions = getFreshFederatedSessions as jest.Mock;
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

describe('AccountControl', () => {
  beforeEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();

    mockUseAppDispatch.mockReturnValue(jest.fn());
    mockUseAppSelector.mockImplementation((selector: (state: any) => any) => selector({ ui: baseUiState }));

    mockPersistState.mockImplementation((update: any) => ({
      ...mockReadState(),
      ...update,
    }));

    mockCompleteAuth.mockResolvedValue({ handled: false });
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

    render(<AccountControl />);

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

    const first = render(<AccountControl />);
    await waitFor(() => {
      expect(screen.getByText(/Reconnect Google on this device/i)).toBeInTheDocument();
    });
    first.unmount();

    render(<AccountControl />);
    await waitFor(() => {
      expect(screen.getByText(/Reconnect Google on this device/i)).toBeInTheDocument();
    });
  });

  it('pushes merged linked-account metadata to all active linked providers after second provider sign-in', async () => {
    jest.useFakeTimers();

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

    render(<AccountControl />);

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

    render(<AccountControl />);

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

    render(<AccountControl />);

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    expect(mockWriteCloudConfigForSession).not.toHaveBeenCalled();
  });
});
