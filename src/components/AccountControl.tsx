import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { restoreState, setUserId } from '../store/slices/uiSlice';
import { loadTranslation, setCurrentBibleFromId } from '../store/slices/bibleSlice';
import { bibleService } from '../services/bibleService';
import {
  beginFederatedAuthorization,
  completeFederatedAuthorizationFromUrl,
  getFreshFederatedSessions,
  getMostRecentlyGrantedSession,
  getStoredFederatedSessions,
  removeStoredFederatedSession,
  type FederatedSession,
} from '../services/federatedAuthService';
import {
  mergeLinkedAccounts,
  readCloudConfigForSession,
  writeCloudConfigForSession,
  type SyncedCloudConfig,
} from '../services/cloudConfigProviderService';
import type { FederatedProvider, LinkedCloudAccount, MarginaliaState } from '../models/bible';
import CloudFolderPicker, { type FolderSelectionTarget } from './CloudFolderPicker';
import './AccountControl.scss';

type SyncState = 'idle' | 'syncing' | 'error';
const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const PROVIDERS: FederatedProvider[] = ['google', 'microsoft'];
const DISCONNECT_FILE_SYNC_CONFIRMATION = 'Your synchronization data will be kept for 30 days. If you reconnect after 30 days than you may incur additional data usage to reprocess your files. Are you sure you wish to disconnect this service from file sync?';
const UNSAVED_FILE_SYNC_CONFIRMATION = 'You have unapplied File Sync folder changes. Discard them?';
const PROVIDER_SYNC_PREFERENCES_STORAGE_KEY = 'marginalia:provider-sync-preferences';

const PROVIDER_LABEL: Record<FederatedProvider, string> = {
  google: 'Google',
  microsoft: 'Microsoft',
};

const PROVIDER_ICON: Record<FederatedProvider, string> = {
  google: 'fa-google',
  microsoft: 'fa-microsoft',
};

interface ProviderSyncPreferences {
  syncSettings: boolean;
  syncFiles: boolean;
  selectedTargets: ProviderSyncTarget[];
}

interface ProviderSyncTarget {
  id: string;
  kind: 'folder';
  name?: string;
  path?: string;
  sizeBytes?: number;
  sizeKnown?: boolean;
  excludedItemIds?: string[];
  tags?: string[];
  itemTags?: Record<string, string[]>;
  itemTagExclusions?: Record<string, string[]>;
}

type ProviderSyncPreferenceMap = Record<FederatedProvider, ProviderSyncPreferences>;

const createDefaultProviderPreferences = (): ProviderSyncPreferenceMap => ({
  google: {
    syncSettings: false,
    syncFiles: false,
    selectedTargets: [],
  },
  microsoft: {
    syncSettings: false,
    syncFiles: false,
    selectedTargets: [],
  },
});

function isProviderSyncTarget(value: unknown): value is ProviderSyncTarget {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<ProviderSyncTarget>;
  return (
    candidate.kind === 'folder'
    && typeof candidate.id === 'string'
    && candidate.id.trim().length > 0
    && (typeof candidate.name === 'undefined' || typeof candidate.name === 'string')
    && (typeof candidate.path === 'undefined' || typeof candidate.path === 'string')
    && (typeof candidate.sizeBytes === 'undefined' || typeof candidate.sizeBytes === 'number')
    && (typeof candidate.sizeKnown === 'undefined' || typeof candidate.sizeKnown === 'boolean')
    && (typeof candidate.excludedItemIds === 'undefined' || Array.isArray(candidate.excludedItemIds))
    && (typeof candidate.tags === 'undefined' || Array.isArray(candidate.tags))
    && (typeof candidate.itemTags === 'undefined' || (typeof candidate.itemTags === 'object' && candidate.itemTags !== null))
    && (typeof candidate.itemTagExclusions === 'undefined' || (typeof candidate.itemTagExclusions === 'object' && candidate.itemTagExclusions !== null))
  );
}

function normalizeProviderSyncPreferences(value: unknown): ProviderSyncPreferences | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<ProviderSyncPreferences>;
  if (typeof candidate.syncSettings !== 'boolean' || typeof candidate.syncFiles !== 'boolean') {
    return null;
  }

  const selectedTargets = Array.isArray(candidate.selectedTargets)
    ? candidate.selectedTargets.filter((entry): entry is ProviderSyncTarget => isProviderSyncTarget(entry))
    : [];

  return {
    syncSettings: candidate.syncSettings,
    syncFiles: candidate.syncFiles,
    selectedTargets,
  };
}

function normalizeStoredProviderSyncPreferences(value: unknown): Partial<ProviderSyncPreferenceMap> {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const source = value as Partial<Record<FederatedProvider, unknown>>;
  const normalized: Partial<ProviderSyncPreferenceMap> = {};

  for (const provider of PROVIDERS) {
    const candidate = source[provider];
    const normalizedPreference = normalizeProviderSyncPreferences(candidate);
    if (!normalizedPreference) {
      continue;
    }

    normalized[provider] = normalizedPreference;
  }

  return normalized;
}

function readStoredProviderSyncPreferences(): Partial<ProviderSyncPreferenceMap> {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(PROVIDER_SYNC_PREFERENCES_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    return normalizeStoredProviderSyncPreferences(JSON.parse(raw));
  } catch {
    return {};
  }
}

