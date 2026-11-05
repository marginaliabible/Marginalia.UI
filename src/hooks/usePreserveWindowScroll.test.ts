import { renderHook } from '@testing-library/react';
import { usePreserveWindowScrollWhile } from './usePreserveWindowScroll';

describe('usePreserveWindowScrollWhile', () => {
  const originalScrollX = window.scrollX;
  const originalScrollY = window.scrollY;
  let scrollTo: jest.SpyInstance;

  beforeEach(() => {
    Object.defineProperty(window, 'scrollX', { configurable: true, writable: true, value: 0 });
    Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value: 0 });
    scrollTo = jest.spyOn(window, 'scrollTo').mockImplementation((x: number | ScrollToOptions, y?: number) => {
      if (typeof x === 'number') {
        window.scrollX = x;
        window.scrollY = y ?? 0;
        return;
      }
      window.scrollX = x.left ?? window.scrollX;
      window.scrollY = x.top ?? window.scrollY;
    });
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    Object.defineProperty(window, 'scrollX', { configurable: true, writable: true, value: originalScrollX });
    Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value: originalScrollY });
  });

  it('restores the snapshot taken when becoming active', () => {
    window.scrollX = 12;
    window.scrollY = 640;
    const { rerender } = renderHook(({ active }) => usePreserveWindowScrollWhile(active), {
      initialProps: { active: false },
    });

    rerender({ active: true });
    window.scrollY = 0;
    window.scrollX = 0;
    scrollTo.mockClear();

    rerender({ active: false });

    expect(scrollTo).toHaveBeenCalledWith(12, 640);
    expect(window.scrollY).toBe(640);
    expect(window.scrollX).toBe(12);
  });

  it('does not restore when it never became active', () => {
    renderHook(() => usePreserveWindowScrollWhile(false));
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
