import { focusWhenWindowActive } from './focusWhenWindowActive';

describe('focusWhenWindowActive', () => {
  let hasFocus: jest.SpyInstance<boolean, []>;
  let windowFocus: jest.SpyInstance<void, []>;

  beforeEach(() => {
    jest.useFakeTimers();
    hasFocus = jest.spyOn(document, 'hasFocus');
    windowFocus = jest.spyOn(window, 'focus').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    hasFocus.mockRestore();
    windowFocus.mockRestore();
  });

  it('focuses right away when the page already has keyboard focus', () => {
    hasFocus.mockReturnValue(true);
    const focusTarget = jest.fn();

    focusWhenWindowActive(focusTarget);
    jest.advanceTimersByTime(5_000);

    expect(focusTarget).toHaveBeenCalledTimes(1);
    expect(windowFocus).not.toHaveBeenCalled();
  });

  it('focuses the page itself and retries until it has keyboard focus', () => {
    hasFocus.mockReturnValue(false);
    const focusTarget = jest.fn();

    focusWhenWindowActive(focusTarget);
    expect(focusTarget).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(100);
    expect(windowFocus).toHaveBeenCalledTimes(1);
    expect(focusTarget).toHaveBeenCalledTimes(2);

    hasFocus.mockReturnValue(true);
    jest.advanceTimersByTime(300);
    expect(focusTarget).toHaveBeenCalledTimes(3);
    jest.advanceTimersByTime(5_000);
    expect(focusTarget).toHaveBeenCalledTimes(3);
  });

  it('focuses the target when the window gains focus, then stops', () => {
    hasFocus.mockReturnValue(false);
    const focusTarget = jest.fn();

    focusWhenWindowActive(focusTarget);
    window.dispatchEvent(new Event('focus'));
    expect(focusTarget).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(5_000);
    window.dispatchEvent(new Event('focus'));
    expect(focusTarget).toHaveBeenCalledTimes(2);
    expect(windowFocus).not.toHaveBeenCalled();
  });

  it('gives up after a few seconds', () => {
    hasFocus.mockReturnValue(false);
    const focusTarget = jest.fn();

    focusWhenWindowActive(focusTarget);
    jest.advanceTimersByTime(3_000);
    const calls = focusTarget.mock.calls.length;
    window.dispatchEvent(new Event('focus'));
    expect(focusTarget).toHaveBeenCalledTimes(calls);
  });
});