function writeStoredProviderSyncPreferences(preferences: Partial<ProviderSyncPreferenceMap>): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(PROVIDER_SYNC_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
}

function mergeProviderPreferences(
  defaults: ProviderSyncPreferenceMap,
  stored: Partial<ProviderSyncPreferenceMap>
): ProviderSyncPreferenceMap {
  return {
    google: stored.google
      ? {
        syncSettings: stored.google.syncSettings,
        syncFiles: stored.google.syncFiles,
        selectedTargets: stored.google.selectedTargets,
      }
      : defaults.google,
    microsoft: stored.microsoft
      ? {
        syncSettings: stored.microsoft.syncSettings,
        syncFiles: stored.microsoft.syncFiles,
        selectedTargets: stored.microsoft.selectedTargets,
      }
      : defaults.microsoft,
  };
}

function createInitials(source: { displayName?: string; email?: string }): string {
  const raw = (source.displayName || source.email || '').trim();
  if (!raw) {
    return '';
  }

  const parts = raw.split(/\s+/).filter((entry) => entry.length > 0);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}

function normalizeLinkedAccounts(value: unknown): LinkedCloudAccount[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is LinkedCloudAccount => {
    if (!entry || typeof entry !== 'object') {
      return false;
    }

    const candidate = entry as Partial<LinkedCloudAccount>;
    return (
      (candidate.provider === 'google' || candidate.provider === 'microsoft')
      && typeof candidate.providerAccountId === 'string'
      && candidate.providerAccountId.trim().length > 0
      && typeof candidate.linkedAt === 'number'
    );
  });
}

function toSyncedCloudConfig(
  config: SyncedCloudConfig['config'],
  linkedAccounts: LinkedCloudAccount[],
  updatedAt: number
): SyncedCloudConfig {
  return {
    schemaVersion: 1,
    updatedAt,
    linkedAccounts,
    config,
  };
}

function toLinkedAccount(session: FederatedSession): LinkedCloudAccount {
  return {
    provider: session.provider,
    providerAccountId: session.profile.providerAccountId,
    email: session.profile.email,
    displayName: session.profile.displayName,
    avatarUrl: session.profile.avatarUrl,
    linkedAt: Date.now(),
  };
}

