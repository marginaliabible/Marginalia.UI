import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { addSourceUrl, removeSourceUrl, replaceUserId, restoreState, setUserId } from '../store/slices/uiSlice';
import { loadTranslation, setCurrentBibleFromId } from '../store/slices/bibleSlice';
import { bibleService } from '../services/bibleService';
import {
  beginFederatedAuthorization,
  completeFederatedAuthorizationFromUrl,
  getFreshFederatedSessions,
  getMostRecentlyGrantedSession,
  getStoredFederatedSessions,
  rekeyStoredRefreshTokens,
  removeStoredFederatedSession,
  revokeStoredRefreshToken,
  type FederatedSession,
} from '../services/federatedAuthService';
import {
  mergeLinkedAccounts,
  readCloudConfigForSession,
  writeCloudConfigForSession,
  type SyncedCloudConfig,
} from '../services/cloudConfigProviderService';
import {
  SYNCED_CONFIG_FIELDS,
  createFieldStamps,
  entryMergedFingerprint,
  fieldFingerprints,
  folderSelectionChanged,
  maxFieldStamp,
  mergeSyncedCloudConfigs,
  nextStamp,
  normalizeFieldStamps,
  readConfigOwner,
  removedFolderIds,
  stableStringify,
  syncedConfigsEqual,
  type SyncedConfigField,
  type SyncedFieldStamps,
} from '../services/cloudConfigMerge';
import { queueCloudFolderSelection, reportSyncActivity, type CloudSyncStatus } from '../services/cloudControlService';
import { useCloudSyncStatus } from '../hooks/useCloudSyncStatus';
import { useResourceTagColorEntries } from '../hooks/useResourceTagColors';
import { mergeIntoResourceTagColors, normalizeResourceTagColors } from '../utils/resourceTagColors';
import { showToast } from '../services/toastService';
import { formatProviderList, formatSyncCompleteToast, type FolderApplyResult } from '../utils/syncToastMessages';
import {
  publishFileSyncExclusionSnapshot,
  registerFileSyncExclusionToggleHandler,
  toggleItemExclusion,
} from '../services/fileSyncExclusionService';
import {
  clearStorageSession,
  establishStorageSession,
  setStorageSessionUserId,
} from '../services/storageAuthenticatedFetch';
import type { FederatedProvider, LinkedCloudAccount, MarginaliaState } from '../models/bible';
import type { SubscriptionsBinding } from '../models/subscription';
import CloudFolderPicker, {
  type CloudFolderPickerHandle,
  type CloudFolderPickerUsageSnapshot,
  type FolderSelectionTarget,
} from './CloudFolderPicker';
import ProviderConnectModal, { type ProviderConnectMode, type ProviderSyncDraft } from './ProviderConnectModal';
import SyncPlanUsageBar from './SyncPlanUsageBar';
import SyncPlanPaymentSimModal, { type PaymentSimResult } from './SyncPlanPaymentSimModal';
import { loadSyncPlanLedger } from '../services/publicanService';
import {
  defaultActivePlan,
  requiredPlanForBytes,
  type SyncStoragePlan,
} from '../utils/syncStoragePlans';
import { computeSyncPlanUsage, type PublicanCommittedEntry, type SyncPlanDocumentRef } from '../utils/syncPlanUsage';
import {
  isOwnLibraryUrl,
  ownLibraryUrlFor,
  normalizeDisabledSourceItems,
  normalizeResourceTagOverrides,
  normalizeTimestampMap,
} from '../utils/sourceSubscriptions';
import './AccountControl.scss';


type SyncState = 'idle' | 'syncing' | 'error';
const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const SYNC_ACTIVITY_THROTTLE_MS = 5 * 60 * 1000;
const SYNC_ACTIVITY_FORCE_GAP_MS = 60 * 60 * 1000;
const PROVIDERS: FederatedProvider[] = ['google', 'microsoft'];
const DISCONNECT_FILE_SYNC_CONFIRMATION = 'Your synchronization data will be kept for 10 days. If you reconnect after 10 days then you may incur additional data usage to reprocess your files. Are you sure you wish to disconnect this service from file sync?';
const UNSAVED_FILE_SYNC_CONFIRMATION = 'You have unapplied File Sync changes. Discard them?';
const PROVIDER_SYNC_PREFERENCES_STORAGE_KEY = 'marginalia:provider-sync-preferences';

