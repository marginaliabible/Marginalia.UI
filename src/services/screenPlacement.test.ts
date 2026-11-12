import { __resetToastsForTests, getToasts, toastActions } from './toastService';
import {
  SCREEN_PLACEMENT_OFFER_MESSAGE,
  SCREEN_PLACEMENT_SINGLE_DISPLAY_OFFER_MESSAGE,
  __resetScreenPlacementForTests,
  getScreenLayout,
  initScreenPlacement,
  moveToOtherScreen,
  offerScreenPlacement,
  type ScreenDetailsLike,
} from './screenPlacement';

const primary = { left: 0, top: 0, width: 2560, height: 1440, availLeft: 0, availTop: 0, availWidth: 2560, availHeight: 1400 };
const secondary = {
  left: 2560,
  top: 0,
  width: 1920,
  height: 1080,
  availLeft: 2560,
  availTop: 0,
  availWidth: 1920,
  availHeight: 1040,
};
const screenDetails: ScreenDetailsLike = { screens: [primary, secondary], currentScreen: primary };

type Listener = () => void;

function setUpBrowser({ isExtended, state }: { isExtended: boolean | undefined; state: PermissionState }) {
  const listeners = new Set<Listener>();
  const status = {
    state,
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
  };
  const getScreenDetails = jest.fn(async () => {
    if (status.state === 'denied') {
      throw new Error('denied');
    }
    status.state = 'granted';
    return screenDetails;
  });

  Object.defineProperty(window.screen, 'isExtended', { value: isExtended, configurable: true });
  Object.defineProperty(navigator, 'permissions', {
    value: { query: jest.fn(async () => status) },
    configurable: true,
  });
  (window as unknown as { getScreenDetails: typeof getScreenDetails }).getScreenDetails = getScreenDetails;

  return {
    getScreenDetails,
    change(next: PermissionState) {
      status.state = next;
      listeners.forEach((listener) => listener());
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('screenPlacement', () => {
  beforeEach(() => {
    __resetScreenPlacementForTests();
    __resetToastsForTests();
  });

  afterEach(() => {
    __resetScreenPlacementForTests();
    __resetToastsForTests();
    delete (window as unknown as { getScreenDetails?: unknown }).getScreenDetails;
    Object.defineProperty(window.screen, 'isExtended', { value: undefined, configurable: true });
  });

  it('offers a single-display message and does not expose a multi-screen layout', async () => {
    const browser = setUpBrowser({ isExtended: false, state: 'prompt' });
    await initScreenPlacement();
    offerScreenPlacement();

    const toasts = getToasts();
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe(SCREEN_PLACEMENT_SINGLE_DISPLAY_OFFER_MESSAGE);
    expect(getScreenLayout()).toBeNull();
    expect(browser.getScreenDetails).not.toHaveBeenCalled();
  });

  it('stays out of the way outside Chromium, where getScreenDetails is missing', async () => {
    Object.defineProperty(window.screen, 'isExtended', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'permissions', {
      value: { query: jest.fn(async () => ({ state: 'prompt', addEventListener: jest.fn(), removeEventListener: jest.fn() })) },
      configurable: true,
    });
    await initScreenPlacement();
    offerScreenPlacement();
    expect(getToasts()).toEqual([]);
  });

  it('offers once per load and asks the browser only when the user clicks Allow', async () => {
    const browser = setUpBrowser({ isExtended: true, state: 'prompt' });
    await initScreenPlacement();
    const onGranted = jest.fn();

    offerScreenPlacement(onGranted);
    offerScreenPlacement(onGranted);
    const toasts = getToasts();
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe(SCREEN_PLACEMENT_OFFER_MESSAGE);
    expect(toastActions(toasts[0]).map((action) => action.label)).toEqual(['Allow', 'Not now']);
    expect(browser.getScreenDetails).not.toHaveBeenCalled();

    toastActions(toasts[0])[0].onClick();
    await flush();
    expect(browser.getScreenDetails).toHaveBeenCalledTimes(1);
    expect(onGranted).toHaveBeenCalledTimes(1);
    expect(getToasts()).toEqual([]);
    expect(getScreenLayout()).toEqual({
      screens: [
        { availLeft: 0, availTop: 0, availWidth: 2560, availHeight: 1400 },
        { availLeft: 2560, availTop: 0, availWidth: 1920, availHeight: 1040 },
      ],
      other: { availLeft: 2560, availTop: 0, availWidth: 1920, availHeight: 1040 },
    });
  });

  it('falls back to normal placement when the user denies the prompt', async () => {
    const browser = setUpBrowser({ isExtended: true, state: 'prompt' });
    await initScreenPlacement();
    const onGranted = jest.fn();
    offerScreenPlacement(onGranted);

    browser.change('denied');
    toastActions(getToasts()[0])[0].onClick();
    await flush();
    expect(onGranted).not.toHaveBeenCalled();
    expect(getScreenLayout()).toBeNull();
  });

  it('loads the screens without a toast when permission was already granted, and drops them if revoked', async () => {
    const browser = setUpBrowser({ isExtended: true, state: 'granted' });
    await initScreenPlacement();
    await flush();

    offerScreenPlacement();
    expect(getToasts()).toEqual([]);
    expect(getScreenLayout()?.other).toMatchObject({ availLeft: 2560 });

    browser.change('denied');
    expect(getScreenLayout()).toBeNull();
  });

  it('moves a just-opened popup onto the other display', async () => {
    setUpBrowser({ isExtended: true, state: 'granted' });
    await initScreenPlacement();
    await flush();
    const popup = { closed: false, outerWidth: 496, outerHeight: 1200, moveTo: jest.fn(), resizeTo: jest.fn() };

    moveToOtherScreen(popup as unknown as Window);
    expect(popup.moveTo).toHaveBeenCalledWith(2560 + 712, 0);
    expect(popup.resizeTo).toHaveBeenCalledWith(496, 1040);
  });
});