const AccountControl: React.FC = () => {
  const dispatch = useAppDispatch();

  const {
    selectedTranslationId,
    selectedTranslationIds,
    translationRecords,
    selectedBook,
    selectedChapter,
    selectedLanguages,
    sourceUrls,
    resourceHiddenTags,
    theme,
    ready,
    userId,
  } = useAppSelector((state) => state.ui);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [configUpdatedAt, setConfigUpdatedAt] = useState<number>(Date.now());
  const [hasPendingSync, setHasPendingSync] = useState(false);
  const [linkedAccounts, setLinkedAccounts] = useState<LinkedCloudAccount[]>([]);
  const [sessions, setSessions] = useState(getStoredFederatedSessions());
  const [missingProviderPrompts, setMissingProviderPrompts] = useState<FederatedProvider[]>([]);
  const [expandedProvider, setExpandedProvider] = useState<FederatedProvider | null>(null);
  const [fileSyncFocusRequest, setFileSyncFocusRequest] = useState<{ provider: FederatedProvider; requestId: number } | null>(null);
  const [highlightedSyncFilesProvider, setHighlightedSyncFilesProvider] = useState<FederatedProvider | null>(null);
  const [hasUnsavedFileSyncChanges, setHasUnsavedFileSyncChanges] = useState(false);
  const [forceSyncRequestId, setForceSyncRequestId] = useState(0);
  const [providerSyncPreferences, setProviderSyncPreferences] = useState<ProviderSyncPreferenceMap>(() => {
    const defaults = createDefaultProviderPreferences();
    const stored = readStoredProviderSyncPreferences();
    return mergeProviderPreferences(defaults, stored);
  });
  const fileSyncFocusCounterRef = useRef(0);
  const syncFilesHighlightTimeoutRef = useRef<number | null>(null);
  const linkedAccountsRef = useRef<LinkedCloudAccount[]>([]);
  const isMountedRef = useRef(false);
  const hasBootstrappedAuthRef = useRef(false);
  const hasInitializedCloudStateRef = useRef(false);
  const hasLoadedCloudSnapshotRef = useRef(false);
  const suppressNextFingerprintCommitRef = useRef(false);
  const hasUserActivitySinceReadRef = useRef(false);
  const cloudRefreshInFlightRef = useRef(false);
  const lastCloudReadAtRef = useRef(Date.now());
  const reconnectPromptSeenRef = useRef<string>('');

  const persistedConfigFingerprint = useMemo(() => {
    return JSON.stringify({
      selectedTranslationId,
      selectedTranslationIds,
      translationRecords,
      selectedBook,
      selectedChapter,
      selectedLanguages,
      sourceUrls,
      resourceHiddenTags,
      theme,
      userId,
      providerFolderSelections: {
        google: providerSyncPreferences.google.selectedTargets,
        microsoft: providerSyncPreferences.microsoft.selectedTargets,
      },
    });
  }, [
    selectedTranslationId,
    selectedTranslationIds,
    translationRecords,
    selectedBook,
    selectedChapter,
    selectedLanguages,
    sourceUrls,
    resourceHiddenTags,
    theme,
    userId,
    providerSyncPreferences,
  ]);

  const configSnapshot = useMemo<SyncedCloudConfig['config']>(() => {
    return {
      lastTranslationId: selectedTranslationId,
      lastTranslationIds: selectedTranslationIds,
      translationRecords,
      lastBook: selectedBook || undefined,
      lastChapter: selectedBook ? selectedChapter : undefined,
      languages: selectedLanguages,
      sourceUrls,
      resourceHiddenTags,
      theme,
      userId: userId ?? undefined,
      providerFolderSelections: {
        google: providerSyncPreferences.google.selectedTargets,
        microsoft: providerSyncPreferences.microsoft.selectedTargets,
      },
    };
  }, [
    selectedTranslationId,
    selectedTranslationIds,
    translationRecords,
    selectedBook,
    selectedChapter,
    selectedLanguages,
    sourceUrls,
    resourceHiddenTags,
    theme,
    userId,
    providerSyncPreferences,
  ]);

  const activeSession = useMemo(() => getMostRecentlyGrantedSession(sessions), [sessions]);

  const providerSessionByType = useMemo(() => {
    return {
      google: sessions.google ?? null,
      microsoft: sessions.microsoft ?? null,
    };
  }, [sessions]);

  const iconProfile = useMemo(() => {
    if (activeSession) {
      return {
        avatarUrl: activeSession.profile.avatarUrl,
        displayName: activeSession.profile.displayName,
        email: activeSession.profile.email,
      };
    }

    const fallbackAccount = linkedAccounts
      .slice()
      .sort((left, right) => right.linkedAt - left.linkedAt)[0];
    if (!fallbackAccount) {
      return null;
    }

    return {
      avatarUrl: fallbackAccount.avatarUrl,
      displayName: fallbackAccount.displayName,
      email: fallbackAccount.email,
    };
  }, [activeSession, linkedAccounts]);

  const avatarInitials = useMemo(() => {
    if (!iconProfile) {
      return '';
    }

    return createInitials({
      displayName: iconProfile.displayName,
      email: iconProfile.email,
    });
  }, [iconProfile]);

  const persistCloudState = useCallback((updates: Partial<MarginaliaState>) => {
    bibleService.persistState(updates);
  }, []);

  const providerAccountByType = useMemo<Record<FederatedProvider, LinkedCloudAccount | null>>(() => {
    return {
      google: linkedAccounts.find((entry) => entry.provider === 'google') ?? null,
      microsoft: linkedAccounts.find((entry) => entry.provider === 'microsoft') ?? null,
    };
  }, [linkedAccounts]);

  const isProviderConnected = useCallback((provider: FederatedProvider): boolean => {
    return Boolean(providerAccountByType[provider]);
  }, [providerAccountByType]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    linkedAccountsRef.current = linkedAccounts;
  }, [linkedAccounts]);

  useEffect(() => {
    writeStoredProviderSyncPreferences(providerSyncPreferences);
  }, [providerSyncPreferences]);

  const applyRemoteConfig = useCallback(async (payload: SyncedCloudConfig) => {
    const remote = payload.config;

    // A cloud-originated restore should not be treated as a local edit.
    suppressNextFingerprintCommitRef.current = true;

    dispatch(restoreState({
      selectedTranslationId: remote.lastTranslationId || 'KJV',
      selectedTranslationIds: remote.lastTranslationIds || [remote.lastTranslationId || 'KJV'],
      translationRecords: remote.translationRecords || [{ id: remote.lastTranslationId || 'KJV', starred: true }],
      selectedBook: remote.lastBook || null,
      selectedChapter: remote.lastChapter || 1,
      selectedLanguages: Array.isArray(remote.languages) ? remote.languages : [],
      sourceUrls: Array.isArray(remote.sourceUrls) ? remote.sourceUrls : [],
      resourceHiddenTags: Array.isArray(remote.resourceHiddenTags) ? remote.resourceHiddenTags : [],
      theme: remote.theme || 'light',
    }));

    const remoteFolderSelections = remote.providerFolderSelections;
    if (remoteFolderSelections) {
      setProviderSyncPreferences((current) => {
        const next = { ...current };
        for (const provider of PROVIDERS) {
          const remoteTargets = remoteFolderSelections[provider];
          if (!Array.isArray(remoteTargets)) {
            continue;
          }

          next[provider] = {
            ...next[provider],
            selectedTargets: remoteTargets.filter((entry): entry is ProviderSyncTarget => isProviderSyncTarget(entry)),
          };
        }

        return next;
      });
    }

    // setUserId is a no-op locally if a user ID was already established on this device.
    if (typeof remote.userId === 'string' && remote.userId.trim().length > 0) {
      dispatch(setUserId(remote.userId));
    }

    if (remote.lastTranslationId) {
      await dispatch(loadTranslation(remote.lastTranslationId));
      dispatch(setCurrentBibleFromId(remote.lastTranslationId));
    }
  }, [dispatch]);

  const refreshCloudSnapshot = useCallback(async (reason: 'startup' | 'activity') => {
    if (!ready || !hasInitializedCloudStateRef.current || cloudRefreshInFlightRef.current) {
      return;
    }

    cloudRefreshInFlightRef.current = true;

    try {
      if (linkedAccounts.length === 0) {
        lastCloudReadAtRef.current = Date.now();
        hasUserActivitySinceReadRef.current = false;
        return;
      }

      const currentSessions = await getFreshFederatedSessions();
      setSessions(currentSessions);
      const linkedProviders = Array.from(new Set(linkedAccounts.map((entry) => entry.provider)));
      const settingsProviders = linkedProviders.filter((provider) => providerSyncPreferences[provider].syncSettings);
      const missingOnThisDevice = linkedProviders.filter((provider) => !currentSessions[provider]);
      setMissingProviderPrompts(missingOnThisDevice);

      let newestPayload: SyncedCloudConfig | null = null;

      for (const provider of settingsProviders) {
        const session = currentSessions[provider];
        if (!session) {
          continue;
        }

        try {
          const payload = await readCloudConfigForSession(session);
          if (!payload) {
            continue;
          }

          if (!newestPayload || payload.updatedAt > newestPayload.updatedAt) {
            newestPayload = payload;
          }
        } catch {
          // Best effort refresh; manual reconnect/sync remains available.
        }
      }

      if (newestPayload && newestPayload.updatedAt > configUpdatedAt) {
        await applyRemoteConfig(newestPayload);
        setConfigUpdatedAt(newestPayload.updatedAt);
        persistCloudState({
          cloudConfigUpdatedAt: newestPayload.updatedAt,
          cloudLinkedAccounts: mergeLinkedAccounts(linkedAccounts, newestPayload.linkedAccounts),
        });

        if (reason === 'activity') {
          setStatusMessage('Pulled newer configuration from cloud.');
        }
      }

      lastCloudReadAtRef.current = Date.now();
      hasUserActivitySinceReadRef.current = false;
    } finally {
      cloudRefreshInFlightRef.current = false;
    }
  }, [applyRemoteConfig, configUpdatedAt, linkedAccounts, persistCloudState, providerSyncPreferences, ready]);

  const handleSessionAfterSignIn = useCallback(async (session: FederatedSession) => {
    const localSessions = await getFreshFederatedSessions();
    setSessions(localSessions);

    // The first cloud account ever connected becomes the internal User ID reference; no-op once set.
    if (session.profile.email) {
      dispatch(setUserId(session.profile.email));
    }

    const persistedState = bibleService.readState() as MarginaliaState;
    const persistedLinked = normalizeLinkedAccounts(persistedState.cloudLinkedAccounts);
    const baseLinked = mergeLinkedAccounts(linkedAccountsRef.current, persistedLinked);
    const nextLinked = mergeLinkedAccounts(baseLinked, [toLinkedAccount(session)]);
    setLinkedAccounts(nextLinked);

    let nextConfigUpdatedAt = configUpdatedAt;
    const deriveMissingProviders = (accounts: LinkedCloudAccount[]): FederatedProvider[] => {
      return Array.from(new Set(accounts.map((entry) => entry.provider)))
        .filter((provider) => !localSessions[provider]);
    };

    const shouldReadCloudConfig = providerSyncPreferences[session.provider].syncSettings;

    if (shouldReadCloudConfig) {
      try {
        const remotePayload = await readCloudConfigForSession(session);
        if (remotePayload) {
          const mergedLinked = mergeLinkedAccounts(nextLinked, remotePayload.linkedAccounts);
          setLinkedAccounts(mergedLinked);

          if (remotePayload.updatedAt > configUpdatedAt) {
            await applyRemoteConfig(remotePayload);
            nextConfigUpdatedAt = remotePayload.updatedAt;
            setConfigUpdatedAt(nextConfigUpdatedAt);
            setStatusMessage(`Pulled newer configuration from ${PROVIDER_LABEL[session.provider]}.`);
          }

          setMissingProviderPrompts(deriveMissingProviders(mergedLinked));

          persistCloudState({
            cloudLinkedAccounts: mergedLinked,
            cloudConfigUpdatedAt: nextConfigUpdatedAt,
          });

          // Always publish merged linkage to all signed-in providers after auth.
          setHasPendingSync(true);
          return;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatusMessage(`Signed in, but cloud read failed: ${message}`);
      }
    }

    setMissingProviderPrompts(deriveMissingProviders(nextLinked));
    persistCloudState({
      cloudLinkedAccounts: nextLinked,
      cloudConfigUpdatedAt: nextConfigUpdatedAt,
    });

    // New linkage should always publish to currently signed-in providers.
    setHasPendingSync(true);
  }, [applyRemoteConfig, configUpdatedAt, dispatch, persistCloudState, providerSyncPreferences]);

  useEffect(() => {
    if (hasBootstrappedAuthRef.current) {
      return;
    }
    hasBootstrappedAuthRef.current = true;

    const saved = bibleService.readState() as MarginaliaState;
    const initialLinked = normalizeLinkedAccounts(saved.cloudLinkedAccounts);
    setLinkedAccounts(initialLinked);
    setConfigUpdatedAt(typeof saved.cloudConfigUpdatedAt === 'number' ? saved.cloudConfigUpdatedAt : Date.now());
    setLastSyncedAt(typeof saved.cloudConfigLastSyncedAt === 'number' ? saved.cloudConfigLastSyncedAt : null);
    lastCloudReadAtRef.current = typeof saved.cloudConfigLastSyncedAt === 'number'
      ? saved.cloudConfigLastSyncedAt
      : Date.now();
    const currentSessions = getStoredFederatedSessions();
    setSessions(currentSessions);
    const missingOnThisDevice = Array.from(new Set(initialLinked.map((entry) => entry.provider)))
      .filter((provider) => !currentSessions[provider]);
    setMissingProviderPrompts(missingOnThisDevice);

    void (async () => {
      const refreshedSessions = await getFreshFederatedSessions();
      if (!isMountedRef.current) {
        return;
      }

      setSessions(refreshedSessions);
      const refreshedMissing = Array.from(new Set(initialLinked.map((entry) => entry.provider)))
        .filter((provider) => !refreshedSessions[provider]);
      setMissingProviderPrompts(refreshedMissing);
    })();

    hasInitializedCloudStateRef.current = true;

    const bootstrap = async () => {
      const callbackResult = await completeFederatedAuthorizationFromUrl();
      if (!isMountedRef.current) {
        return;
      }

      if (!callbackResult.handled) {
        return;
      }

      if (callbackResult.error) {
        setStatusMessage(`Sign-in failed: ${callbackResult.error}`);
        return;
      }

      if (callbackResult.session) {
        await handleSessionAfterSignIn(callbackResult.session);
      }
    };

    void bootstrap();
  }, [handleSessionAfterSignIn]);

  useEffect(() => {
    if (!isModalOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (hasUnsavedFileSyncChanges && !window.confirm(UNSAVED_FILE_SYNC_CONFIRMATION)) {
          return;
        }

        setHasUnsavedFileSyncChanges(false);
        setIsModalOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isModalOpen, hasUnsavedFileSyncChanges]);

  useEffect(() => {
    if (!isModalOpen || !hasUnsavedFileSyncChanges) {
      return;
    }

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [isModalOpen, hasUnsavedFileSyncChanges]);

  useEffect(() => {
    if (missingProviderPrompts.length === 0) {
      reconnectPromptSeenRef.current = '';
      return;
    }

    const reconnectKey = missingProviderPrompts.slice().sort().join('|');
    if (reconnectPromptSeenRef.current === reconnectKey) {
      return;
    }

    reconnectPromptSeenRef.current = reconnectKey;
    setIsModalOpen(true);
    // Only one accordion can be open, so surface the first provider needing reconnect.
    setExpandedProvider(missingProviderPrompts[0]);
    setStatusMessage('Reconnect required on this device to resume cloud synchronization.');
  }, [missingProviderPrompts]);

  const lastFingerprintRef = useRef<string>('');
  useEffect(() => {
    if (!ready) {
      return;
    }

    if (!hasInitializedCloudStateRef.current) {
      return;
    }

    // Baseline capture: this is not a modification.
    if (lastFingerprintRef.current.length === 0) {
      lastFingerprintRef.current = persistedConfigFingerprint;
      return;
    }

    // Cloud hydrate should update baseline only, not schedule upload.
    if (suppressNextFingerprintCommitRef.current) {
      lastFingerprintRef.current = persistedConfigFingerprint;
      suppressNextFingerprintCommitRef.current = false;
      return;
    }

    if (lastFingerprintRef.current === persistedConfigFingerprint) {
      return;
    }

    lastFingerprintRef.current = persistedConfigFingerprint;
    const nextUpdated = Date.now();
    setConfigUpdatedAt(nextUpdated);
    persistCloudState({ cloudConfigUpdatedAt: nextUpdated });
    setHasPendingSync(true);
  }, [ready, persistedConfigFingerprint, persistCloudState]);

  useEffect(() => {
    if (!ready || !hasInitializedCloudStateRef.current || hasLoadedCloudSnapshotRef.current) {
      return;
    }

    hasLoadedCloudSnapshotRef.current = true;
    void refreshCloudSnapshot('startup');
  }, [ready, refreshCloudSnapshot]);

  useEffect(() => {
    if (!ready || !hasInitializedCloudStateRef.current) {
      return;
    }

    const isEligibleForActivityRefresh = (): boolean => {
      if (document.visibilityState !== 'visible') {
        return false;
      }

      if (!hasUserActivitySinceReadRef.current) {
        return false;
      }

      return Date.now() - lastCloudReadAtRef.current >= THIRTY_MINUTES_MS;
    };

    const maybeRefreshFromActivity = () => {
      if (!isEligibleForActivityRefresh()) {
        return;
      }

      void refreshCloudSnapshot('activity');
    };

    const markActive = () => {
      hasUserActivitySinceReadRef.current = true;
      maybeRefreshFromActivity();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        maybeRefreshFromActivity();
      }
    };

    const onFocus = () => {
      hasUserActivitySinceReadRef.current = true;
      maybeRefreshFromActivity();
    };

    const activityEvents: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'scroll'];
    for (const eventName of activityEvents) {
      window.addEventListener(eventName, markActive, { passive: true });
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);

    return () => {
      for (const eventName of activityEvents) {
        window.removeEventListener(eventName, markActive);
      }
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
    };
  }, [ready, refreshCloudSnapshot]);

  const syncNow = useCallback(async () => {
    if (!ready || linkedAccounts.length === 0) {
      return;
    }

    const currentSessions = await getFreshFederatedSessions();
    setSessions(currentSessions);

    const linkedProviders = Array.from(new Set(linkedAccounts.map((entry) => entry.provider)));
    const settingsProviders = linkedProviders.filter((provider) => providerSyncPreferences[provider].syncSettings);
    const payload = toSyncedCloudConfig(configSnapshot, linkedAccounts, configUpdatedAt);

    setSyncState('syncing');
    setStatusMessage(null);

    const failures: string[] = [];
    let successfulWrites = 0;

    for (const provider of settingsProviders) {
      const session = currentSessions[provider];
      if (!session) {
        failures.push(`${PROVIDER_LABEL[provider]} not signed in on this device`);
        continue;
      }

      try {
        await writeCloudConfigForSession(session, payload);
        successfulWrites += 1;
      } catch (writeError) {
        const message = writeError instanceof Error ? writeError.message : String(writeError);
        failures.push(`${PROVIDER_LABEL[provider]}: ${message}`);
      }
    }

    if (successfulWrites > 0) {
      const syncedAt = Date.now();
      setLastSyncedAt(syncedAt);
      persistCloudState({
        cloudLinkedAccounts: linkedAccounts,
        cloudConfigUpdatedAt: configUpdatedAt,
        cloudConfigLastSyncedAt: syncedAt,
      });
    }

    if (failures.length > 0) {
      setSyncState('error');
      setStatusMessage(`Sync issues: ${failures.join(' | ')}`);
      setHasPendingSync(false);
      return;
    }

    setSyncState('idle');
    setStatusMessage(successfulWrites > 0 ? 'Configuration synced.' : null);
    setHasPendingSync(false);
  }, [configSnapshot, configUpdatedAt, linkedAccounts, persistCloudState, providerSyncPreferences, ready]);

  useEffect(() => {
    if (!ready || linkedAccounts.length === 0 || !hasPendingSync) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void syncNow();
    }, 1200);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [configUpdatedAt, hasPendingSync, linkedAccounts.length, ready, syncNow]);

  useEffect(() => {
    if (forceSyncRequestId === 0) {
      return;
    }

    void syncNow();
  }, [forceSyncRequestId, syncNow]);

  const handleConnect = useCallback(async (provider: FederatedProvider, preferences: ProviderSyncPreferences) => {
    setStatusMessage(null);
    try {
      await beginFederatedAuthorization(provider, {
        syncSettings: preferences.syncSettings,
        syncFiles: preferences.syncFiles,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusMessage(message);
    }
  }, []);

  const focusFileSyncService = useCallback((provider: FederatedProvider) => {
    setExpandedProvider(provider);
    fileSyncFocusCounterRef.current += 1;
    const requestId = fileSyncFocusCounterRef.current;
    setFileSyncFocusRequest({ provider, requestId });

    setHighlightedSyncFilesProvider(null);
    if (syncFilesHighlightTimeoutRef.current !== null) {
      window.clearTimeout(syncFilesHighlightTimeoutRef.current);
    }

    syncFilesHighlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightedSyncFilesProvider(provider);
      syncFilesHighlightTimeoutRef.current = window.setTimeout(() => {
        setHighlightedSyncFilesProvider((current) => current === provider ? null : current);
      }, 3000);
    }, 0);
  }, []);

  const handleDetachProvider = useCallback((provider: FederatedProvider) => {
    const nextLinked = linkedAccounts.filter((entry) => entry.provider !== provider);
    setLinkedAccounts(nextLinked);

    const nextSessions = removeStoredFederatedSession(provider);
    setSessions(nextSessions);

    persistCloudState({
      cloudLinkedAccounts: nextLinked,
      cloudConfigUpdatedAt: configUpdatedAt,
      cloudConfigLastSyncedAt: lastSyncedAt ?? undefined,
    });

    if (nextLinked.length > 0) {
      setHasPendingSync(true);
    }

    setStatusMessage(`${PROVIDER_LABEL[provider]} account detached. Configuration now syncs only to remaining linked providers.`);
  }, [configUpdatedAt, lastSyncedAt, linkedAccounts, persistCloudState]);

  const handleSyncPreferenceToggle = useCallback((provider: FederatedProvider, field: 'syncSettings' | 'syncFiles') => {
    setProviderSyncPreferences((current) => ({
      ...current,
      [provider]: {
        ...current[provider],
        [field]: !current[provider][field],
      },
    }));
  }, []);

  const handleModifyFilesAccess = useCallback((provider: FederatedProvider) => {
    const session = providerSessionByType[provider];
    if (!session) {
      setStatusMessage(`Reconnect ${PROVIDER_LABEL[provider]} on this device before modifying file access.`);
      return;
    }

    setStatusMessage(null);
    focusFileSyncService(provider);
  }, [focusFileSyncService, providerSessionByType]);

  const handleApplyFolderSelections = useCallback((nextSelections: Record<FederatedProvider, FolderSelectionTarget[]>) => {
    setProviderSyncPreferences((current) => ({
      ...current,
      google: {
        ...current.google,
        selectedTargets: nextSelections.google.map((target) => ({
          id: target.id,
          kind: 'folder',
          name: target.name,
          path: target.path,
          sizeBytes: target.sizeBytes,
          sizeKnown: target.sizeKnown,
          excludedItemIds: target.excludedItemIds,
          tags: target.tags,
          itemTags: target.itemTags,
          itemTagExclusions: target.itemTagExclusions,
        })),
      },
      microsoft: {
        ...current.microsoft,
        selectedTargets: nextSelections.microsoft.map((target) => ({
          id: target.id,
          kind: 'folder',
          name: target.name,
          path: target.path,
          sizeBytes: target.sizeBytes,
          sizeKnown: target.sizeKnown,
          excludedItemIds: target.excludedItemIds,
          tags: target.tags,
          itemTags: target.itemTags,
          itemTagExclusions: target.itemTagExclusions,
        })),
      },
    }));

    // Push the updated folder selections to the cloud right away instead of waiting on the debounced autosync.
    setConfigUpdatedAt(Date.now());
    setForceSyncRequestId((current) => current + 1);
  }, []);

  const handleProviderAction = useCallback((provider: FederatedProvider) => {
    const connected = isProviderConnected(provider);
    const providerSession = providerSessionByType[provider];
    const selected = providerSyncPreferences[provider];                                                                                                                                                                     

    if (!connected) {
      if (!selected.syncSettings && !selected.syncFiles) {
        return;
      }

      void handleConnect(provider, selected);
      return;
    }

    if (!providerSession) {
      void handleConnect(provider, selected);
      return;
    }

    if (selected.syncFiles) {
      const confirmed = window.confirm(DISCONNECT_FILE_SYNC_CONFIRMATION);
      if (!confirmed) {
        return;
      }
    }

    handleDetachProvider(provider);
  }, [handleConnect, handleDetachProvider, isProviderConnected, providerSessionByType, providerSyncPreferences]);

  const handleConnectRequestedFromPicker = useCallback((provider: FederatedProvider) => {
    focusFileSyncService(provider);

    const session = providerSessionByType[provider];
    if (!session) {
      void handleProviderAction(provider);
      return;
    }

    setProviderSyncPreferences((current) => {
      if (current[provider].syncFiles) {
        return current;
      }

      return {
        ...current,
        [provider]: {
          ...current[provider],
          syncFiles: true,
        },
      };
    });
  }, [focusFileSyncService, handleProviderAction, providerSessionByType]);

  const closeModal = () => {
    if (hasUnsavedFileSyncChanges && !window.confirm(UNSAVED_FILE_SYNC_CONFIRMATION)) {
      return;
    }

    setHasUnsavedFileSyncChanges(false);
    setIsModalOpen(false);
  };

  return (
    <div className="account-control">
      <button
        type="button"
        className="btn btn-outline-secondary rounded-circle d-inline-flex align-items-center justify-content-center account-trigger"
        aria-label="Open account controls"
        onClick={() => setIsModalOpen(true)}
      >
        {iconProfile?.avatarUrl ? (
          <img
            src={iconProfile.avatarUrl}
            alt=""
            className="account-avatar-image"
          />
        ) : avatarInitials ? (
          <span className="account-avatar-initials" aria-hidden="true">{avatarInitials}</span>
        ) : (
          <i className="fa-solid fa-circle-user" aria-hidden="true"></i>
        )}
      </button>

      {isModalOpen && (
        <>
          <div
            className="modal-backdrop fade show account-modal-backdrop"
            onClick={closeModal}
          />
          <div className="modal fade show d-block account-modal" tabIndex={-1} aria-modal="true" role="dialog">
            <div className="modal-dialog modal-dialog-centered modal-lg account-modal-dialog">
              <div className="modal-content shadow border-0">
                <div className="modal-header">
                  <div className="d-flex align-items-center gap-2">
                    <i className="fa-solid fa-cloud" aria-hidden="true"></i>
                    <h2 className="modal-title h5 mb-0">Account Sync</h2>
                  </div>
                  <button
                    type="button"
                    className="btn-close"
                    aria-label="Close"
                    onClick={closeModal}
                  ></button>
                </div>

                <div className="modal-body d-flex flex-column gap-3">

                  {linkedAccounts.length === 0 && (
                    <div className="alert alert-secondary mb-0" role="alert">
                      No linked accounts yet. Connect Google or Microsoft to enable cloud sync.
                    </div>
                  )}

                  {missingProviderPrompts.length > 0 && (
                    <div className="alert alert-warning mb-0" role="alert">
                      <div className="fw-semibold mb-1">Reconnect required</div>
                      <div className="small">
                        Reconnect {missingProviderPrompts.map((provider) => PROVIDER_LABEL[provider]).join(' and ')} on this device to continue background cloud sync.
                      </div>
                    </div>
                  )}

                  <section className="account-provider-stack">
                    {PROVIDERS.map((provider) => {
                      const connected = isProviderConnected(provider);
                      const providerSession = providerSessionByType[provider];
                      const providerAccount = providerAccountByType[provider];
                      const providerPreferences = providerSyncPreferences[provider];
                      const canConnect = providerPreferences.syncSettings || providerPreferences.syncFiles;
                      const isExpanded = expandedProvider === provider;

                      let actionLabel = 'Connect';
                      if (connected) {
                        actionLabel = providerSession ? 'Disconnect' : 'Reconnect';
                      }

                      const headerPrefix = connected ? 'Connected to' : 'Connect to';

                      return (
                        <article
                          key={provider}
                          className="account-provider-accordion"
                          aria-label={`${PROVIDER_LABEL[provider]} sync options`}
                        >
                          <button
                            type="button"
                            className="account-provider-accordion-toggle"
                            aria-expanded={isExpanded}
                            aria-controls={`provider-panel-${provider}`}
                            onClick={() => {
                              setExpandedProvider((current) => current === provider ? null : provider);
                            }}
                          >
                            <span className="account-provider-accordion-toggle-label">
                              <i className={`fa-brands ${PROVIDER_ICON[provider]}`} aria-hidden="true"></i>
                              {headerPrefix} {PROVIDER_LABEL[provider]}
                              {connected && providerAccount && (
                                <span className="account-provider-header-subtitle text-truncate">
                                  {providerAccount.email || providerAccount.displayName || providerAccount.providerAccountId}
                                </span>
                              )}

                              {connected && (
                                <i className="fa-regular fa-circle-check account-provider-connected-icon" aria-hidden="true"></i>
                              )}
                            </span>
                            <i
                              className={`fa-solid ${isExpanded ? 'fa-chevron-up' : 'fa-chevron-down'} account-provider-accordion-chevron`}
                              aria-hidden="true"
                            ></i>
                          </button>

                          {isExpanded && (
                            <div id={`provider-panel-${provider}`} className="account-provider-accordion-panel">
                              <label className="account-provider-option" htmlFor={`${provider}-sync-settings`}>
                                <input
                                  id={`${provider}-sync-settings`}
                                  type="checkbox"
                                  checked={providerPreferences.syncSettings}
                                  disabled={connected}
                                  title={connected ? 'Reconnect to modify' : undefined}
                                  onChange={() => handleSyncPreferenceToggle(provider, 'syncSettings')}
                                />
                                <span className="account-provider-option-content">
                                  <span className="account-provider-option-title">Sync my settings</span>
                                  <span className="account-provider-option-description">
                                    Stores your Marginalia settings in {provider === 'google' ? 'Google Drive' : 'OneDrive'}. We'll only access a tiny file in your {provider === 'google' ? 'Drive' : 'OneDrive'}.
                                  </span>
                                </span>
                              </label>

                              <div className="account-provider-option account-provider-option-files">
                                <input
                                  id={`${provider}-sync-files`}
                                  type="checkbox"
                                  checked={providerPreferences.syncFiles}
                                  disabled={connected}
                                  title={connected ? 'Reconnect to modify' : undefined}
                                  onChange={() => handleSyncPreferenceToggle(provider, 'syncFiles')}
                                />
                                <label className={`account-provider-option-content${highlightedSyncFilesProvider === provider ? ' is-highlighted' : ''}`} htmlFor={`${provider}-sync-files`}>
                                  <span className="account-provider-option-title">
                                    Sync my files
                                    {connected && providerSession && providerPreferences.syncFiles && (
                                      <button
                                        type="button"
                                        className="btn btn-link btn-sm account-provider-modify-link"
                                        onClick={(event) => {
                                          event.preventDefault();
                                          event.stopPropagation();
                                          handleModifyFilesAccess(provider);
                                        }}
                                      >
                                        Modify
                                      </button>
                                    )}
                                  </span>
                                  <span className="account-provider-option-description">
                                    Access your own Bible notes accessible directly in Marginalia, indexed by verse! 
                                    You pick which files & folders we have access to in your {provider === 'google' ? 'Google Drive' : 'OneDrive'}. We'll only read those files.
                                  </span>
                                </label>
                              </div>

                              <div className="d-flex flex-column flex-md-row justify-content-md-center">
                                <button
                                  type="button"
                                  className={`btn px-5 ${actionLabel === 'Disconnect' ? 'btn-danger' : 'btn-primary'} account-provider-connect-btn`}
                                  disabled={!connected && !canConnect}
                                  onClick={() => {
                                    handleProviderAction(provider);
                                  }}
                                >
                                  {actionLabel}
                                </button>
                              </div>
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </section>

                  <CloudFolderPicker
                    sessions={providerSessionByType}
                    initialSelections={{
                      google: providerSyncPreferences.google.selectedTargets,
                      microsoft: providerSyncPreferences.microsoft.selectedTargets,
                    }}
                    providerSyncFilesEnabled={{
                      google: providerSyncPreferences.google.syncFiles,
                      microsoft: providerSyncPreferences.microsoft.syncFiles,
                    }}
                    focusRequest={fileSyncFocusRequest}
                    onSelectionsChange={handleApplyFolderSelections}
                    onConnectRequested={handleConnectRequestedFromPicker}
                    onDirtyChange={setHasUnsavedFileSyncChanges}
                  />


                  {(lastSyncedAt || syncState === 'syncing') && (
                    <p className="small text-body-secondary mb-0 d-flex align-items-center gap-2">
                      <i
                        className="fa-solid fa-circle-notch fa-spin account-sync-spinner"
                        style={{ visibility: syncState === 'syncing' ? 'visible' : 'hidden' }}
                        aria-hidden="true"
                      ></i>
                      <span>
                        {lastSyncedAt
                          ? `Last synced ${new Date(lastSyncedAt).toLocaleString()}.`
                          : 'Syncing configuration...'}
                      </span>
                    </p>
                  )}

                  {statusMessage && (
                    <p className="small mb-0 account-status-message">{statusMessage}</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default AccountControl;
