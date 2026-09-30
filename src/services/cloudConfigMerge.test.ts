import type { FederatedProvider } from '../models/bible';
import type { SyncedCloudConfig } from './cloudConfigProviderService';
import {
  createFieldStamps,
  folderSelectionChanged,
  mergeSyncedCloudConfigs,
  removedFolderIds,
  syncedConfigsEqual,
  type SyncedConfigField,
  type SyncedFieldStamps,
} from './cloudConfigMerge';

type SyncedConfig = SyncedCloudConfig['config'];

const defaultConfig: SyncedConfig = {
  lastTranslationId: 'KJV',
  lastTranslationIds: ['KJV'],
  translationRecords: [{ id: 'KJV', starred: true }],
  languages: [],
  sourceUrls: [],
  resourceHiddenTags: [],
  theme: 'light',
  translatorItalics: true,
  translatorParagraphMarks: true,
  providerFolderSelections: { google: [], microsoft: [] },
};

function makeDoc(
  config: Partial<SyncedConfig>,
  stamps: Partial<SyncedFieldStamps> = {},
  updatedAt = 0
): SyncedCloudConfig {
  return {
    schemaVersion: 1,
    updatedAt,
    linkedAccounts: [],
    config: { ...defaultConfig, ...config },
    fieldUpdatedAt: { ...createFieldStamps(0), ...stamps },
  };
}

function edit(
  doc: SyncedCloudConfig,
  patch: Partial<SyncedConfig>,
  fields: SyncedConfigField[],
  stamp: number
): SyncedCloudConfig {
  const fieldUpdatedAt = { ...doc.fieldUpdatedAt };
  for (const field of fields) {
    fieldUpdatedAt[field] = stamp;
  }

  return { ...doc, updatedAt: stamp, config: { ...doc.config, ...patch }, fieldUpdatedAt };
}

