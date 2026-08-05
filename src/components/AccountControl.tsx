import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { restoreState } from '../store/slices/uiSlice';
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
import './AccountControl.scss';

type SyncState = 'idle' | 'syncing' | 'error';
const THIRTY_MINUTES_MS = 30 * 60 * 1000;

const PROVIDER_LABEL: Record<FederatedProvider, string> = {
  google: 'Google',
  microsoft: 'Microsoft',
};

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
  const linkedAccountsRef = useRef<LinkedCloudAccount[]>([]);
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

  useEffect(() => {
    linkedAccountsRef.current = linkedAccounts;
  }, [linkedAccounts]);

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
      const missingOnThisDevice = linkedProviders.filter((provider) => !currentSessions[provider]);
      setMissingProviderPrompts(missingOnThisDevice);

      let newestPayload: SyncedCloudConfig | null = null;

      for (const provider of linkedProviders) {
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
  }, [applyRemoteConfig, configUpdatedAt, linkedAccounts, persistCloudState, ready]);

  const handleSessionAfterSignIn = useCallback(async (session: FederatedSession) => {
    const localSessions = await getFreshFederatedSessions();
    setSessions(localSessions);

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

    setMissingProviderPrompts(deriveMissingProviders(nextLinked));
    persistCloudState({
      cloudLinkedAccounts: nextLinked,
      cloudConfigUpdatedAt: nextConfigUpdatedAt,
    });

    // New linkage should always publish to currently signed-in providers.
    setHasPendingSync(true);
  }, [applyRemoteConfig, configUpdatedAt, persistCloudState]);

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
      setSessions(refreshedSessions);
      const refreshedMissing = Array.from(new Set(initialLinked.map((entry) => entry.provider)))
        .filter((provider) => !refreshedSessions[provider]);
      setMissingProviderPrompts(refreshedMissing);
    })();

    hasInitializedCloudStateRef.current = true;

    const bootstrap = async () => {
      const callbackResult = await completeFederatedAuthorizationFromUrl();
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
        setIsModalOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isModalOpen]);

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
    const payload = toSyncedCloudConfig(configSnapshot, linkedAccounts, configUpdatedAt);

    setSyncState('syncing');
    setStatusMessage(null);

    const failures: string[] = [];
    let successfulWrites = 0;

    for (const provider of linkedProviders) {
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
  }, [configSnapshot, configUpdatedAt, linkedAccounts, persistCloudState, ready]);

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

  const handleConnect = useCallback(async (provider: FederatedProvider) => {
    setStatusMessage(null);
    try {
      await beginFederatedAuthorization(provider);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusMessage(message);
    }
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

  const googleAccount = linkedAccounts.find((entry) => entry.provider === 'google') ?? null;
  const microsoftAccount = linkedAccounts.find((entry) => entry.provider === 'microsoft') ?? null;

  const closeModal = () => {
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
            <div className="modal-dialog modal-dialog-centered modal-lg">
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

                  {missingProviderPrompts.length > 0 && (
                    <div className="alert alert-warning mb-0" role="alert">
                      <div className="fw-semibold mb-1">Reconnect required</div>
                      <div className="small">
                        Reconnect {missingProviderPrompts.map((provider) => PROVIDER_LABEL[provider]).join(' and ')} on this device to continue background cloud sync.
                      </div>
                    </div>
                  )}


                  <section className="account-provider-stack">
                    {googleAccount ? (
                      <div className="account-provider-hero" role="group" aria-label="Google account">
                        <div className="account-provider-hero-main">
                          <span className="account-provider-hero-title">
                            <i className="fa-brands fa-google" aria-hidden="true"></i>
                            Google
                          </span>
                          <span className="account-provider-hero-subtitle text-truncate">
                            {googleAccount.email || googleAccount.displayName || googleAccount.providerAccountId}
                          </span>
                        </div>
                        <div className="d-flex align-items-center gap-2">
                          {!providerSessionByType.google && (
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              onClick={() => {
                                void handleConnect('google');
                              }}
                            >
                              Reconnect
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-secondary"
                            onClick={() => handleDetachProvider('google')}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="account-brand-btn account-brand-btn-google"
                        onClick={() => {
                          void handleConnect('google');
                        }}
                        aria-label="Sign in with Google"
                      >
                        <span className="account-brand-btn-icon" aria-hidden="true">
                          <i className="fa-brands fa-google"></i>
                        </span>
                        <span className="account-brand-btn-label">Sign in with Google</span>
                      </button>
                    )}

                    {microsoftAccount ? (
                      <div className="account-provider-hero" role="group" aria-label="Microsoft account">
                        <div className="account-provider-hero-main">
                          <span className="account-provider-hero-title">
                            <i className="fa-brands fa-microsoft" aria-hidden="true"></i>
                            Microsoft
                          </span>
                          <span className="account-provider-hero-subtitle text-truncate">
                            {microsoftAccount.email || microsoftAccount.displayName || microsoftAccount.providerAccountId}
                          </span>
                        </div>
                        <div className="d-flex align-items-center gap-2">
                          {!providerSessionByType.microsoft && (
                            <button
                              type="button"
                              className="btn btn-sm btn-primary"
                              onClick={() => {
                                void handleConnect('microsoft');
                              }}
                            >
                              Reconnect
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-secondary"
                            onClick={() => handleDetachProvider('microsoft')}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="account-brand-btn account-brand-btn-microsoft"
                        onClick={() => {
                          void handleConnect('microsoft');
                        }}
                        aria-label="Sign in with Microsoft"
                      >
                        <span className="account-brand-btn-icon" aria-hidden="true">
                          <i className="fa-brands fa-microsoft"></i>
                        </span>
                        <span className="account-brand-btn-label">Sign in with Microsoft</span>
                      </button>
                    )}
                  </section>

                  {linkedAccounts.length === 0 && (
                    <div className="alert alert-secondary mb-0" role="alert">
                      No linked accounts yet. Connect Google or Microsoft to enable cloud sync.
                    </div>
                  )}

                  {lastSyncedAt && (
                    <p className="small text-body-secondary mb-0">
                      Last synced {new Date(lastSyncedAt).toLocaleString()}.
                    </p>
                  )}

                  {syncState === 'syncing' && (
                    <p className="small text-body-secondary mb-0">
                      Syncing configuration...
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
