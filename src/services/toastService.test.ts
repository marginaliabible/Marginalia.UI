import {
  ALERT_TOAST_LIFETIME_MS,
  TOAST_LIFETIME_MS,
  __resetToastsForTests,
  dismissToast,
  getToasts,
  setToastExpiryPaused,
  showToast,
} from './toastService';

describe('toastService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    __resetToastsForTests();
  });

  afterEach(() => {
    __resetToastsForTests();
    jest.useRealTimers();
  });

  it('expires info and success toasts after 3 minutes', () => {
    showToast({ message: 'Saved', tone: 'success' });
    showToast({ message: 'Heads up' });

    jest.advanceTimersByTime(TOAST_LIFETIME_MS - 1);
    expect(getToasts()).toHaveLength(2);

    jest.advanceTimersByTime(1);
    expect(getToasts()).toHaveLength(0);
  });

  it('keeps warning and error toasts for 15 minutes', () => {
    showToast({ message: 'Reconnect', tone: 'warning' });
    showToast({ message: 'Failed', tone: 'error' });
    showToast({ message: 'Info' });

    jest.advanceTimersByTime(TOAST_LIFETIME_MS);
    expect(getToasts().map((toast) => toast.message)).toEqual(['Reconnect', 'Failed']);

    jest.advanceTimersByTime(ALERT_TOAST_LIFETIME_MS - TOAST_LIFETIME_MS - 1);
    expect(getToasts()).toHaveLength(2);

    jest.advanceTimersByTime(1);
    expect(getToasts()).toHaveLength(0);
  });

  it('delays expiry by the time spent paused', () => {
    showToast({ message: 'Paused toast' });
    jest.advanceTimersByTime(60_000);

    setToastExpiryPaused(true);
    jest.advanceTimersByTime(10 * 60_000);
    expect(getToasts()).toHaveLength(1);

    setToastExpiryPaused(false);
    jest.advanceTimersByTime(TOAST_LIFETIME_MS - 60_000 - 1);
    expect(getToasts()).toHaveLength(1);

    jest.advanceTimersByTime(1);
    expect(getToasts()).toHaveLength(0);
  });

  it('merges a same-key repeat into one of the two newest toasts', () => {
    showToast({ message: 'Languages: 10', key: 'languages' });
    showToast({ message: 'Other' });
    jest.advanceTimersByTime(30_000);
    const mergedId = showToast({ message: 'Languages: 12', key: 'languages' });

    const current = getToasts();
    expect(current.map((toast) => toast.message)).toEqual(['Other', 'Languages: 12']);
    expect(current[1]).toMatchObject({ id: mergedId, repeatCount: 2, createdAt: Date.now() });
  });

  it('adds a new entry when the matching key is older than the two newest toasts', () => {
    showToast({ message: 'Languages: 10', key: 'languages' });
    showToast({ message: 'Second' });
    showToast({ message: 'Third' });
    showToast({ message: 'Languages: 12', key: 'languages' });

    const current = getToasts();
    expect(current).toHaveLength(4);
    expect(current.every((toast) => toast.repeatCount === 1)).toBe(true);
  });

  it('merges identical messages without an explicit key', () => {
    showToast({ message: 'Settings updated' });
    showToast({ message: 'Settings updated' });
    showToast({ message: 'Settings updated', tone: 'error' });

    const current = getToasts();
    expect(current).toHaveLength(2);
    expect(current[0].repeatCount).toBe(2);
  });

  it('resets the lifetime of a merged toast', () => {
    showToast({ message: 'Again' });
    jest.advanceTimersByTime(TOAST_LIFETIME_MS - 1_000);
    showToast({ message: 'Again' });

    jest.advanceTimersByTime(TOAST_LIFETIME_MS - 1);
    expect(getToasts()).toHaveLength(1);
    jest.advanceTimersByTime(1);
    expect(getToasts()).toHaveLength(0);
  });

  it('dismisses a toast by id', () => {
    const id = showToast({ message: 'Dismiss me' });
    showToast({ message: 'Keep me' });

    dismissToast(id);
    expect(getToasts().map((toast) => toast.message)).toEqual(['Keep me']);
  });
});
