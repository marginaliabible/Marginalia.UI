import {
  resolveAccountSyncRevealTarget,
  subscriptionItemFromResource,
} from './accountSyncTarget';

describe('subscriptionItemFromResource', () => {
  it('returns null for cloud-synced documents', () => {
    expect(subscriptionItemFromResource({
      cloudProvider: 'google',
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

describe('resolveAccountSyncRevealTarget', () => {
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
