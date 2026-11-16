import {
  localTargetsFromFlatSelection,
  makeLocalNodeKey,
  parseLocalNodeKey,
  selectionFromLocalTargets,
} from './folderSelection';

describe('selectionFromLocalTargets', () => {
  it('flattens excluded, included, and rich folderTags per root', () => {
    expect(selectionFromLocalTargets([
      {
        id: 'C:/Docs',
        kind: 'folder',
        path: 'C:/Docs',
        machineId: 'm1',
        tags: ['Study'],
        excludedItemIds: ['C:/Docs/Skip'],
        includedItemIds: ['C:/Docs/Skip/Keep.md'],
        itemTags: { 'C:/Docs/Notes': ['Personal'] },
        itemTagExclusions: { 'C:/Docs/Notes/old.md': ['Study'] },
      },
    ])).toEqual({
      selectedFolders: ['C:/Docs'],
      excluded: ['C:/Docs/Skip'],
      included: ['C:/Docs/Skip/Keep.md'],
      folderTags: {
        'C:/Docs': {
          tags: ['Study'],
          itemTags: { 'C:/Docs/Notes': ['Personal'] },
          itemTagExclusions: { 'C:/Docs/Notes/old.md': ['Study'] },
        },
      },
    });
  });

  it('skips empty targets and dedupes folder ids', () => {
    expect(selectionFromLocalTargets([
      { id: 'C:/A', kind: 'folder', path: 'C:/A' },
      { id: 'C:/A', kind: 'folder', path: 'C:/A' },
      { id: '', kind: 'folder' },
    ])).toEqual({
      selectedFolders: ['C:/A'],
      excluded: [],
      included: [],
      folderTags: {
        'C:/A': { tags: [], itemTags: {}, itemTagExclusions: {} },
      },
    });
  });
});

describe('localTargetsFromFlatSelection', () => {
  it('round-trips a flattened Local selection into rich targets', () => {
    const flat = selectionFromLocalTargets([{
      id: 'G:/OneDrive/Documents/Ministry',
      kind: 'folder',
      path: 'G:/OneDrive/Documents/Ministry',
      machineId: 'm1',
      tags: ['Research Materials'],
      excludedItemIds: ['G:/OneDrive/Documents/Ministry/Branch'],
      includedItemIds: ['G:/OneDrive/Documents/Ministry/Death and Funerals'],
      itemTags: { 'G:/OneDrive/Documents/Ministry/Way Corps': ['Way Corps'] },
      itemTagExclusions: { 'G:/OneDrive/Documents/Ministry/Way Corps': ['Research Materials'] },
    }]);

    expect(localTargetsFromFlatSelection('m1', flat)).toEqual([{
      id: 'G:/OneDrive/Documents/Ministry',
      machineId: 'm1',
      kind: 'folder',
      path: 'G:/OneDrive/Documents/Ministry',
      name: 'Ministry',
      excludedItemIds: ['G:/OneDrive/Documents/Ministry/Branch'],
      includedItemIds: ['G:/OneDrive/Documents/Ministry/Death and Funerals'],
      tags: ['Research Materials'],
      itemTags: { 'G:/OneDrive/Documents/Ministry/Way Corps': ['Way Corps'] },
      itemTagExclusions: { 'G:/OneDrive/Documents/Ministry/Way Corps': ['Research Materials'] },
    }]);
  });
});

describe('local node keys', () => {
  it('round-trips machineId and path', () => {
    const key = makeLocalNodeKey('abc', 'C:/Users/me/Notes');
    expect(key).toBe('local:abc:C:/Users/me/Notes');
    expect(parseLocalNodeKey(key)).toEqual({ machineId: 'abc', path: 'C:/Users/me/Notes' });
  });
});
