import reducer, { restoreState, setResourceVerseMatchMode, setUserId } from './uiSlice';

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
});

describe('uiSlice resource verse match mode', () => {
  it('defaults to ALL and can switch to ANY', () => {
    const initial = reducer(undefined, { type: 'unknown' });
    expect(initial.resourceVerseMatchMode).toBe('all');

    const afterAny = reducer(initial, setResourceVerseMatchMode('any'));
    expect(afterAny.resourceVerseMatchMode).toBe('any');
  });
});
