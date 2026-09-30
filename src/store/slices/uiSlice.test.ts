import reducer, {
  addSourceUrl,
  dropTranslationRecords,
  removeSourceUrl,
  replaceUserId,
  restoreState,
  setResourceVerseMatchMode,
  setUserId,
} from './uiSlice';

describe('uiSlice subscriptions', () => {
  const url = 'https://publisher.example/library.json';

  it('stamps adds and removals so a re-add always outranks the earlier tombstone', () => {
    const added = reducer(undefined, addSourceUrl(url));
    const removed = reducer(added, removeSourceUrl(url));
    expect(removed.sourceUrls).toEqual([]);
    expect(removed.sourceUrlTombstones[url]).toBeGreaterThan(added.sourceUrlAddedAt[url]);

    const futureTombstone = reducer(removed, restoreState({ sourceUrlTombstones: { [url]: Date.now() + 60_000 } }));
    const readded = reducer(futureTombstone, addSourceUrl(url));
    expect(readded.sourceUrls).toEqual([url]);
    expect(readded.sourceUrlAddedAt[url]).toBeGreaterThan(readded.sourceUrlTombstones[url]);
  });

  it('dropTranslationRecords removes disabled translations and keeps a starred selection', () => {
    const initial = reducer(undefined, restoreState({
      translationRecords: [{ id: 'KJV', starred: true }, { id: 'ASV', starred: false }],
      selectedTranslationIds: ['KJV', 'ASV'],
      selectedTranslationId: 'KJV',
    }));

    const dropped = reducer(initial, dropTranslationRecords(['KJV']));

    expect(dropped.translationRecords).toEqual([{ id: 'ASV', starred: true }]);
    expect(dropped.selectedTranslationIds).toEqual(['ASV']);
    expect(dropped.selectedTranslationId).toBe('ASV');
  });

  it('dropTranslationRecords never empties the translation list', () => {
    const initial = reducer(undefined, { type: 'unknown' });
    const dropped = reducer(initial, dropTranslationRecords(initial.translationRecords.map((record) => record.id)));
    expect(dropped.translationRecords).toEqual(initial.translationRecords);
  });
});

describe('uiSlice userId guard', () => {
  it('setUserId establishes the user ID once and ignores later attempts to change it', () => {
    const afterFirst = reducer(undefined, setUserId('first@example.com'));
    expect(afterFirst.userId).toBe('first@example.com');

    const afterSecond = reducer(afterFirst, setUserId('second@example.com'));
    expect(afterSecond.userId).toBe('first@example.com');
  });

  it('restoreState never overwrites an already-established userId', () => {
    const withUserId = reducer(undefined, setUserId('established@example.com'));

    const afterRestore = reducer(withUserId, restoreState({
      selectedTranslationId: 'ESV',
      userId: 'from-cloud@example.com',
    }));

    expect(afterRestore.userId).toBe('established@example.com');
    expect(afterRestore.selectedTranslationId).toBe('ESV');
  });

  it('restoreState adopts an incoming userId only when none is set locally yet', () => {
    const afterRestore = reducer(undefined, restoreState({ userId: 'from-cloud@example.com' }));
    expect(afterRestore.userId).toBe('from-cloud@example.com');
  });

  it('replaceUserId swaps a placeholder for the established user ID and ignores blanks', () => {
    const placeholder = reducer(undefined, setUserId('placeholder@example.com'));

    const adopted = reducer(placeholder, replaceUserId('established@example.com'));
    expect(adopted.userId).toBe('established@example.com');

    expect(reducer(adopted, replaceUserId('  ')).userId).toBe('established@example.com');
  });
});

describe('uiSlice resource verse match mode', () => {
  it('defaults to ALL and can switch to ANY', () => {
    const initial = reducer(undefined, { type: 'unknown' });
    expect(initial.resourceVerseMatchMode).toBe('all');

    const afterAny = reducer(initial, setResourceVerseMatchMode('any'));
    expect(afterAny.resourceVerseMatchMode).toBe('any');
  });
});