describe('mergeSyncedCloudConfigs', () => {
  it('converges both providers when devices edit through different providers (seven-step scenario)', () => {
    const cloud: Record<FederatedProvider, SyncedCloudConfig | null> = { google: null, microsoft: null };
    const reconcile = (local: SyncedCloudConfig, providers: FederatedProvider[]): SyncedCloudConfig => {
      const remotes = providers.map((provider) => cloud[provider]).filter((doc): doc is SyncedCloudConfig => Boolean(doc));
      const merged = mergeSyncedCloudConfigs([local, ...remotes]);
      for (const provider of providers) {
        cloud[provider] = merged;
      }
      return merged;
    };

    // 1-2. PC #1 connects OneDrive and Google.
    let pc1 = makeDoc(
      { theme: 'light', lastBook: 'Genesis', lastChapter: 1, sourceUrls: ['https://a.example/library.json'] },
      createFieldStamps(1000),
      1000
    );
    pc1 = reconcile(pc1, ['microsoft', 'google']);

    // 3-4. Mobile connects OneDrive only (no Google prompt) and switches to dark theme.
    let mobile = reconcile(makeDoc({}), ['microsoft']);
    expect(mobile.config.lastBook).toBe('Genesis');
    mobile = edit(mobile, { theme: 'dark' }, ['theme'], 2000);
    mobile = reconcile(mobile, ['microsoft']);

    // 5-6. PC #2 connects Google only (still the pre-mobile copy) and navigates + adds a source.
    let pc2 = reconcile(makeDoc({}), ['google']);
    expect(pc2.config.theme).toBe('light');
    pc2 = edit(pc2, {
      lastBook: 'John',
      lastChapter: 3,
      sourceUrls: [...(pc2.config.sourceUrls ?? []), 'https://b.example/library.json'],
    }, ['position'], 3000);
    pc2 = reconcile(pc2, ['google']);

    // 7. PC #2 connects OneDrive: both edits survive and both copies are identical.
    pc2 = reconcile(pc2, ['google', 'microsoft']);
    expect(pc2.config.theme).toBe('dark');
    expect(pc2.config.lastBook).toBe('John');
    expect(pc2.config.lastChapter).toBe(3);
    expect(pc2.config.sourceUrls).toEqual(['https://a.example/library.json', 'https://b.example/library.json']);
    expect(syncedConfigsEqual(cloud.google, cloud.microsoft)).toBe(true);

    // PC #1 later reconciles from its stale local copy and lands on the same result.
    pc1 = reconcile(pc1, ['microsoft', 'google']);
    expect(syncedConfigsEqual(pc1, pc2)).toBe(true);
  });

  it('treats every field of a file without stamps as last edited at its updatedAt', () => {
    const legacy: SyncedCloudConfig = {
      schemaVersion: 1,
      updatedAt: 5000,
      linkedAccounts: [],
      config: { ...defaultConfig, theme: 'dark' },
    };
    const local = makeDoc({ theme: 'light', lastBook: 'Ruth', lastChapter: 2 }, { theme: 4000, position: 6000 });

    const merged = mergeSyncedCloudConfigs([local, legacy]);

    expect(merged.config.theme).toBe('dark');
    expect(merged.fieldUpdatedAt?.theme).toBe(5000);
    expect(merged.config.lastBook).toBe('Ruth');
    expect(merged.fieldUpdatedAt?.position).toBe(6000);
  });

  it('breaks stamp ties by value so the result is independent of input order', () => {
    const left = makeDoc({ theme: 'light' }, { theme: 1000 });
    const right = makeDoc({ theme: 'dark' }, { theme: 1000 });

    const forward = mergeSyncedCloudConfigs([left, right]);
    const reverse = mergeSyncedCloudConfigs([right, left]);

    expect(forward.config.theme).toBe(reverse.config.theme);
    expect(syncedConfigsEqual(forward, reverse)).toBe(true);
  });

  it('unions sourceUrls, trimming and de-duplicating them', () => {
    const left = makeDoc({ sourceUrls: ['https://a.example/x.json', ' https://b.example/y.json '] });
    const right = makeDoc({ sourceUrls: ['https://b.example/y.json', '', 'https://c.example/z.json'] });

    const merged = mergeSyncedCloudConfigs([left, right]);

    expect(merged.config.sourceUrls).toEqual([
      'https://a.example/x.json',
      'https://b.example/y.json',
      'https://c.example/z.json',
    ]);
  });

  it('drops a source URL whose tombstone is newer than its last add', () => {
    const a = 'https://a.example/library.json';
    const b = 'https://b.example/library.json';
    const stale = makeDoc({ sourceUrls: [a, b], sourceUrlAddedAt: { [a]: 1000, [b]: 1000 } });
    const disconnected = makeDoc({
      sourceUrls: [a],
      sourceUrlAddedAt: { [a]: 1000, [b]: 1000 },
      sourceUrlTombstones: { [b]: 2000 },
    });

    const merged = mergeSyncedCloudConfigs([stale, disconnected]);

    expect(merged.config.sourceUrls).toEqual([a]);
    expect(merged.config.sourceUrlTombstones).toEqual({ [b]: 2000 });
  });

  it('keeps a legacy source URL without stamps unless another device tombstoned it', () => {
    const a = 'https://a.example/library.json';
    const legacy = makeDoc({ sourceUrls: [a] });

    expect(mergeSyncedCloudConfigs([legacy, makeDoc({})]).config.sourceUrls).toEqual([a]);
    expect(mergeSyncedCloudConfigs([legacy, makeDoc({ sourceUrlTombstones: { [a]: 500 } })]).config.sourceUrls).toEqual([]);
  });

  it('lets a re-add after a disconnect win over the older tombstone', () => {
    const b = 'https://b.example/library.json';
    const readded = makeDoc({ sourceUrls: [b], sourceUrlAddedAt: { [b]: 3000 }, sourceUrlTombstones: { [b]: 2000 } });
    const other = makeDoc({ sourceUrls: [], sourceUrlTombstones: { [b]: 2000 } });

    const merged = mergeSyncedCloudConfigs([other, readded]);

    expect(merged.config.sourceUrls).toEqual([b]);
    expect(merged.config.sourceUrlAddedAt).toEqual({ [b]: 3000 });
  });

  it('merges disabled source items and resource tag overrides by last writer', () => {
    const older = makeDoc(
      { disabledSourceItems: ['builtin|translation|ASV'], resourceTagOverrides: { 'abc:doc': { added: ['Old'], removed: [] } } },
      { disabledSourceItems: 1000, resourceTagOverrides: 3000 }
    );
    const newer = makeDoc(
      { disabledSourceItems: ['builtin|translation|KJV'], resourceTagOverrides: {} },
      { disabledSourceItems: 2000, resourceTagOverrides: 1000 }
    );

    const merged = mergeSyncedCloudConfigs([older, newer]);

    expect(merged.config.disabledSourceItems).toEqual(['builtin|translation|KJV']);
    expect(merged.config.resourceTagOverrides).toEqual({ 'abc:doc': { added: ['Old'], removed: [] } });
  });

  it('keeps the earliest non-empty userId', () => {
    const original = makeDoc({ userId: 'first@example.com' }, { userId: 1000 });
    const later = makeDoc({ userId: 'second@example.com' }, { userId: 9000 });
    const empty = makeDoc({ userId: undefined });

    const merged = mergeSyncedCloudConfigs([empty, later, original]);

    expect(merged.config.userId).toBe('first@example.com');
    expect(merged.fieldUpdatedAt?.userId).toBe(1000);
  });

  it('ranks a userId with no recorded establishment time after any recorded one', () => {
    const established = makeDoc({ userId: 'owner@example.com' }, { userId: 5000 });
    const unstamped = makeDoc({ userId: 'another@example.com' }, { userId: 0 });

    expect(mergeSyncedCloudConfigs([unstamped, established]).config.userId).toBe('owner@example.com');
    expect(mergeSyncedCloudConfigs([established, unstamped]).fieldUpdatedAt?.userId).toBe(5000);
  });

  it('lets a never-synced device adopt the cloud copy, including folder selections', () => {
    const target = { id: 'ms-documents', kind: 'folder' as const, name: 'Documents', tags: ['Teaching'] };
    const cloudCopy = makeDoc(
      { theme: 'dark', providerFolderSelections: { google: [], microsoft: [target] } },
      createFieldStamps(1000),
      1000
    );
    const freshDevice = makeDoc({});

    const merged = mergeSyncedCloudConfigs([freshDevice, cloudCopy]);

    expect(merged.config.theme).toBe('dark');
    expect(merged.config.providerFolderSelections?.microsoft).toEqual([target]);
  });

  it('merges each provider folder selection independently', () => {
    const googleTarget = { id: 'g-1', kind: 'folder' as const, tags: ['A'] };
    const msTarget = { id: 'ms-1', kind: 'folder' as const, tags: ['B'] };
    const left = makeDoc({ providerFolderSelections: { google: [googleTarget], microsoft: [] } }, { 'folders.google': 2000 });
    const right = makeDoc({ providerFolderSelections: { google: [], microsoft: [msTarget] } }, { 'folders.microsoft': 3000 });

    const merged = mergeSyncedCloudConfigs([left, right]);

    expect(merged.config.providerFolderSelections).toEqual({ google: [googleTarget], microsoft: [msTarget] });
  });
});

describe('folder selection change detection', () => {
  it('ignores display-only changes and reports removed ids', () => {
    const before = [{ id: 'f-1', kind: 'folder' as const, name: 'Old', tags: ['A', 'B'] }, { id: 'f-2', kind: 'folder' as const }];
    const renamed = [{ id: 'f-1', kind: 'folder' as const, name: 'New', tags: ['B', 'A'] }, { id: 'f-2', kind: 'folder' as const }];
    const shrunk = [{ id: 'f-1', kind: 'folder' as const, tags: ['A', 'B'] }];

    expect(folderSelectionChanged(before, renamed)).toBe(false);
    expect(folderSelectionChanged(before, shrunk)).toBe(true);
    expect(removedFolderIds(before, shrunk)).toEqual(['f-2']);
  });
});
