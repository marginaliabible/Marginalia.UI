import type { WindowInfo } from '../models/windowMessages';
import { DOCUMENT_WINDOW_NAME_PREFIX, PANEL_WINDOW_NAME, WindowChannel, watchForLastRegularWindow } from './windowChannel';
import { FakeWindowBus, fakeWindowTarget } from './testing/fakeWindowBus';

const ids = (channel: WindowChannel): string[] => channel.getWindows().map((entry) => entry.id).sort();

describe('WindowChannel registry', () => {
  it('is unavailable without a BroadcastChannel transport', () => {
    const channel = new WindowChannel({ id: 'solo', type: 'bible', createTransport: () => null });
    channel.start();
    expect(channel.isAvailable).toBe(false);
    expect(channel.getWindows()).toEqual([]);
  });

  it('learns about windows from hello, announce, and bye', () => {
    const bus = new FakeWindowBus();
    const bible = bus.createWindow('bible');
    const panel = bus.createWindow('panel', 'panel');

    expect(ids(bible)).toEqual(['panel']);
    expect(ids(panel)).toEqual(['bible']);
    expect(bible.getWindows()[0]).toMatchObject({ type: 'panel' });

    bible.update({ label: 'Romans 10:12' });
    expect(panel.getWindows()[0]).toMatchObject({ type: 'bible', label: 'Romans 10:12' });

    bible.stop();
    expect(panel.getWindows()).toEqual([]);
  });

  it('only announces label changes', () => {
    const bus = new FakeWindowBus();
    const bible = bus.createWindow('bible');
    const other = bus.createWindow('other');
    const listener = jest.fn();
    other.subscribe(listener);

    bible.update({ label: null });
    expect(listener).not.toHaveBeenCalled();

    bible.update({ label: 'Romans 10:12' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('ignores messages addressed to another window', () => {
    const bus = new FakeWindowBus();
    const sender = bus.createWindow('sender');
    const first = bus.createWindow('first');
    const second = bus.createWindow('second');
    const firstHandler = jest.fn();
    const secondHandler = jest.fn();
    first.on('restore-document', firstHandler);
    second.on('restore-document', secondHandler);

    sender.post({ type: 'restore-document', to: 'second' });
    expect(firstHandler).not.toHaveBeenCalled();
    expect(secondHandler).toHaveBeenCalledWith(expect.objectContaining({ from: 'sender', to: 'second' }));
  });

  it('tracks focus order through announcements', () => {
    const bus = new FakeWindowBus();
    const panel = bus.createWindow('panel', 'panel');
    const first = bus.createWindow('first');
    const second = bus.createWindow('second');

    second.markFocused();
    first.markFocused();
    const focusedAt = Object.fromEntries(panel.getWindows().map((entry) => [entry.id, entry.lastFocusedAt]));
    expect(focusedAt['first']).toBeGreaterThan(focusedAt['second']);
  });

  it('names each window after its type, keeping the panel popup name', () => {
    const bus = new FakeWindowBus();
    const bible = bus.createWindow('bible');
    const panel = bus.createWindow('panel', 'panel');
    const reader = bus.createWindow('reader', 'document');

    expect(bible.getSelf().windowName).toBe('marginalia-tab-bible');
    expect(panel.getSelf().windowName).toBe(PANEL_WINDOW_NAME);
    expect(reader.getSelf().windowName).toBe(`${DOCUMENT_WINDOW_NAME_PREFIX}reader`);
    expect(bible.getWindows()[0]).toMatchObject({ id: 'panel', windowName: PANEL_WINDOW_NAME });
  });

  it('remembers which window types recently left, e.g. to wait out a refresh', () => {
    const bus = new FakeWindowBus();
    const panel = bus.createWindow('panel', 'panel');
    const bible = bus.createWindow('bible');

    expect(panel.recentlyDeparted('bible', 5)).toBe(false);
    bible.stop();
    expect(panel.recentlyDeparted('bible', 5)).toBe(true);
    expect(panel.recentlyDeparted('document', 5)).toBe(false);
    for (let tick = 0; tick < 10; tick += 1) {
      bus.now();
    }
    expect(panel.recentlyDeparted('bible', 5)).toBe(false);
  });

  it('sets window.name when started on a window', () => {
    const bus = new FakeWindowBus();
    const channel = new WindowChannel({ id: 'tab', type: 'bible', createTransport: bus.createTransport });
    try {
      channel.start(window);
      expect(window.name).toBe('marginalia-tab-tab');
      expect(window.__marginaliaWindowId).toBe('tab');
    } finally {
      channel.stop();
      window.name = '';
      delete window.__marginaliaWindowId;
    }
  });
});

describe('WindowChannel.focusWindow', () => {
  let openSpy: jest.SpyInstance<Window | null, Parameters<typeof window.open>>;

  const fakeWindow = (overrides: Partial<Record<'__marginaliaWindowId' | 'href', string>> = {}) => ({
    closed: false,
    __marginaliaWindowId: overrides.__marginaliaWindowId,
    location: { href: overrides.href ?? 'http://localhost/#/Romans/10' },
    focus: jest.fn(),
    close: jest.fn(),
  });

  beforeEach(() => {
    openSpy = jest.spyOn(window, 'open').mockReturnValue(null);
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  it('falls back to a matching reference and always asks the window to focus itself', () => {
    const bus = new FakeWindowBus();
    const caller = bus.createWindow('caller');
    const target = bus.createWindow('target');
    const focusRequests = jest.fn();
    target.on('focus', focusRequests);
    const match = fakeWindow({ __marginaliaWindowId: 'target' });
    const other = fakeWindow({ __marginaliaWindowId: 'someone-else' });

    caller.focusWindow('target', [other as unknown as Window, match as unknown as Window, null]);

    expect(openSpy).toHaveBeenCalledWith('', 'marginalia-tab-target');
    expect(match.focus).toHaveBeenCalledTimes(1);
    expect(other.focus).not.toHaveBeenCalled();
    expect(focusRequests).toHaveBeenCalledTimes(1);
  });

  it('recovers the panel popup by name when the caller vouches for it after a refresh', () => {
    const bus = new FakeWindowBus();
    const bible = bus.createWindow('bible');
    const panel = bus.createWindow('panel', 'panel');
    const focusRequests = jest.fn();
    panel.on('focus', focusRequests);
    const popup = fakeWindow({ __marginaliaWindowId: 'panel' });
    openSpy.mockReturnValue(popup as unknown as Window);

    bible.focusWindow('panel', [], { reachableByName: true });

    expect(openSpy).toHaveBeenCalledWith('', PANEL_WINDOW_NAME);
    expect(popup.focus).toHaveBeenCalledTimes(1);
    expect(popup.close).not.toHaveBeenCalled();
    expect(focusRequests).toHaveBeenCalledTimes(1);
  });

  it('activates the opener tab by name rather than through its reference', () => {
    const bus = new FakeWindowBus();
    const bible = bus.createWindow('bible');
    const panel = bus.createWindow('panel', 'panel');
    const opener = fakeWindow({ __marginaliaWindowId: 'bible' });
    const named = fakeWindow({ __marginaliaWindowId: 'bible' });
    openSpy.mockReturnValue(named as unknown as Window);

    panel.focusWindow('bible', [opener as unknown as Window]);

    expect(openSpy).toHaveBeenCalledWith('', bible.getSelf().windowName);
    expect(named.focus).toHaveBeenCalledTimes(1);
    expect(opener.focus).not.toHaveBeenCalled();
  });

  it('closes the blank window a missed lookup opens', () => {
    const bus = new FakeWindowBus();
    const bible = bus.createWindow('bible');
    bus.createWindow('panel', 'panel');
    const blank = fakeWindow({ href: 'about:blank' });
    openSpy.mockReturnValue(blank as unknown as Window);

    bible.focusWindow('panel', [], { reachableByName: true });

    expect(blank.close).toHaveBeenCalledTimes(1);
    expect(blank.focus).not.toHaveBeenCalled();
  });

  it('leaves a named window that is still loading open', () => {
    const bus = new FakeWindowBus();
    const bible = bus.createWindow('bible');
    bus.createWindow('panel', 'panel');
    const loading = fakeWindow();
    openSpy.mockReturnValue(loading as unknown as Window);

    bible.focusWindow('panel', [], { reachableByName: true });

    expect(loading.close).not.toHaveBeenCalled();
    expect(loading.focus).not.toHaveBeenCalled();
  });

  it('lets windows opened by the same tab find each other by name', () => {
    const bus = new FakeWindowBus();
    const mainTarget = fakeWindowTarget();
    bus.createWindow('main', 'bible', mainTarget);
    const panel = bus.createWindow('panel', 'panel', fakeWindowTarget(mainTarget));
    const reader = bus.createWindow('reader', 'document', fakeWindowTarget(mainTarget));
    const named = fakeWindow({ __marginaliaWindowId: 'reader' });
    openSpy.mockReturnValue(named as unknown as Window);

    expect(panel.getSelf().openerId).toBe('main');
    panel.focusWindow('reader');

    expect(openSpy).toHaveBeenCalledWith('', reader.getSelf().windowName);
    expect(named.focus).toHaveBeenCalledTimes(1);
  });

  it('learns the opener\'s new id after it refreshes, so the opener can still reach its popup', () => {
    const bus = new FakeWindowBus();
    const mainTarget = fakeWindowTarget();
    const main = bus.createWindow('main', 'bible', mainTarget);
    const panel = bus.createWindow('panel', 'panel', fakeWindowTarget(mainTarget));

    main.stop();
    const refreshed = bus.createWindow('main-2', 'bible', mainTarget);

    expect(panel.getSelf().openerId).toBe('main-2');
    expect(refreshed.getWindows().find((entry) => entry.id === 'panel')?.openerId).toBe('main-2');
    refreshed.focusWindow('panel');
    expect(openSpy).toHaveBeenCalledWith('', PANEL_WINDOW_NAME);
  });

  it('keeps sibling popups linked after their opener closes', () => {
    const bus = new FakeWindowBus();
    const mainTarget = fakeWindowTarget();
    const main = bus.createWindow('main', 'bible', mainTarget);
    const panel = bus.createWindow('panel', 'panel', fakeWindowTarget(mainTarget));
    const reader = bus.createWindow('reader', 'document', fakeWindowTarget(mainTarget));

    mainTarget.closed = true;
    main.stop();
    reader.update({ label: 'Notes' });
    panel.focusWindow('reader');

    expect(panel.getSelf().openerId).toBe('main');
    expect(openSpy).toHaveBeenCalledWith('', reader.getSelf().windowName);
  });

  it('never opens a window for targets missing from the registry, unreachable by name, or itself', () => {
    const bus = new FakeWindowBus();
    const bible = bus.createWindow('bible');
    const panel = bus.createWindow('panel', 'panel');
    const focusRequests = jest.fn();
    panel.on('focus', focusRequests);

    bible.focusWindow('ghost', [], { reachableByName: true });
    bible.focusWindow('panel');
    bible.focusWindow('bible', [], { reachableByName: true });

    expect(openSpy).not.toHaveBeenCalled();
    expect(focusRequests).toHaveBeenCalledTimes(1);
  });
});

describe('watchForLastRegularWindow', () => {
  const GRACE = 10_000;
  const CONFIRM = 1_500;

  const regular = (id: string): WindowInfo => ({
    id,
    type: 'bible',
    lastFocusedAt: 0,
    label: null,
    windowName: `marginalia-tab-${id}`,
    openerId: null,
  });

  function createRegistry(initial: WindowInfo[]) {
    let windows = initial;
    const listeners = new Set<() => void>();
    return {
      getWindows: () => windows,
      getSelf: (): WindowInfo => ({
        id: 'panel',
        type: 'panel',
        lastFocusedAt: 0,
        label: null,
        windowName: PANEL_WINDOW_NAME,
        openerId: null,
      }),
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      post: jest.fn(),
      set(next: WindowInfo[]) {
        windows = next;
        listeners.forEach((listener) => listener());
      },
    };
  }

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('closes after the grace period and a final roll call once the last regular tab is gone', () => {
    const registry = createRegistry([regular('a')]);
    const onGone = jest.fn();
    watchForLastRegularWindow(registry, { onGone, graceMs: GRACE, confirmMs: CONFIRM });

    jest.advanceTimersByTime(GRACE * 5);
    expect(onGone).not.toHaveBeenCalled();

    registry.set([]);
    jest.advanceTimersByTime(GRACE - 1);
    expect(registry.post).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(registry.post).toHaveBeenCalledWith(expect.objectContaining({ type: 'hello' }));
    expect(onGone).not.toHaveBeenCalled();

    jest.advanceTimersByTime(CONFIRM);
    expect(onGone).toHaveBeenCalledTimes(1);
  });

  it('stays open when a regular tab refreshes within the grace period', () => {
    const registry = createRegistry([regular('a')]);
    const onGone = jest.fn();
    watchForLastRegularWindow(registry, { onGone, graceMs: GRACE, confirmMs: CONFIRM });

    registry.set([]);
    jest.advanceTimersByTime(GRACE - 1_000);
    registry.set([regular('a')]);
    jest.advanceTimersByTime(GRACE + CONFIRM);
    expect(onGone).not.toHaveBeenCalled();
  });

  it('stays open when several tabs refresh and only one comes back in time', () => {
    const registry = createRegistry([regular('a'), regular('b')]);
    const onGone = jest.fn();
    watchForLastRegularWindow(registry, { onGone, graceMs: GRACE, confirmMs: CONFIRM });

    registry.set([regular('b')]);
    registry.set([]);
    jest.advanceTimersByTime(GRACE - 1);
    registry.set([regular('b')]);
    jest.advanceTimersByTime(GRACE * 3);
    expect(onGone).not.toHaveBeenCalled();
  });

  it('stays open when a tab answers the final roll call', () => {
    const registry = createRegistry([]);
    const onGone = jest.fn();
    watchForLastRegularWindow(registry, { onGone, graceMs: GRACE, confirmMs: CONFIRM });

    jest.advanceTimersByTime(GRACE);
    registry.set([regular('a')]);
    jest.advanceTimersByTime(CONFIRM);
    expect(onGone).not.toHaveBeenCalled();
  });

  it('stops watching once cleaned up', () => {
    const registry = createRegistry([]);
    const onGone = jest.fn();
    const stop = watchForLastRegularWindow(registry, { onGone, graceMs: GRACE, confirmMs: CONFIRM });

    stop();
    jest.advanceTimersByTime(GRACE + CONFIRM);
    expect(onGone).not.toHaveBeenCalled();
  });
});
