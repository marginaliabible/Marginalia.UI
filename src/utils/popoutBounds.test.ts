import {
  POPOUT_BOUNDS_STORAGE_KEY,
  boundsFitScreen,
  readPopoutBounds,
  savePopoutBounds,
  trackPopoutBounds,
  type PopoutBounds,
} from './popoutBounds';

const screenArea = { availLeft: 0, availTop: 0, availWidth: 1920, availHeight: 1040 };

const bounds = (overrides: Partial<PopoutBounds> = {}): PopoutBounds => ({
  left: 1300,
  top: 40,
  width: 480,
  height: 900,
  outerWidth: 496,
  outerHeight: 980,
  ...overrides,
});

describe('popout bounds storage', () => {
  afterEach(() => {
    window.localStorage.removeItem(POPOUT_BOUNDS_STORAGE_KEY);
  });

  it('keeps panel and document bounds separately', () => {
    savePopoutBounds('panel', bounds());
    savePopoutBounds('document', bounds({ left: 100 }));
    expect(readPopoutBounds('panel')).toEqual(bounds());
    expect(readPopoutBounds('document')).toEqual(bounds({ left: 100 }));
  });

  it('ignores missing or malformed entries', () => {
    expect(readPopoutBounds('panel')).toBeNull();
    window.localStorage.setItem(POPOUT_BOUNDS_STORAGE_KEY, '{"panel":{"left":"x"}}');
    expect(readPopoutBounds('panel')).toBeNull();
    window.localStorage.setItem(POPOUT_BOUNDS_STORAGE_KEY, 'not json');
    expect(readPopoutBounds('panel')).toBeNull();
  });
});

describe('boundsFitScreen', () => {
  it('accepts a window entirely on the current screen', () => {
    expect(boundsFitScreen(bounds(), screenArea)).toBe(true);
  });

  it('accepts a maximized window whose borders hang just past the work area', () => {
    expect(boundsFitScreen(bounds({ left: -8, top: -8, outerWidth: 1936, outerHeight: 1056 }), screenArea)).toBe(true);
  });

  it('rejects windows that would land partly or wholly off the current screen', () => {
    expect(boundsFitScreen(bounds({ left: 1600 }), screenArea)).toBe(false);
    expect(boundsFitScreen(bounds({ left: 2200 }), screenArea)).toBe(false);
    expect(boundsFitScreen(bounds({ top: -300 }), screenArea)).toBe(false);
    expect(boundsFitScreen(bounds({ outerHeight: 1200 }), screenArea)).toBe(false);
  });

  it('checks against a secondary screen\'s own coordinates', () => {
    const secondary = { availLeft: 1920, availTop: 0, availWidth: 2560, availHeight: 1400 };
    expect(boundsFitScreen(bounds({ left: 2200 }), secondary)).toBe(true);
    expect(boundsFitScreen(bounds(), secondary)).toBe(false);
  });

  it('rejects implausibly small windows', () => {
    expect(boundsFitScreen(bounds({ width: 120 }), screenArea)).toBe(false);
  });
});

describe('trackPopoutBounds', () => {
  const target = {
    screenX: 100,
    screenY: 50,
    innerWidth: 480,
    innerHeight: 900,
    outerWidth: 496,
    outerHeight: 980,
    listeners: new Map<string, () => void>(),
    addEventListener(type: string, listener: () => void) {
      this.listeners.set(type, listener);
    },
    removeEventListener(type: string) {
      this.listeners.delete(type);
    },
  };

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    window.localStorage.removeItem(POPOUT_BOUNDS_STORAGE_KEY);
  });

  it('saves moves, resizes, and the final bounds when the window closes', () => {
    const stop = trackPopoutBounds('panel', target as unknown as Window);
    jest.advanceTimersByTime(5_000);
    expect(readPopoutBounds('panel')).toBeNull();

    target.screenX = 400;
    jest.advanceTimersByTime(1_000);
    expect(readPopoutBounds('panel')).toMatchObject({ left: 400, top: 50 });

    target.innerWidth = 700;
    target.outerWidth = 716;
    target.listeners.get('resize')?.();
    jest.advanceTimersByTime(300);
    expect(readPopoutBounds('panel')).toMatchObject({ width: 700, outerWidth: 716 });

    target.screenY = 90;
    target.listeners.get('pagehide')?.();
    expect(readPopoutBounds('panel')).toMatchObject({ top: 90 });

    stop();
    expect(target.listeners.size).toBe(0);
    target.screenX = 10;
    jest.advanceTimersByTime(5_000);
    expect(readPopoutBounds('panel')).toMatchObject({ left: 400 });
  });
});