const PROVIDER_LABEL: Record<FederatedProvider, string> = {
  google: 'Google',
  microsoft: 'Microsoft',
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
  driveId?: string;
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
    && (typeof candidate.driveId === 'undefined' || typeof candidate.driveId === 'string')
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

/**
 * The config exactly as this device will hold it after applying `remote` (same defaults as
 * restoreState). Comparing through this view keeps fields a cloud copy omits from looking changed
 * on every sync.
 */
function toLocalConfigView(
  remote: SyncedCloudConfig['config'],
  currentFolders: Record<FederatedProvider, ProviderSyncTarget[]>
): SyncedCloudConfig['config'] {
  const lastTranslationId = remote.lastTranslationId || 'KJV';
  const lastBook = remote.lastBook || undefined;
  const folders = {} as Record<FederatedProvider, ProviderSyncTarget[]>;
  for (const provider of PROVIDERS) {
    const remoteTargets = remote.providerFolderSelections?.[provider];
    folders[provider] = Array.isArray(remoteTargets)
      ? remoteTargets.filter((entry): entry is ProviderSyncTarget => isProviderSyncTarget(entry))
      : currentFolders[provider];
  }

  return {
    lastTranslationId,
    lastTranslationIds: remote.lastTranslationIds || [lastTranslationId],
    translationRecords: remote.translationRecords || [{ id: lastTranslationId, starred: true }],
    lastBook,
    lastChapter: lastBook ? remote.lastChapter || 1 : undefined,
    languages: Array.isArray(remote.languages) ? remote.languages : [],
    sourceUrls: Array.isArray(remote.sourceUrls) ? remote.sourceUrls : [],
    sourceUrlAddedAt: normalizeTimestampMap(remote.sourceUrlAddedAt),
    sourceUrlTombstones: normalizeTimestampMap(remote.sourceUrlTombstones),
    disabledSourceItems: normalizeDisabledSourceItems(remote.disabledSourceItems),
    resourceTagOverrides: normalizeResourceTagOverrides(remote.resourceTagOverrides),
    resourceHiddenTags: Array.isArray(remote.resourceHiddenTags) ? remote.resourceHiddenTags : [],
    theme: remote.theme || 'light',
    translatorItalics: typeof remote.translatorItalics === 'boolean' ? remote.translatorItalics : true,
    translatorParagraphMarks: typeof remote.translatorParagraphMarks === 'boolean'
      ? remote.translatorParagraphMarks
      : true,
    userId: remote.userId,
    providerFolderSelections: folders,
    resourceTagColors: normalizeResourceTagColors(remote.resourceTagColors),
  };
}

function localConfigDiffers(local: SyncedCloudConfig['config'], next: SyncedCloudConfig['config']): boolean {
  const localPrints = fieldFingerprints(local);
  const nextPrints = fieldFingerprints(next);
  // Replacing an established user ID goes through adoptEstablishedUserId, so only an empty one is filled in here.
  const userIdDiffers = !String(local.userId ?? '').trim() && Boolean(String(next.userId ?? '').trim());
  return userIdDiffers
    || SYNCED_CONFIG_FIELDS.some((field) => field !== 'userId' && localPrints[field] !== nextPrints[field])
    || entryMergedFingerprint(local) !== entryMergedFingerprint(next);
}

interface ReconcileResult {
  merged: SyncedCloudConfig;
  localChanged: boolean;
  readCount: number;
  writeCount: number;
  failures: string[];
  libraryUrls: string[];
  queuedProviders: FederatedProvider[];
}

const SYNC_WATCH_TIMEOUT_MS = 45 * 60 * 1000;

/** Follows providers queued by an Account Sync Apply until CloudControlService reports them synced. */
interface SyncWatch {
  pending: FederatedProvider[];
  finished: FederatedProvider[];
  /** Pending providers seen queued or syncing since the watch started. */
  activeSeen: FederatedProvider[];
  failedCount: number;
  since: number;
  afterFetchId: number;
}

function startOrExtendSyncWatch(
  current: SyncWatch | null,
  providers: FederatedProvider[],
  now: number,
  afterFetchId: number
): SyncWatch {
  const requeued = new Set(providers);
  return {
    pending: Array.from(new Set([...(current?.pending ?? []), ...providers])),
    finished: (current?.finished ?? []).filter((provider) => !requeued.has(provider)),
    activeSeen: (current?.activeSeen ?? []).filter((provider) => !requeued.has(provider)),
    failedCount: current?.failedCount ?? 0,
    since: now,
    afterFetchId,
  };
}

/**
 * A provider is done once it is idle after being seen queued/syncing, or idle with a completion
 * newer than the watch (covers syncs that start and finish between polls). Providers needing
 * attention, or missing from the status, are dropped.
 */
function advanceSyncWatch(watch: SyncWatch, status: CloudSyncStatus): SyncWatch {
  const pending: FederatedProvider[] = [];
  const finished = [...watch.finished];
  const activeSeen = new Set(watch.activeSeen);
  let failedCount = watch.failedCount;

  for (const provider of watch.pending) {
    const providerStatus = status.providers[provider];
    if (!providerStatus || providerStatus.state === 'attention') {
      continue;
    }
    if (providerStatus.state === 'queued' || providerStatus.state === 'syncing') {
      activeSeen.add(provider);
      pending.push(provider);
      continue;
    }

    const completedAt = Date.parse(providerStatus.lastCompletedAt ?? '');
    if (activeSeen.has(provider) || (Number.isFinite(completedAt) && completedAt > watch.since)) {
      finished.push(provider);
      failedCount += providerStatus.failedCount ?? 0;
    } else {
      pending.push(provider);
    }
  }

  return {
    ...watch,
    pending,
    finished,
    activeSeen: Array.from(activeSeen).filter((provider) => pending.includes(provider)),
    failedCount,
  };
}

interface CloudSyncFooterSummary {
  queuedStartsInMinutes: number | null;
  lastCompletedAt: number | null;
  failedCount: number;
}

function summarizeCloudSyncStatus(status: CloudSyncStatus | null, now: number): CloudSyncFooterSummary {
  const providerStatuses = PROVIDERS
    .map((provider) => status?.providers?.[provider])
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  const queuedStarts = providerStatuses
    .filter((entry) => entry.state === 'queued' && entry.startsAt)
    .map((entry) => Date.parse(entry.startsAt as string))
    .filter((value) => Number.isFinite(value));
  const queuedStartsInMinutes = status?.overall === 'queued' && queuedStarts.length > 0
    ? Math.max(1, Math.ceil((Math.min(...queuedStarts) - now) / 60_000))
    : null;

  const completedTimes = providerStatuses
    .map((entry) => (entry.lastCompletedAt ? Date.parse(entry.lastCompletedAt) : NaN))
    .filter((value) => Number.isFinite(value));
  const lastCompletedAt = completedTimes.length > 0 ? Math.max(...completedTimes) : null;

  const failedCount = status?.overall === 'idle'
    ? providerStatuses
      .filter((entry) => entry.state === 'idle')
      .reduce((total, entry) => total + Math.max(0, entry.failedCount ?? 0), 0)
    : 0;

  return { queuedStartsInMinutes, lastCompletedAt, failedCount };
}

function formatFailedFileCount(count: number): string {
  return count === 1 ? "1 file couldn't be processed." : `${count} files couldn't be processed.`;
}

interface AccountControlProps {
  subscriptions?: SubscriptionsBinding;
}

const AccountControl: React.FC<AccountControlProps> = ({ subscriptions }) => {
  const dispatch = useAppDispatch();

  const {
    selectedTranslationId,
    selectedTranslationIds,
    translationRecords,
    selectedBook,
    selectedChapter,
    selectedLanguages,
    sourceUrls,
    sourceUrlAddedAt,
    sourceUrlTombstones,
    disabledSourceItems,
    resourceTagOverrides,
    resourceHiddenTags,
    theme,
    translatorItalics,
    translatorParagraphMarks,
    ready,
    userId,
  } = useAppSelector((state) => state.ui);
  const resourceTagColors = useResourceTagColorEntries();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [configUpdatedAt, setConfigUpdatedAt] = useState<number>(Date.now());
  const [hasPendingSync, setHasPendingSync] = useState(false);
  const [linkedAccounts, setLinkedAccounts] = useState<LinkedCloudAccount[]>([]);
  const [sessions, setSessions] = useState(getStoredFederatedSessions());
  const [missingProviderPrompts, setMissingProviderPrompts] = useState<FederatedProvider[]>([]);
  const [connectModalProvider, setConnectModalProvider] = useState<FederatedProvider | null>(null);
  const [fileSyncFocusRequest, setFileSyncFocusRequest] = useState<{ provider: FederatedProvider; requestId: number } | null>(null);
  const [hasUnsavedFileSyncChanges, setHasUnsavedFileSyncChanges] = useState(false);
  const [pickerUsageSnapshot, setPickerUsageSnapshot] = useState<CloudFolderPickerUsageSnapshot>({
    selectedBytes: 0,
    sizesReady: true,
    providersWithSelection: [],
    stagedSelectedDocs: [],
    appliedSelectedDocs: [],
    deselectedAppliedRootBytes: [],
    liveSelectedDocs: [],
    membershipKnown: false,
  });
  const [publicanCommitted, setPublicanCommitted] = useState<PublicanCommittedEntry[]>([]);
  const [publishedByDocumentId, setPublishedByDocumentId] = useState<Map<string, string>>(() => new Map());
  const [selectedStoragePlan, setSelectedStoragePlan] = useState<SyncStoragePlan>(() => defaultActivePlan());
  const [paymentSimPlan, setPaymentSimPlan] = useState<SyncStoragePlan | null>(null);
  const activeStoragePlan = useMemo(() => defaultActivePlan(), []);
  const [providerSyncPreferences, setProviderSyncPreferences] = useState<ProviderSyncPreferenceMap>(() => {
    const defaults = createDefaultProviderPreferences();
    const stored = readStoredProviderSyncPreferences();
    return mergeProviderPreferences(defaults, stored);
  });
  const fileSyncFocusCounterRef = useRef(0);
  const folderPickerRef = useRef<CloudFolderPickerHandle>(null);
  const linkedAccountsRef = useRef<LinkedCloudAccount[]>([]);
  const isMountedRef = useRef(false);
  const hasBootstrappedAuthRef = useRef(false);
  const hasInitializedCloudStateRef = useRef(false);
  const hasLoadedCloudSnapshotRef = useRef(false);
  const hasUserActivitySinceReadRef = useRef(false);
  const syncInFlightRef = useRef(false);
  const syncQueuedRef = useRef(false);
  const syncErrorToastedRef = useRef(false);
  const isModalOpenRef = useRef(isModalOpen);
  const reconnectToastedRef = useRef(new Set<FederatedProvider>());
  const lastCloudReadAtRef = useRef(Date.now());
  const lastSyncActivityReportAtRef = useRef(0);
  const fieldStampsRef = useRef<SyncedFieldStamps>(createFieldStamps(0));
  const lastFingerprintsRef = useRef<Record<SyncedConfigField, string> | null>(null);
  const lastEntryMergedFingerprintRef = useRef('');
  // Fingerprints of the last config pulled from the cloud; state catching up to it is not a local edit.
  const appliedFingerprintsRef = useRef<Record<SyncedConfigField, string> | null>(null);
  const appliedEntryMergedFingerprintRef = useRef<string | null>(null);
  const declinedUserIdRef = useRef<string | null>(null);

  const configSnapshot = useMemo<SyncedCloudConfig['config']>(() => {
    return {
      lastTranslationId: selectedTranslationId,
      lastTranslationIds: selectedTranslationIds,
      translationRecords,
      lastBook: selectedBook || undefined,
      lastChapter: selectedBook ? selectedChapter : undefined,
      languages: selectedLanguages,
      sourceUrls,
      sourceUrlAddedAt,
      sourceUrlTombstones,
      disabledSourceItems,
      resourceTagOverrides,
      resourceHiddenTags,
      theme,
      translatorItalics,
      translatorParagraphMarks,
      userId: userId ?? undefined,
      providerFolderSelections: {
        google: providerSyncPreferences.google.selectedTargets,
        microsoft: providerSyncPreferences.microsoft.selectedTargets,
      },
      resourceTagColors,
    };
  }, [
    selectedTranslationId,
    selectedTranslationIds,
    translationRecords,
    selectedBook,
    selectedChapter,
    selectedLanguages,
    sourceUrls,
    sourceUrlAddedAt,
    sourceUrlTombstones,
    disabledSourceItems,
    resourceTagOverrides,
    resourceHiddenTags,
    theme,
    translatorItalics,
    translatorParagraphMarks,
    userId,
    providerSyncPreferences,
    resourceTagColors,
  ]);

  const syncedFieldFingerprints = useMemo(() => fieldFingerprints(configSnapshot), [configSnapshot]);
  const entryMergedFingerprintValue = useMemo(() => entryMergedFingerprint(configSnapshot), [configSnapshot]);

  const activeSession = useMemo(() => getMostRecentlyGrantedSession(sessions), [sessions]);

  const providerSessionByType = useMemo(() => {
    return {
      google: sessions.google ?? null,
      microsoft: sessions.microsoft ?? null,
    };
  }, [sessions]);

  const fileSyncProviders = useMemo(() => PROVIDERS.filter(
    (provider) => providerSyncPreferences[provider].syncFiles && Boolean(providerSessionByType[provider])
  ), [providerSessionByType, providerSyncPreferences]);

  useEffect(() => {
    isModalOpenRef.current = isModalOpen;
  }, [isModalOpen]);

  useEffect(() => {
    for (const provider of missingProviderPrompts) {
      if (reconnectToastedRef.current.has(provider)) {
        continue;
      }
      reconnectToastedRef.current.add(provider);
      showToast({
        key: `reconnect-${provider}`,
        tone: 'warning',
        message: `Reconnect ${formatProviderList([provider])} on this device to continue background cloud sync.`,
        action: { label: 'Open Account Sync', onClick: () => setIsModalOpen(true) },
      });
    }
  }, [missingProviderPrompts]);

  // Background polling only runs while a watch started by an Account Sync Apply is outstanding, or
  // until one status has been read for the current file-sync providers (to spot a pending reconnect).
  const [syncWatch, setSyncWatch] = useState<SyncWatch | null>(null);
  const reconnectCheckKey = userId && fileSyncProviders.length > 0 ? `${userId}|${fileSyncProviders.join(',')}` : '';
  const [reconnectCheckedKey, setReconnectCheckedKey] = useState('');
  const {
    status: cloudSyncStatus,
    fetchId: cloudSyncFetchId,
    refresh: refreshCloudSyncStatus,
  } = useCloudSyncStatus({
    userId,
    providers: fileSyncProviders,
    enabled: isModalOpen || syncWatch !== null || reconnectCheckKey !== reconnectCheckedKey,
  });
  const cloudSyncFetchIdRef = useRef(cloudSyncFetchId);
  useEffect(() => {
    cloudSyncFetchIdRef.current = cloudSyncFetchId;
  }, [cloudSyncFetchId]);

  useEffect(() => {
    if (!reconnectCheckKey || reconnectCheckKey === reconnectCheckedKey || !cloudSyncStatus) {
      return;
    }
    if (fileSyncProviders.every((provider) => cloudSyncStatus.providers[provider])) {
      setReconnectCheckedKey(reconnectCheckKey);
    }
  }, [cloudSyncStatus, fileSyncProviders, reconnectCheckKey, reconnectCheckedKey]);

  // Signed back in with File Sync on, but the restored selection hasn't been applied yet. Until the
  // user applies, CloudControlService treats the provider as still signed out.
  const [appliedReconnects, setAppliedReconnects] = useState<Partial<Record<FederatedProvider, string>>>({});
  const reconnectPendingProviders = useMemo(() => fileSyncProviders.filter((provider) => {
    const disconnectedAt = cloudSyncStatus?.providers?.[provider]?.disconnectedAt;
    return Boolean(disconnectedAt) && appliedReconnects[provider] !== disconnectedAt;
  }), [appliedReconnects, cloudSyncStatus, fileSyncProviders]);
  const reconnectPendingRef = useRef(reconnectPendingProviders);
  reconnectPendingRef.current = reconnectPendingProviders;
  const reconnectPendingByProvider = useMemo<Partial<Record<FederatedProvider, boolean>>>(
    () => Object.fromEntries(reconnectPendingProviders.map((provider) => [provider, true])),
    [reconnectPendingProviders]
  );
  const rejectedDocumentIdsByProvider = useMemo<Partial<Record<FederatedProvider, ReadonlySet<string>>>>(
    () => Object.fromEntries(fileSyncProviders.flatMap((provider) => {
      const rejected = cloudSyncStatus?.providers?.[provider]?.rejectedDocuments ?? [];
      return rejected.length > 0 ? [[provider, new Set(rejected.map((entry) => entry.documentId))]] : [];
    })),
    [cloudSyncStatus, fileSyncProviders]
  );

  const startSyncWatch = useCallback((providers: FederatedProvider[]) => {
    setSyncWatch((current) => startOrExtendSyncWatch(current, providers, Date.now(), cloudSyncFetchIdRef.current));
  }, []);

  useEffect(() => {
    if (!syncWatch || !cloudSyncStatus || cloudSyncFetchId <= syncWatch.afterFetchId) {
      return;
    }

    const next = advanceSyncWatch(syncWatch, cloudSyncStatus);
    if (next.pending.length > 0) {
      setSyncWatch({ ...next, afterFetchId: cloudSyncFetchId });
      return;
    }

    setSyncWatch(null);
    if (next.finished.length > 0) {
      showToast({
        ...formatSyncCompleteToast(next.finished, next.failedCount),
        action: { label: 'Refresh', onClick: () => window.location.reload() },
      });
    }
  }, [cloudSyncFetchId, cloudSyncStatus, syncWatch]);

  const syncWatchSince = syncWatch?.since ?? null;
  useEffect(() => {
    if (syncWatchSince === null) {
      return;
    }
    const timer = window.setTimeout(
      () => setSyncWatch(null),
      Math.max(0, syncWatchSince + SYNC_WATCH_TIMEOUT_MS - Date.now())
    );
    return () => window.clearTimeout(timer);
  }, [syncWatchSince]);
  const [fileSyncCompletion, setFileSyncCompletion] = useState<{ failedCount: number } | null>(null);
  const handledCloudSyncFetchIdRef = useRef(0);
  const previousCloudSyncOverallRef = useRef<CloudSyncStatus['overall']>(null);

  // Layout effect so the idle "Last synced" text never paints for a frame before the completion message.
  useLayoutEffect(() => {
    // Only polls received while the dialog is open count; the status kept from a previous
    // session would otherwise turn a transition that happened while closed into "complete".
    if (!isModalOpen) {
      handledCloudSyncFetchIdRef.current = cloudSyncFetchId;
      previousCloudSyncOverallRef.current = null;
      setFileSyncCompletion(null);
      return;
    }

    if (cloudSyncFetchId === handledCloudSyncFetchIdRef.current) {
      return;
    }
    handledCloudSyncFetchIdRef.current = cloudSyncFetchId;

    const overall = cloudSyncStatus?.overall ?? null;
    if (previousCloudSyncOverallRef.current === 'syncing' && overall === 'idle') {
      setFileSyncCompletion({ failedCount: summarizeCloudSyncStatus(cloudSyncStatus, Date.now()).failedCount });
    } else if (overall === 'queued' || overall === 'syncing') {
      setFileSyncCompletion(null);
    }
    previousCloudSyncOverallRef.current = overall;
  }, [cloudSyncFetchId, cloudSyncStatus, isModalOpen]);

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

  const applyRemoteConfig = useCallback(async (remote: SyncedCloudConfig['config']) => {
    appliedFingerprintsRef.current = fieldFingerprints(remote);
    appliedEntryMergedFingerprintRef.current = entryMergedFingerprint(remote);
    mergeIntoResourceTagColors(remote.resourceTagColors);

    dispatch(restoreState({
      selectedTranslationId: remote.lastTranslationId || 'KJV',
      selectedTranslationIds: remote.lastTranslationIds || [remote.lastTranslationId || 'KJV'],
      translationRecords: remote.translationRecords || [{ id: remote.lastTranslationId || 'KJV', starred: true }],
      selectedBook: remote.lastBook || null,
      selectedChapter: remote.lastChapter || 1,
      selectedLanguages: remote.languages ?? [],
      sourceUrls: remote.sourceUrls ?? [],
      sourceUrlAddedAt: normalizeTimestampMap(remote.sourceUrlAddedAt),
      sourceUrlTombstones: normalizeTimestampMap(remote.sourceUrlTombstones),
      disabledSourceItems: normalizeDisabledSourceItems(remote.disabledSourceItems),
      resourceTagOverrides: normalizeResourceTagOverrides(remote.resourceTagOverrides),
      resourceHiddenTags: remote.resourceHiddenTags ?? [],
      theme: remote.theme || 'light',
      translatorItalics: typeof remote.translatorItalics === 'boolean' ? remote.translatorItalics : true,
      translatorParagraphMarks: typeof remote.translatorParagraphMarks === 'boolean'
        ? remote.translatorParagraphMarks
        : true,
    }));

    setProviderSyncPreferences((current) => {
      const next = { ...current };
      for (const provider of PROVIDERS) {
        next[provider] = {
          ...next[provider],
          selectedTargets: (remote.providerFolderSelections?.[provider] ?? []) as ProviderSyncTarget[],
        };
      }

      return next;
    });

    // setUserId is a no-op locally if a user ID was already established on this device.
    if (typeof remote.userId === 'string' && remote.userId.trim().length > 0) {
      dispatch(setUserId(remote.userId));
    }

    if (remote.lastTranslationId) {
      await dispatch(loadTranslation(remote.lastTranslationId));
      dispatch(setCurrentBibleFromId(remote.lastTranslationId));
    }
  }, [dispatch]);

  /**
   * The account's User ID is whichever was established first on any device. A device that linked
   * before it could see that ID holds a placeholder until its tokens are re-keyed to the established one.
   */
  const adoptEstablishedUserId = useCallback(async (
    placeholderUserId: string,
    placeholderStamp: number,
    merged: SyncedCloudConfig
  ): Promise<'adopted' | 'kept' | 'failed' | 'not-linked'> => {
    const establishedUserId = String(merged.config.userId ?? '').trim();
    const establishedStamp = merged.fieldUpdatedAt?.userId ?? 0;
    if (!placeholderUserId || !establishedUserId || establishedUserId === placeholderUserId || establishedStamp <= 0) {
      return 'kept';
    }

    if (placeholderStamp > 0) {
      if (establishedStamp >= placeholderStamp) {
        return 'kept';
      }
    } else {
      // No recorded time for this device's own ID, so which came first is a guess: ask.
      if (declinedUserIdRef.current === establishedUserId) {
        return 'kept';
      }
      if (!window.confirm(
        `This device uses ${placeholderUserId} as its Marginalia User ID, but your account was set up as ${establishedUserId}. Switch this device to ${establishedUserId}?`
      )) {
        declinedUserIdRef.current = establishedUserId;
        return 'kept';
      }
    }

    const rekeyed = await rekeyStoredRefreshTokens(placeholderUserId, establishedUserId, PROVIDERS);
    if (rekeyed !== 'moved') {
      return rekeyed;
    }

    bibleService.replaceUserId(establishedUserId);
    dispatch(replaceUserId(establishedUserId));
    setStorageSessionUserId(establishedUserId);
    void establishStorageSession(establishedUserId);
    // CloudControlService releases the placeholder's File Sync library and re-claims its documents
    // under the established ID, which publishes them at the same location under that ID.
    for (const url of merged.config.sourceUrls ?? []) {
      if (isOwnLibraryUrl(url, placeholderUserId)) {
        dispatch(removeSourceUrl(url));
        const establishedUrl = ownLibraryUrlFor(url, establishedUserId);
        if (establishedUrl) {
          dispatch(addSourceUrl(establishedUrl));
        }
      }
    }
    return 'adopted';
  }, [dispatch]);

  /**
   * Reads every signed-in provider's copy, merges it with `localDoc`, applies the result locally,
   * and writes it back to each provider whose copy differs. Providers whose read failed are not
   * written, so an unreadable copy is never clobbered.
   *
   * `forceQueueProviders` are notified even when their selection is unchanged (the first Apply
   * after signing back in); `skipQueueProviders` are never notified.
   */
  const reconcileWithCloud = useCallback(async (
    localDoc: SyncedCloudConfig,
    currentSessions: Partial<Record<FederatedProvider, FederatedSession>>,
    options: {
      queueFolderChanges: boolean;
      trigger?: 'apply' | 'background';
      forceQueueProviders?: FederatedProvider[];
      skipQueueProviders?: FederatedProvider[];
    }
  ): Promise<ReconcileResult> => {
    const failures: string[] = [];
    const remotes = new Map<FederatedProvider, SyncedCloudConfig | null>();

    for (const provider of PROVIDERS) {
      const session = currentSessions[provider];
      if (!session || !providerSyncPreferences[provider].syncSettings) {
        continue;
      }

      try {
        remotes.set(provider, await readCloudConfigForSession(session));
      } catch (readError) {
        const message = readError instanceof Error ? readError.message : String(readError);
        failures.push(`${PROVIDER_LABEL[provider]}: ${message}`);
      }
    }

    const remoteDocs = Array.from(remotes.values()).filter((doc): doc is SyncedCloudConfig => Boolean(doc));
    const persistedState = bibleService.readState() as MarginaliaState;
    const detachedProviders = persistedState.cloudDetachedProviders ?? [];
    const rawMerged = mergeSyncedCloudConfigs([localDoc, ...remoteDocs]);
    const localFolders = {
      google: (localDoc.config.providerFolderSelections?.google ?? []) as ProviderSyncTarget[],
      microsoft: (localDoc.config.providerFolderSelections?.microsoft ?? []) as ProviderSyncTarget[],
    };
    const merged: SyncedCloudConfig = {
      ...rawMerged,
      config: toLocalConfigView(rawMerged.config, localFolders),
      linkedAccounts: rawMerged.linkedAccounts.filter((entry) => !detachedProviders.includes(entry.provider)),
    };

    const localChanged = localConfigDiffers(localDoc.config, merged.config);
    if (localChanged) {
      await applyRemoteConfig(merged.config);
    }

    const localUserId = String(persistedState.userId ?? '').trim();
    const establishedUserId = String(merged.config.userId ?? '').trim();
    const adoption = await adoptEstablishedUserId(localUserId, fieldStampsRef.current.userId, merged);
    if (adoption === 'failed') {
      failures.push(`Could not move this device to your account's User ID (${establishedUserId}); will retry.`);
    } else if (adoption === 'not-linked') {
      failures.push(`To move this device to your account's User ID (${establishedUserId}), sign in here with an account already linked to it.`);
    }
    const ownerUserId = adoption === 'adopted' || !localUserId ? establishedUserId : localUserId;

    // Keep any stamp a local edit made while the reads were in flight. The userId stamp records when
    // that ID was established, so it is never raised; a kept placeholder keeps its own.
    const mergedStamps = normalizeFieldStamps(merged.fieldUpdatedAt, 0);
    for (const field of SYNCED_CONFIG_FIELDS) {
      if (field !== 'userId') {
        mergedStamps[field] = Math.max(mergedStamps[field], fieldStampsRef.current[field]);
      }
    }
    if (ownerUserId !== establishedUserId) {
      mergedStamps.userId = fieldStampsRef.current.userId;
    }
    fieldStampsRef.current = mergedStamps;
    setConfigUpdatedAt(merged.updatedAt);
    if (stableStringify(merged.linkedAccounts) !== stableStringify(linkedAccountsRef.current)) {
      setLinkedAccounts(merged.linkedAccounts);
    }

    const written: FederatedProvider[] = [];
    const upToDate: FederatedProvider[] = [];
    for (const [provider, remote] of remotes) {
      const session = currentSessions[provider];
      if (!session) {
        continue;
      }
      if (syncedConfigsEqual(remote, merged)) {
        upToDate.push(provider);
        continue;
      }

      try {
        await writeCloudConfigForSession(session, merged);
        written.push(provider);
      } catch (writeError) {
        const message = writeError instanceof Error ? writeError.message : String(writeError);
        failures.push(`${PROVIDER_LABEL[provider]}: ${message}`);
      }
    }

    const syncedAt = Date.now();
    if (remotes.size > 0) {
      setLastSyncedAt(syncedAt);
    }
    persistCloudState({
      cloudLinkedAccounts: merged.linkedAccounts,
      cloudConfigUpdatedAt: merged.updatedAt,
      cloudFieldUpdatedAt: fieldStampsRef.current,
      ...(remotes.size > 0 ? { cloudConfigLastSyncedAt: syncedAt } : {}),
    });

    // CloudControlService reads each provider's folder selection from that provider's own copy.
    const libraryUrls: string[] = [];
    const queuedProviders: FederatedProvider[] = [];
    if (options.queueFolderChanges && ownerUserId) {
      const forced = new Set(options.forceQueueProviders ?? []);
      const skipped = new Set(options.skipQueueProviders ?? []);
      // A forced provider whose copy was already current still needs the notification.
      const candidates = [...written, ...upToDate.filter((provider) => forced.has(provider))];
      await Promise.all(candidates.map(async (provider) => {
        if (!providerSyncPreferences[provider].syncFiles || skipped.has(provider)) {
          return;
        }

        const before = remotes.get(provider)?.config.providerFolderSelections?.[provider];
        const after = merged.config.providerFolderSelections?.[provider];
        if (!forced.has(provider) && !folderSelectionChanged(before, after)) {
          return;
        }

        try {
          const result = await queueCloudFolderSelection({
            userId: ownerUserId,
            provider,
            removed: removedFolderIds(before, after),
            accessToken: currentSessions[provider]?.accessToken,
            trigger: options.trigger ?? 'background',
          });
          if (result?.awaitingApply) {
            return;
          }
          queuedProviders.push(provider);
          const libraryUrl = String(result?.libraryUrl ?? '').trim();
          if (libraryUrl) {
            libraryUrls.push(libraryUrl);
          }
        } catch (queueError) {
          failures.push(queueError instanceof Error ? queueError.message : String(queueError));
        }
      }));
    }

    return {
      merged,
      localChanged,
      readCount: remotes.size,
      writeCount: written.length,
      failures,
      libraryUrls,
      queuedProviders,
    };
  }, [adoptEstablishedUserId, applyRemoteConfig, persistCloudState, providerSyncPreferences]);

  const buildLocalDoc = useCallback((): SyncedCloudConfig => ({
    ...toSyncedCloudConfig(configSnapshot, linkedAccounts, configUpdatedAt),
    fieldUpdatedAt: { ...fieldStampsRef.current },
  }), [configSnapshot, configUpdatedAt, linkedAccounts]);

  const runSync = useCallback(async (reason: 'publish' | 'startup' | 'activity') => {
    if (!ready || linkedAccounts.length === 0) {
      return;
    }

    if (syncInFlightRef.current) {
      syncQueuedRef.current = true;
      return;
    }

    syncInFlightRef.current = true;
    // Cleared up front so an edit made mid-reconcile schedules another pass.
    setHasPendingSync(false);
    try {
      const currentSessions = await getFreshFederatedSessions();
      setSessions(currentSessions);
      setMissingProviderPrompts(
        Array.from(new Set(linkedAccounts.map((entry) => entry.provider)))
          .filter((provider) => !currentSessions[provider])
      );

      setSyncState('syncing');
      if (reason === 'publish') {
        setStatusMessage(null);
      }

      const result = await reconcileWithCloud(buildLocalDoc(), currentSessions, {
        queueFolderChanges: true,
        trigger: 'background',
        skipQueueProviders: reconnectPendingRef.current,
      });

      if (result.failures.length > 0) {
        setSyncState('error');
        setStatusMessage(`Sync issues: ${result.failures.join(' | ')}`);
        // Only the first failure of a streak is toasted, and the dialog footer covers it while open.
        if (!syncErrorToastedRef.current && !isModalOpenRef.current) {
          syncErrorToastedRef.current = true;
          showToast({ tone: 'error', message: `Settings sync failed: ${result.failures.join(' | ')}` });
        }
        return;
      }

      syncErrorToastedRef.current = false;
      setSyncState('idle');
      if (result.localChanged && reason !== 'startup') {
        setStatusMessage('Pulled newer configuration from cloud.');
        showToast({ message: 'Your settings have been updated to match your more recent changes on another device.' });
      } else if (reason === 'publish') {
        setStatusMessage(result.writeCount > 0 ? 'Configuration synced.' : null);
      }
    } finally {
      syncInFlightRef.current = false;
      if (syncQueuedRef.current) {
        syncQueuedRef.current = false;
        setHasPendingSync(true);
      }
    }
  }, [buildLocalDoc, linkedAccounts, ready, reconcileWithCloud]);

  const refreshCloudSnapshot = useCallback(async (reason: 'startup' | 'activity') => {
    if (!ready || !hasInitializedCloudStateRef.current) {
      return;
    }

    lastCloudReadAtRef.current = Date.now();
    hasUserActivitySinceReadRef.current = false;
    await runSync(reason);
  }, [ready, runSync]);

  // The first cloud account ever connected, on any device, is the account's User ID. A device's first
  // link adopts the ID this provider's settings already name; only a brand-new account uses the email.
  const establishUserIdForSession = useCallback(async (session: FederatedSession): Promise<string> => {
    const existing = String((bibleService.readState() as MarginaliaState).userId ?? '').trim();
    // The broker picks the ID it stored this link's token under (normally the email), so start from that.
    const email = String(session.userId ?? session.profile.email ?? '').trim();
    if (existing || !email) {
      return existing;
    }

    let owner: { userId: string; stamp: number } | null = null;
    try {
      const cloudDoc = await readCloudConfigForSession(session);
      owner = cloudDoc ? readConfigOwner(cloudDoc) : null;
    } catch {
      // Settings unreadable: start with the email; reconcile adopts the owner once it can read them.
    }

    // With no User ID yet, the broker stored this link's refresh token under the email.
    const adopted = owner !== null
      && (owner.userId === email || await rekeyStoredRefreshTokens(email, owner.userId, [session.provider]) === 'moved');
    const userId = adopted && owner ? owner.userId : email;
    dispatch(setUserId(userId));
    fieldStampsRef.current = { ...fieldStampsRef.current, userId: adopted && owner ? owner.stamp : Date.now() };
    persistCloudState({ cloudFieldUpdatedAt: fieldStampsRef.current });
    return userId;
  }, [dispatch, persistCloudState]);

  const handleSessionAfterSignIn = useCallback(async (session: FederatedSession) => {
    const localSessions = await getFreshFederatedSessions();
    setSessions(localSessions);

    const userId = await establishUserIdForSession(session);
    if (userId) {
      setStorageSessionUserId(userId);
      void establishStorageSession(userId);
    }

    const persistedState = bibleService.readState() as MarginaliaState;
    const persistedLinked = normalizeLinkedAccounts(persistedState.cloudLinkedAccounts);
    const baseLinked = mergeLinkedAccounts(linkedAccountsRef.current, persistedLinked);
    const nextLinked = mergeLinkedAccounts(baseLinked, [toLinkedAccount(session)]);
    setLinkedAccounts(nextLinked);
    setMissingProviderPrompts(
      Array.from(new Set(nextLinked.map((entry) => entry.provider)))
        .filter((provider) => !localSessions[provider])
    );

    persistCloudState({
      cloudLinkedAccounts: nextLinked,
      cloudDetachedProviders: (persistedState.cloudDetachedProviders ?? []).filter((provider) => provider !== session.provider),
    });

    // Reconcile (read every copy, merge, write back) through the normal sync path, which runs
    // with current state rather than this first-render closure.
    setHasPendingSync(true);
  }, [establishUserIdForSession, persistCloudState]);

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
    // Before per-field stamps existed, the whole config carried one timestamp; a device that has never
    // synced (fresh or wiped) starts at 0 so the cloud copy wins every field.
    const legacyStamp = typeof saved.cloudConfigLastSyncedAt === 'number' && typeof saved.cloudConfigUpdatedAt === 'number'
      ? saved.cloudConfigUpdatedAt
      : 0;
    fieldStampsRef.current = normalizeFieldStamps(saved.cloudFieldUpdatedAt, legacyStamp);
    const currentSessions = getStoredFederatedSessions();
    setSessions(currentSessions);
    const missingOnThisDevice = Array.from(new Set(initialLinked.map((entry) => entry.provider)))
      .filter((provider) => !currentSessions[provider]);
    setMissingProviderPrompts(missingOnThisDevice);

    const bootUserId = String(saved.userId ?? '').trim();
    if (bootUserId && getMostRecentlyGrantedSession(currentSessions)) {
      setStorageSessionUserId(bootUserId);
      void establishStorageSession(bootUserId);
    }

    void (async () => {
      const refreshedSessions = await getFreshFederatedSessions();
      if (!isMountedRef.current) {
        return;
      }

      setSessions(refreshedSessions);
      const refreshedMissing = Array.from(new Set(initialLinked.map((entry) => entry.provider)))
        .filter((provider) => !refreshedSessions[provider]);
      setMissingProviderPrompts(refreshedMissing);

      if (bootUserId && getMostRecentlyGrantedSession(refreshedSessions)) {
        setStorageSessionUserId(bootUserId);
        void establishStorageSession(bootUserId);
      }
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
    if (!ready || !hasInitializedCloudStateRef.current) {
      return;
    }

    const previous = lastFingerprintsRef.current;
    const previousEntryMerged = lastEntryMergedFingerprintRef.current;
    lastFingerprintsRef.current = syncedFieldFingerprints;
    lastEntryMergedFingerprintRef.current = entryMergedFingerprintValue;

    // Baseline capture: this is not a modification.
    if (!previous) {
      return;
    }

    const applied = appliedFingerprintsRef.current;
    // userId is stamped where it is established, with that time; it is never an edit.
    const changedFields = SYNCED_CONFIG_FIELDS.filter((field) => (
      field !== 'userId'
      && previous[field] !== syncedFieldFingerprints[field]
      && applied?.[field] !== syncedFieldFingerprints[field]
    ));
    const entryMergedChanged = previousEntryMerged !== entryMergedFingerprintValue
      && appliedEntryMergedFingerprintRef.current !== entryMergedFingerprintValue;
    if (changedFields.length === 0 && !entryMergedChanged) {
      return;
    }

    // Edits made while no account is linked are defaults, so a fresh device adopts the cloud copy.
    if (linkedAccountsRef.current.length === 0) {
      return;
    }

    const stamp = nextStamp(maxFieldStamp(fieldStampsRef.current));
    const nextStamps = { ...fieldStampsRef.current };
    for (const field of changedFields) {
      nextStamps[field] = stamp;
    }
    fieldStampsRef.current = nextStamps;
    setConfigUpdatedAt(stamp);
    persistCloudState({ cloudConfigUpdatedAt: stamp, cloudFieldUpdatedAt: nextStamps });
    setHasPendingSync(true);
  }, [ready, syncedFieldFingerprints, entryMergedFingerprintValue, persistCloudState]);

  useEffect(() => {
    // Wait for linked accounts to load; the first render's closure still has none.
    if (!ready || !hasInitializedCloudStateRef.current || hasLoadedCloudSnapshotRef.current || linkedAccounts.length === 0) {
      return;
    }

    hasLoadedCloudSnapshotRef.current = true;
    void refreshCloudSnapshot('startup');
  }, [linkedAccounts.length, ready, refreshCloudSnapshot]);

  useEffect(() => {
    if (!ready || !hasInitializedCloudStateRef.current) {
      return;
    }

    const hasFileSyncSession = PROVIDERS.some(
      (provider) => providerSyncPreferences[provider].syncFiles && Boolean(providerSessionByType[provider])
    );

    const maybeReportSyncActivity = (force = false) => {
      if (!userId || !hasFileSyncSession) {
        return;
      }

      if (document.visibilityState !== 'visible') {
        return;
      }

      const now = Date.now();
      const elapsed = now - lastSyncActivityReportAtRef.current;
      if (!force && lastSyncActivityReportAtRef.current > 0 && elapsed < SYNC_ACTIVITY_THROTTLE_MS) {
        return;
      }

      lastSyncActivityReportAtRef.current = now;
      void reportSyncActivity({ userId });
    };

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
      maybeReportSyncActivity(false);
      maybeRefreshFromActivity();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // First visible after ≥1h since last report: force so idle pending syncs accelerate.
        const force = lastSyncActivityReportAtRef.current === 0
          || Date.now() - lastSyncActivityReportAtRef.current >= SYNC_ACTIVITY_FORCE_GAP_MS;
        maybeReportSyncActivity(force);
        maybeRefreshFromActivity();
      }
    };

    const onFocus = () => {
      hasUserActivitySinceReadRef.current = true;
      const force = lastSyncActivityReportAtRef.current === 0
        || Date.now() - lastSyncActivityReportAtRef.current >= SYNC_ACTIVITY_FORCE_GAP_MS;
      maybeReportSyncActivity(force);
      maybeRefreshFromActivity();
    };

    // Startup presence when File Sync is connected.
    maybeReportSyncActivity(true);

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
  }, [ready, refreshCloudSnapshot, userId, providerSyncPreferences, providerSessionByType]);

  const syncNow = useCallback(() => runSync('publish'), [runSync]);

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

  const handleConnect = useCallback(async (provider: FederatedProvider, preferences: ProviderSyncDraft) => {
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
    fileSyncFocusCounterRef.current += 1;
    const requestId = fileSyncFocusCounterRef.current;
    setFileSyncFocusRequest({ provider, requestId });
  }, []);

  // Opened on every load (and whenever another provider starts awaiting it) until the user applies.
  const reconnectPendingKey = reconnectPendingProviders.join(',');
  const autoOpenedReconnectKeyRef = useRef('');
  useEffect(() => {
    if (reconnectPendingKey === autoOpenedReconnectKeyRef.current) {
      return;
    }
    autoOpenedReconnectKeyRef.current = reconnectPendingKey;
    const [firstPending] = reconnectPendingRef.current;
    if (!firstPending) {
      return;
    }
    setIsModalOpen(true);
    focusFileSyncService(firstPending);
  }, [focusFileSyncService, reconnectPendingKey]);

  const handleDetachProvider = useCallback((provider: FederatedProvider) => {
    const nextLinked = linkedAccounts.filter((entry) => entry.provider !== provider);
    setLinkedAccounts(nextLinked);

    const nextSessions = removeStoredFederatedSession(provider);
    setSessions(nextSessions);
    void (async () => {
      await revokeStoredRefreshToken(provider);
      const remaining = getMostRecentlyGrantedSession(nextSessions);
      const userId = String(bibleService.readState().userId ?? remaining?.profile.email ?? '').trim();
      if (remaining && userId) {
        setStorageSessionUserId(userId);
        await establishStorageSession(userId);
      } else {
        setStorageSessionUserId('');
        await clearStorageSession();
      }
    })();

    const detachedProviders = (bibleService.readState() as MarginaliaState).cloudDetachedProviders ?? [];
    persistCloudState({
      cloudLinkedAccounts: nextLinked,
      cloudConfigUpdatedAt: configUpdatedAt,
      cloudConfigLastSyncedAt: lastSyncedAt ?? undefined,
      cloudDetachedProviders: Array.from(new Set([...detachedProviders, provider])),
    });

    if (nextLinked.length > 0) {
      setHasPendingSync(true);
    }

    setStatusMessage(`${PROVIDER_LABEL[provider]} account detached. Configuration now syncs only to remaining linked providers.`);
    showToast({ message: `${formatProviderList([provider])} disconnected. Synced documents are kept for 10 days.` });
  }, [configUpdatedAt, lastSyncedAt, linkedAccounts, persistCloudState]);

  const handleApplyFolderSelections = useCallback(async (
    nextSelections: Record<FederatedProvider, FolderSelectionTarget[]>,
    options: { watchSync?: boolean } = {}
  ): Promise<FolderApplyResult> => {
    const previousSelections = providerSyncPreferences;
    const nextGoogleTargets = nextSelections.google.map((target) => ({
      id: target.id,
      kind: 'folder' as const,
      name: target.name,
      path: target.path,
      sizeBytes: target.sizeBytes,
      sizeKnown: target.sizeKnown,
      driveId: target.driveId,
      excludedItemIds: target.excludedItemIds,
      tags: target.tags,
      itemTags: target.itemTags,
      itemTagExclusions: target.itemTagExclusions,
    }));
    const nextMicrosoftTargets = nextSelections.microsoft.map((target) => ({
      id: target.id,
      kind: 'folder' as const,
      name: target.name,
      path: target.path,
      sizeBytes: target.sizeBytes,
      sizeKnown: target.sizeKnown,
      driveId: target.driveId,
      excludedItemIds: target.excludedItemIds,
      tags: target.tags,
      itemTags: target.itemTags,
      itemTagExclusions: target.itemTagExclusions,
    }));

    setProviderSyncPreferences((current) => ({
      ...current,
      google: {
        ...current.google,
        selectedTargets: nextGoogleTargets,
      },
      microsoft: {
        ...current.microsoft,
        selectedTargets: nextMicrosoftTargets,
      },
    }));

    const nextFolders: Record<FederatedProvider, ProviderSyncTarget[]> = {
      google: nextGoogleTargets,
      microsoft: nextMicrosoftTargets,
    };

    // Stamp here rather than in the fingerprint effect: the reconcile below runs before the next render.
    const stamp = nextStamp(maxFieldStamp(fieldStampsRef.current));
    const nextStamps = { ...fieldStampsRef.current };
    for (const provider of PROVIDERS) {
      const field: SyncedConfigField = provider === 'google' ? 'folders.google' : 'folders.microsoft';
      const nextFingerprint = stableStringify(nextFolders[provider]);
      if (nextFingerprint !== stableStringify(previousSelections[provider].selectedTargets)) {
        nextStamps[field] = stamp;
      }
      if (lastFingerprintsRef.current) {
        lastFingerprintsRef.current = { ...lastFingerprintsRef.current, [field]: nextFingerprint };
      }
    }
    fieldStampsRef.current = nextStamps;
    setConfigUpdatedAt(stamp);
    persistCloudState({ cloudConfigUpdatedAt: stamp, cloudFieldUpdatedAt: nextStamps });

    const userId = String((bibleService.readState() as MarginaliaState).userId ?? '').trim();
    if (!userId) {
      setHasPendingSync(true);
      return { queuedProviders: [], failures: [] };
    }

    // Reconcile writes marginalia-config.json (selection SoT) and then notifies CCS for each provider
    // whose own selection changed. A returned libraryUrl is registered in sourceUrls and synced again.
    let queuedProviders: FederatedProvider[] = [];
    try {
      const currentSessions = await getFreshFederatedSessions();
      setSessions(currentSessions);

      const localDoc: SyncedCloudConfig = {
        ...toSyncedCloudConfig({ ...configSnapshot, providerFolderSelections: nextFolders }, linkedAccounts, stamp),
        fieldUpdatedAt: { ...nextStamps },
      };
      const reconnecting = reconnectPendingRef.current;
      const result = await reconcileWithCloud(localDoc, currentSessions, {
        queueFolderChanges: true,
        trigger: 'apply',
        forceQueueProviders: reconnecting,
      });
      queuedProviders = result.queuedProviders;
      const appliedReconnecting = reconnecting.filter((provider) => queuedProviders.includes(provider));
      if (appliedReconnecting.length > 0) {
        setAppliedReconnects((current) => ({
          ...current,
          ...Object.fromEntries(appliedReconnecting.map((provider) => [
            provider,
            cloudSyncStatus?.providers?.[provider]?.disconnectedAt ?? '',
          ])),
        }));
      }
      if (queuedProviders.length > 0) {
        if (options.watchSync) {
          startSyncWatch(queuedProviders);
        }
        refreshCloudSyncStatus();
      }
      if (result.failures.length > 0) {
        setStatusMessage(result.failures.join(' | '));
        return { queuedProviders, failures: result.failures };
      }

      if (result.libraryUrls.length === 0) {
        return { queuedProviders, failures: [] };
      }

      for (const libraryUrl of result.libraryUrls) {
        dispatch(addSourceUrl(libraryUrl));
      }

      const mergedAddedAt = result.merged.config.sourceUrlAddedAt ?? {};
      const mergedTombstones = result.merged.config.sourceUrlTombstones ?? {};
      const libraryAddedAt = Object.fromEntries(result.libraryUrls
        .filter((url) => !((mergedAddedAt[url] ?? 0) > (mergedTombstones[url] ?? -1)))
        .map((url) => [url, Math.max(Date.now(), (mergedTombstones[url] ?? 0) + 1)]));
      const withLibrary: SyncedCloudConfig = {
        ...result.merged,
        config: {
          ...result.merged.config,
          sourceUrls: Array.from(new Set([...(result.merged.config.sourceUrls ?? []), ...result.libraryUrls])),
          sourceUrlAddedAt: { ...mergedAddedAt, ...libraryAddedAt },
        },
      };
      const followUp = await reconcileWithCloud(withLibrary, currentSessions, { queueFolderChanges: false });
      if (followUp.failures.length > 0) {
        setStatusMessage(followUp.failures.join(' | '));
      }
      return { queuedProviders, failures: followUp.failures };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusMessage(message);
      return { queuedProviders, failures: [message] };
    }
  }, [
    cloudSyncStatus,
    configSnapshot,
    dispatch,
    linkedAccounts,
    persistCloudState,
    providerSyncPreferences,
    reconcileWithCloud,
    refreshCloudSyncStatus,
    startSyncWatch,
  ]);

  const handleApplyFromAccountSync = useCallback(
    (nextSelections: Record<FederatedProvider, FolderSelectionTarget[]>) => (
      handleApplyFolderSelections(nextSelections, { watchSync: true })
    ),
    [handleApplyFolderSelections]
  );

  useEffect(() => {
    publishFileSyncExclusionSnapshot({
      google: {
        canEdit: providerSyncPreferences.google.syncFiles && Boolean(providerSessionByType.google),
        targets: providerSyncPreferences.google.selectedTargets,
      },
      microsoft: {
        canEdit: providerSyncPreferences.microsoft.syncFiles && Boolean(providerSessionByType.microsoft),
        targets: providerSyncPreferences.microsoft.selectedTargets,
      },
    });
  }, [providerSessionByType, providerSyncPreferences]);

  useEffect(() => registerFileSyncExclusionToggleHandler((provider, itemId) => (
    handleApplyFolderSelections({
      google: providerSyncPreferences.google.selectedTargets,
      microsoft: providerSyncPreferences.microsoft.selectedTargets,
      [provider]: toggleItemExclusion(providerSyncPreferences[provider].selectedTargets, itemId),
    })
  )), [handleApplyFolderSelections, providerSyncPreferences]);

  const getConnectMode = useCallback((provider: FederatedProvider): ProviderConnectMode => {
    if (!isProviderConnected(provider)) {
      return 'connect';
    }

    if (!providerSessionByType[provider]) {
      return 'reconnect';
    }

    return providerSyncPreferences[provider].syncFiles ? 'disconnect' : 'upgrade';
  }, [isProviderConnected, providerSessionByType, providerSyncPreferences]);

  const handleConnectRequestedFromPicker = useCallback((provider: FederatedProvider) => {
    focusFileSyncService(provider);
    setConnectModalProvider(provider);
  }, [focusFileSyncService]);

  const handleModalConnect = useCallback((provider: FederatedProvider, draft: ProviderSyncDraft) => {
    const nextPreferences: ProviderSyncPreferenceMap = {
      ...providerSyncPreferences,
      [provider]: {
        ...providerSyncPreferences[provider],
        syncSettings: draft.syncSettings,
        syncFiles: draft.syncFiles,
      },
    };
    // OAuth may redirect before the persistence effect runs.
    writeStoredProviderSyncPreferences(nextPreferences);
    setProviderSyncPreferences(nextPreferences);
    setConnectModalProvider(null);
    void handleConnect(provider, draft);
  }, [handleConnect, providerSyncPreferences]);

  const handleModalReconnect = useCallback((provider: FederatedProvider) => {
    setConnectModalProvider(null);
    void handleConnect(provider, providerSyncPreferences[provider]);
  }, [handleConnect, providerSyncPreferences]);

  const handleModalDisconnect = useCallback((provider: FederatedProvider) => {
    if (providerSyncPreferences[provider].syncFiles && !window.confirm(DISCONNECT_FILE_SYNC_CONFIRMATION)) {
      return;
    }

    setConnectModalProvider(null);
    handleDetachProvider(provider);
  }, [handleDetachProvider, providerSyncPreferences]);

  const linkedProviders = useMemo<Record<FederatedProvider, boolean>>(() => ({
    google: isProviderConnected('google'),
    microsoft: isProviderConnected('microsoft'),
  }), [isProviderConnected]);

  const folderPickerInitialSelections = useMemo(() => ({
    google: providerSyncPreferences.google.selectedTargets,
    microsoft: providerSyncPreferences.microsoft.selectedTargets,
  }), [providerSyncPreferences.google.selectedTargets, providerSyncPreferences.microsoft.selectedTargets]);

  const folderPickerSyncFilesEnabled = useMemo(() => ({
    google: providerSyncPreferences.google.syncFiles,
    microsoft: providerSyncPreferences.microsoft.syncFiles,
  }), [providerSyncPreferences.google.syncFiles, providerSyncPreferences.microsoft.syncFiles]);

  useEffect(() => {
    if (!isModalOpen) {
      return;
    }
    let cancelled = false;
    const providers = PROVIDERS.filter((provider) => linkedProviders[provider]);
    void loadSyncPlanLedger(providers, userId || undefined).then((ledger) => {
      if (cancelled) {
        return;
      }
      setPublicanCommitted(ledger.committed);
      setPublishedByDocumentId(ledger.publishedByDocumentId);
    });
    return () => {
      cancelled = true;
    };
  }, [isModalOpen, linkedProviders.google, linkedProviders.microsoft, userId]);

  const planUsage = useMemo(() => {
    const enrich = (docs: SyncPlanDocumentRef[]): SyncPlanDocumentRef[] => {
      const byId = new Map<string, SyncPlanDocumentRef>();
      for (const doc of docs) {
        const hash = publishedByDocumentId.get(doc.documentId) || doc.hash;
        byId.set(doc.documentId, { ...doc, hash });
      }
      return Array.from(byId.values());
    };

    const disconnectedAtByProvider = Object.fromEntries(
      reconnectPendingProviders.flatMap((provider) => {
        const disconnectedAt = cloudSyncStatus?.providers?.[provider]?.disconnectedAt;
        return disconnectedAt ? [[provider, disconnectedAt]] : [];
      })
    ) as Partial<Record<FederatedProvider, string>>;

    return computeSyncPlanUsage({
      committed: publicanCommitted,
      publishedByDocumentId,
      stagedSelectedDocs: enrich(pickerUsageSnapshot.stagedSelectedDocs),
      appliedSelectedDocs: enrich(pickerUsageSnapshot.appliedSelectedDocs),
      deselectedAppliedRootBytes: pickerUsageSnapshot.deselectedAppliedRootBytes,
      selectedBytes: pickerUsageSnapshot.selectedBytes,
      liveSelectedDocs: pickerUsageSnapshot.liveSelectedDocs,
      membershipKnown: pickerUsageSnapshot.membershipKnown,
      disconnectedAtByProvider,
    });
  }, [
    cloudSyncStatus,
    pickerUsageSnapshot,
    publicanCommitted,
    publishedByDocumentId,
    reconnectPendingProviders,
  ]);

  const requiredStoragePlan = useMemo(
    () => requiredPlanForBytes(planUsage.billableBytes),
    [planUsage.billableBytes]
  );

  const effectiveSelectedPlan = selectedStoragePlan.capGb < requiredStoragePlan.capGb
    ? requiredStoragePlan
    : selectedStoragePlan;
  const needsPlanUpgrade = effectiveSelectedPlan.capGb > activeStoragePlan.capGb;

  useEffect(() => {
    if (!isModalOpen) {
      return;
    }
    setSelectedStoragePlan(requiredPlanForBytes(0));
  }, [isModalOpen]);

  const handleAccountSyncApplyClick = useCallback(() => {
    if (needsPlanUpgrade) {
      setPaymentSimPlan(effectiveSelectedPlan);
      return;
    }
    folderPickerRef.current?.apply();
  }, [effectiveSelectedPlan, needsPlanUpgrade]);

  const handlePaymentSimConfirm = useCallback((result: PaymentSimResult) => {
    setPaymentSimPlan(null);
    if (result === 'failed') {
      showToast({ tone: 'error', message: 'Payment simulation failed. No changes were applied.' });
      return;
    }
    // Upgrade can run with no File Sync edits; only Apply when there is something to persist.
    if (hasUnsavedFileSyncChanges || reconnectPendingProviders.length > 0) {
      folderPickerRef.current?.apply();
    }
  }, [hasUnsavedFileSyncChanges, reconnectPendingProviders.length]);

  const discardAndCloseModal = () => {
    folderPickerRef.current?.cancel();
    setHasUnsavedFileSyncChanges(false);
    setConnectModalProvider(null);
    setPaymentSimPlan(null);
    setIsModalOpen(false);
  };

  const closeModal = () => {
    if (hasUnsavedFileSyncChanges && !window.confirm(UNSAVED_FILE_SYNC_CONFIRMATION)) {
      return;
    }

    discardAndCloseModal();
  };

  const connectModalMode = connectModalProvider ? getConnectMode(connectModalProvider) : null;
  const connectModalAccount = connectModalProvider ? providerAccountByType[connectModalProvider] : null;
  const connectModalInitialDraft: ProviderSyncDraft | null = connectModalProvider && connectModalMode
    ? (connectModalMode === 'connect' || connectModalMode === 'upgrade'
      ? { syncSettings: true, syncFiles: true }
      : {
        syncSettings: providerSyncPreferences[connectModalProvider].syncSettings,
        syncFiles: providerSyncPreferences[connectModalProvider].syncFiles,
      })
    : null;

  const isFileSyncRunning = cloudSyncStatus?.overall === 'syncing';
  const isFileSyncQueued = cloudSyncStatus?.overall === 'queued';
  const cloudSyncSummary = summarizeCloudSyncStatus(cloudSyncStatus, Date.now());
  const displayedLastSyncedAt = cloudSyncSummary.lastCompletedAt ?? lastSyncedAt;

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
                      Bring your personal notes into Marginalia by connecting a cloud provider below! We'll scan your notes for Scripture references and link them to the corresponding Bible passages. As you read, any notes you've made on a verse will be viewable right within Marginalia. Ask your church if they have a library with Marginalia. If so, you can subscribe from here to access their resources alongside your own notes.
                    </div>
                  )}

                  {missingProviderPrompts.length > 0 && (
                    <div className="alert alert-warning mb-0" role="alert">
                      <div className="fw-semibold mb-1">Reconnect required</div>
                      <div className="small">
                        Reconnect {missingProviderPrompts.map((provider) => PROVIDER_LABEL[provider]).join(' and ')} on this device from its Manage link below to continue background cloud sync.
                      </div>
                    </div>
                  )}

                  <CloudFolderPicker
                    sessions={providerSessionByType}
                    initialSelections={folderPickerInitialSelections}
                    providerSyncFilesEnabled={folderPickerSyncFilesEnabled}
                    linkedProviders={linkedProviders}
                    focusRequest={fileSyncFocusRequest}
                    onSelectionsChange={handleApplyFromAccountSync}
                    onConnectRequested={handleConnectRequestedFromPicker}
                    onDirtyChange={setHasUnsavedFileSyncChanges}
                    onUsageSnapshotChange={setPickerUsageSnapshot}
                    reconnectPending={reconnectPendingByProvider}
                    rejectedDocumentIds={rejectedDocumentIdsByProvider}
                    subscriptions={subscriptions}
                    ref={folderPickerRef}
                  />

                  <SyncPlanUsageBar
                    committedBytes={planUsage.committedAdjustedBytes}
                    selectedBytes={planUsage.selectedBytes}
                    providersWithSelection={pickerUsageSnapshot.providersWithSelection}
                    activePlan={activeStoragePlan}
                    selectedPlan={effectiveSelectedPlan}
                    onSelectedPlanChange={setSelectedStoragePlan}
                  />
                </div>

                <div className="modal-footer account-modal-footer">
                  <p className="account-modal-footer-status small text-body-secondary mb-0 me-auto">
                    {isFileSyncRunning ? (
                      <span>Syncing files...</span>
                    ) : isFileSyncQueued ? (
                      <span>
                        <i className="fa-regular fa-clock account-sync-queued-icon" aria-hidden="true"></i>{' '}
                        {cloudSyncSummary.queuedStartsInMinutes !== null
                          ? `Sync is queued up to start within the next ~${cloudSyncSummary.queuedStartsInMinutes} min.`
                          : 'Sync is queued.'}
                      </span>
                    ) : fileSyncCompletion ? (
                      <span>
                        {fileSyncCompletion.failedCount === 0
                          ? 'Sync complete!'
                          : `Sync complete, ${formatFailedFileCount(fileSyncCompletion.failedCount)}`}{' '}
                        <button
                          type="button"
                          className="btn btn-link p-0 border-0 align-baseline account-sync-refresh-link"
                          onClick={() => window.location.reload()}
                        >
                          Click to refresh
                        </button>
                      </span>
                    ) : (displayedLastSyncedAt || syncState === 'syncing') && (
                      <span>
                        {displayedLastSyncedAt
                          ? `Last synced ${new Date(displayedLastSyncedAt).toLocaleString()}.`
                          : 'Syncing configuration...'}
                      </span>
                    )}
                    {(syncState === 'syncing' || isFileSyncRunning) && (
                      <>{' '}<i className="fa-solid fa-circle-notch fa-spin account-sync-spinner" aria-hidden="true"></i></>
                    )}
                    {!fileSyncCompletion && cloudSyncSummary.failedCount > 0 && (
                      <>{' '}<span>{formatFailedFileCount(cloudSyncSummary.failedCount)}</span></>
                    )}
                    {statusMessage && (
                      <>{' '}<span className="account-status-message">{statusMessage}</span></>
                    )}
                  </p>

                  <div className="d-flex gap-2">
                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      onClick={discardAndCloseModal}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={
                        !needsPlanUpgrade
                        && !hasUnsavedFileSyncChanges
                        && reconnectPendingProviders.length === 0
                      }
                      onClick={handleAccountSyncApplyClick}
                    >
                      {needsPlanUpgrade ? (
                        <>
                          <i className="fa-regular fa-gem me-2" aria-hidden="true" />
                          Upgrade to {effectiveSelectedPlan.label}
                        </>
                      ) : (
                        <>
                          <i className="fa-solid fa-check me-2" aria-hidden="true" />
                          Apply
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {paymentSimPlan && (
            <SyncPlanPaymentSimModal
              plan={paymentSimPlan}
              onConfirm={handlePaymentSimConfirm}
              onCancel={() => setPaymentSimPlan(null)}
            />
          )}

          {connectModalProvider && connectModalMode && connectModalInitialDraft && (
            <ProviderConnectModal
              key={`${connectModalProvider}-${connectModalMode}`}
              provider={connectModalProvider}
              mode={connectModalMode}
              accountLabel={connectModalAccount
                ? connectModalAccount.email || connectModalAccount.displayName || connectModalAccount.providerAccountId
                : null}
              initialDraft={connectModalInitialDraft}
              onConnect={(draft) => handleModalConnect(connectModalProvider, draft)}
              onReconnect={() => handleModalReconnect(connectModalProvider)}
              onDisconnect={() => handleModalDisconnect(connectModalProvider)}
              onClose={() => setConnectModalProvider(null)}
            />
          )}
        </>
      )}
    </div>
  );
};

export default AccountControl;
