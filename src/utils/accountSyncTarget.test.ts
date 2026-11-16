import {
  resolveAccountSyncRevealTarget,
  subscriptionItemFromResource,
  syncItemFromLibraryDoc,
} from './accountSyncTarget';

describe('subscriptionItemFromResource', () => {
  it('returns null for cloud-synced documents', () => {
    expect(subscriptionItemFromResource({
      cloudProvider: 'google',
      libraryKey: 'https://example.com/library.json',
      resourceKey: 'lib:doc-1',
    })).toBeNull();
  });

  it('returns null for Local Folders documents', () => {
    expect(subscriptionItemFromResource({
      localFoldersMachineId: 'machine-1',
      libraryKey: 'https://example.com/library.json',
      resourceKey: 'lib:doc-1',
    })).toBeNull();
  });

  it('builds a Subscriptions document key for non-cloud resources', () => {
    expect(subscriptionItemFromResource({
      cloudProvider: null,
      libraryKey: 'builtin',
      resourceKey: 'abc:doc-1',
    })).toEqual({
      libraryKey: 'builtin',
      documentKey: 'builtin|resource|abc:doc-1',
    });
  });
});

describe('syncItemFromLibraryDoc', () => {
  it('prefers Local Folders machineId over cloud provider', () => {
    expect(syncItemFromLibraryDoc({
      cloudProvider: 'google',
      localFoldersMachineId: 'm1',
      documentId: 'C:/Docs/a.md',
    })).toEqual({
      provider: 'microsoft',
      itemId: 'C:/Docs/a.md',
      machineId: 'm1',
    });
  });

  it('builds a cloud syncItem when only cloudProvider is set', () => {
    expect(syncItemFromLibraryDoc({
      cloudProvider: 'google',
      documentId: 'drive-file-1',
    })).toEqual({
      provider: 'google',
      itemId: 'drive-file-1',
    });
  });
});

describe('resolveAccountSyncRevealTarget', () => {
  it('prefers localFolders when syncItem.machineId is set', () => {
    expect(resolveAccountSyncRevealTarget({
      syncItem: { provider: 'microsoft', itemId: 'C:/Docs/a.md', machineId: 'm1' },
      subscriptionItem: { libraryKey: 'builtin', documentKey: 'builtin|resource|x' },
    })).toEqual({ kind: 'localFolders', machineId: 'm1', path: 'C:/Docs/a.md' });
  });

  it('prefers cloud sync over subscriptions', () => {
    expect(resolveAccountSyncRevealTarget({
      syncItem: { provider: 'microsoft', itemId: 'file-1' },
      subscriptionItem: { libraryKey: 'builtin', documentKey: 'builtin|resource|x' },
    })).toEqual({ kind: 'cloud', provider: 'microsoft', itemId: 'file-1' });
  });

  it('falls back to the subscription target', () => {
    expect(resolveAccountSyncRevealTarget({
      syncItem: null,
      subscriptionItem: { libraryKey: 'builtin', documentKey: 'builtin|resource|x' },
    })).toEqual({
      kind: 'subscription',
      libraryKey: 'builtin',
      type: 'resource',
      documentKey: 'builtin|resource|x',
    });
  });
});
