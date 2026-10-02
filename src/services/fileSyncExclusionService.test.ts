import {
  getFileSyncExclusionSnapshot,
  isItemExcludedFromSync,
  publishFileSyncExclusionSnapshot,
  registerFileSyncExclusionToggleHandler,
  requestFileSyncExclusionToggle,
  subscribeFileSyncExclusionSnapshot,
  toggleItemExclusion,
} from './fileSyncExclusionService';

describe('toggleItemExclusion', () => {
  it('excludes an item on every root selection of the provider', () => {
    const targets = [
      { id: 'root-a', name: 'A' },
      { id: 'root-b', excludedItemIds: ['z-file'] },
    ];

    const next = toggleItemExclusion(targets, 'doc-1');

    expect(next).toEqual([
      { id: 'root-a', name: 'A', excludedItemIds: ['doc-1'] },
      { id: 'root-b', excludedItemIds: ['doc-1', 'z-file'] },
    ]);
    expect(isItemExcludedFromSync(next, 'doc-1')).toBe(true);
  });

  it('restores an item excluded on any root and leaves other roots untouched', () => {
    const untouched = { id: 'root-b', excludedItemIds: ['other'] };
    const targets = [
      { id: 'root-a', excludedItemIds: ['doc-1'] },
      untouched,
    ];

    const next = toggleItemExclusion(targets, 'doc-1');

    expect(next[0]).toEqual({ id: 'root-a', excludedItemIds: undefined });
    expect(next[1]).toBe(untouched);
    expect(isItemExcludedFromSync(next, 'doc-1')).toBe(false);
  });
});

describe('file sync exclusion bridge', () => {
  it('notifies subscribers when a snapshot is published', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeFileSyncExclusionSnapshot(listener);
    const snapshot = {
      google: { canEdit: true, targets: [{ id: 'root' }] },
      microsoft: { canEdit: false, targets: [] },
    };

    publishFileSyncExclusionSnapshot(snapshot);
    unsubscribe();
    publishFileSyncExclusionSnapshot(snapshot);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getFileSyncExclusionSnapshot()).toBe(snapshot);
  });

  it('routes toggle requests to the registered handler only while registered', async () => {
    const handler = jest.fn(async () => ({ failures: [] }));
    const unregister = registerFileSyncExclusionToggleHandler(handler);

    await expect(requestFileSyncExclusionToggle('microsoft', 'doc-1')).resolves.toEqual({ failures: [] });
    unregister();
    expect(requestFileSyncExclusionToggle('microsoft', 'doc-2')).toBeNull();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('microsoft', 'doc-1');
  });
});
