import type { WindowCommand } from '../models/windowMessages';
import { __resetToastsForTests, getToasts, toastActions, type Toast, type ToastLinkSegment } from './toastService';
import { PANEL_WINDOW_NAME, WindowChannel } from './windowChannel';
import {
  __resetWindowRoutingForTests,
  isInteractionMuted,
  PENDING_COMMAND_KEY,
  routeInteraction,
  takePendingCommand,
} from './windowRouting';
import { FakeWindowBus, fakeWindowTarget } from './testing/fakeWindowBus';

const panelCommand: WindowCommand = {
  kind: 'panel',
  type: 'run-search',
  payload: { query: 'love', action: 'new', translationIds: ['kjv'] },
};

const bibleCommand: WindowCommand = {
  kind: 'bible',
  type: 'go-to-reference',
  payload: { target: { book: 'Romans', chapter: 10, verse: 12 } as never },
};

const documentCommand: WindowCommand = {
  kind: 'document',
  type: 'open-document-link',
  payload: { hash: '#/Romans/10/12?doc=abc&page=2' },
};

const received = (channel: WindowChannel): WindowCommand[] => {
  const commands: WindowCommand[] = [];
  channel.on('command', (message) => commands.push(message.command));
  return commands;
};

const onlyToast = (): Toast => {
  const toasts = getToasts();
  expect(toasts).toHaveLength(1);
  return toasts[0];
};

const actionLabels = (toast: Toast): string[] => toastActions(toast).map((action) => action.label);

const clickAction = (toast: Toast, label: string): void => {
  const action = toastActions(toast).find((entry) => entry.label === label);
  if (!action) {
    throw new Error(`No "${label}" action`);
  }
  action.onClick();
};

const openedTab = () => ({ closed: false, focus: jest.fn(), close: jest.fn() }) as unknown as Window;

describe('routeInteraction', () => {
  let bus: FakeWindowBus;
  let openSpy: jest.SpyInstance<Window | null, Parameters<typeof window.open>>;

  beforeEach(() => {
    bus = new FakeWindowBus();
    openSpy = jest.spyOn(window, 'open').mockReturnValue(null);
    __resetWindowRoutingForTests();
    __resetToastsForTests();
  });

  afterEach(() => {
    openSpy.mockRestore();
    __resetWindowRoutingForTests();
    __resetToastsForTests();
  });

  it('runs locally when the channel is unavailable', () => {
    const applyLocally = jest.fn();
    const channel = new WindowChannel({ id: 'x', type: 'bible', createTransport: () => null });

    expect(routeInteraction(panelCommand, applyLocally, { channel })).toBe('local');
    expect(applyLocally).toHaveBeenCalledTimes(1);
  });

  it('runs locally in a Bible window when it owns the kind or no window does', () => {
    const bible = bus.createWindow('bible');
    const other = bus.createWindow('other');
    const otherCommands = received(other);
    const applyLocally = jest.fn();

    expect(routeInteraction(bibleCommand, applyLocally, { channel: bible })).toBe('local');
    expect(routeInteraction(documentCommand, applyLocally, { channel: bible })).toBe('local');
    expect(routeInteraction(panelCommand, applyLocally, { channel: bible })).toBe('local');
    expect(applyLocally).toHaveBeenCalledTimes(3);
    expect(otherCommands).toEqual([]);
    expect(getToasts()).toEqual([]);
  });

  it('keeps documents and panel interactions in a document window when nothing else owns them', () => {
    bus.createWindow('bible');
    const reader = bus.createWindow('reader', 'document');
    const applyLocally = jest.fn();

    expect(routeInteraction(documentCommand, applyLocally, { channel: reader })).toBe('local');
    expect(routeInteraction(panelCommand, applyLocally, { channel: reader })).toBe('local');
    expect(applyLocally).toHaveBeenCalledTimes(2);
  });

  it('sends panel interactions to the panel window with a link and "Got it!" but no "Move it here"', () => {
    const bible = bus.createWindow('bible');
    const panel = bus.createWindow('panel', 'panel');
    const panelCommands = received(panel);
    const focusRequests = jest.fn();
    panel.on('focus', focusRequests);
    const applyLocally = jest.fn();

    expect(routeInteraction(panelCommand, applyLocally, { channel: bible })).toBe('remote');
    expect(applyLocally).not.toHaveBeenCalled();
    expect(panelCommands).toEqual([panelCommand]);

    const toast = onlyToast();
    expect(toast.message).toBe('Opened in the panel window.');
    expect(actionLabels(toast)).toEqual(['Got it!']);
    expect(focusRequests).toHaveBeenCalledTimes(1);

    (toast.segments?.[1] as ToastLinkSegment).onClick();
    expect(openSpy).not.toHaveBeenCalled();
    expect(focusRequests).toHaveBeenCalledTimes(2);
  });

  it('sends a document window\'s panel interactions to the panel window, offering only "Got it!"', () => {
    const reader = bus.createWindow('reader', 'document');
    const panel = bus.createWindow('panel', 'panel');
    const panelCommands = received(panel);

    expect(routeInteraction(panelCommand, jest.fn(), { channel: reader })).toBe('remote');
    expect(panelCommands).toEqual([panelCommand]);
    expect(actionLabels(onlyToast())).toEqual(['Got it!']);
  });

  it('focuses the panel popup by name, on routing and from the toast link, after the opening tab refreshed', () => {
    const mainTarget = fakeWindowTarget();
    bus.createWindow('bible', 'bible', mainTarget).stop();
    const panel = bus.createWindow('panel', 'panel', fakeWindowTarget(mainTarget));
    const bible = bus.createWindow('bible-2', 'bible', mainTarget);
    const focusRequests = jest.fn();
    panel.on('focus', focusRequests);
    const popup = { closed: false, __marginaliaWindowId: 'panel', focus: jest.fn(), close: jest.fn() };
    openSpy.mockReturnValue(popup as unknown as Window);

    routeInteraction(panelCommand, jest.fn(), { channel: bible });
    expect(openSpy).toHaveBeenCalledWith('', PANEL_WINDOW_NAME);
    expect(popup.focus).toHaveBeenCalledTimes(1);

    (onlyToast().segments?.[1] as ToastLinkSegment).onClick();
    expect(popup.focus).toHaveBeenCalledTimes(2);
    expect(focusRequests).toHaveBeenCalledTimes(2);
  });

  it('focuses a document popup by name from the panel window when the same tab opened both', () => {
    const mainTarget = fakeWindowTarget();
    bus.createWindow('bible', 'bible', mainTarget);
    const panel = bus.createWindow('panel', 'panel', fakeWindowTarget(mainTarget));
    const reader = bus.createWindow('reader', 'document', fakeWindowTarget(mainTarget));
    reader.update({ label: 'Notes' });
    const popup = { closed: false, __marginaliaWindowId: 'reader', focus: jest.fn(), close: jest.fn() };
    openSpy.mockReturnValue(popup as unknown as Window);

    routeInteraction(documentCommand, jest.fn(), { channel: panel });
    expect(onlyToast().message).toBe('Opened in the document window.');
    expect(openSpy).toHaveBeenCalledWith('', reader.getSelf().windowName);
    expect(popup.focus).toHaveBeenCalledTimes(1);
  });

  it('focuses the target even when its toast is muted, but not for silent routing', () => {
    const bible = bus.createWindow('bible');
    const panel = bus.createWindow('panel', 'panel');
    const focusRequests = jest.fn();
    panel.on('focus', focusRequests);

    routeInteraction(panelCommand, jest.fn(), { channel: bible });
    clickAction(onlyToast(), 'Got it!');
    routeInteraction(panelCommand, jest.fn(), { channel: bible });
    expect(focusRequests).toHaveBeenCalledTimes(2);

    routeInteraction(panelCommand, jest.fn(), { channel: bible, silent: true });
    expect(focusRequests).toHaveBeenCalledTimes(2);
  });

  it('focuses without a toast for quiet routing', () => {
    const reader = bus.createWindow('reader', 'document');
    const bible = bus.createWindow('bible');
    const bibleCommands = received(bible);
    const focusRequests = jest.fn();
    bible.on('focus', focusRequests);

    expect(routeInteraction(bibleCommand, jest.fn(), { channel: reader, quiet: true })).toBe('remote');
    expect(bibleCommands).toEqual([bibleCommand]);
    expect(focusRequests).toHaveBeenCalledTimes(1);
    expect(getToasts()).toEqual([]);
  });

  it('offers "Move it here" in a Bible window, closing the document in the document window and opening it here', () => {
    const bible = bus.createWindow('bible');
    const reader = bus.createWindow('reader', 'document');
    reader.update({ label: "Thayer's Greek Lexicon" });
    const closeRequests = jest.fn();
    reader.on('restore-document', closeRequests);
    const applyLocally = jest.fn();

    expect(routeInteraction(documentCommand, applyLocally, { channel: bible })).toBe('remote');
    const toast = onlyToast();
    expect(toast.message).toBe('Opened in the document window.');
    expect(actionLabels(toast)).toEqual(['Move it here', 'Got it!']);

    clickAction(toast, 'Move it here');
    expect(closeRequests).toHaveBeenCalledTimes(1);
    expect(applyLocally).toHaveBeenCalledTimes(1);
    expect(getToasts()).toEqual([]);
  });

  it('never offers "Move it here" in a document window', () => {
    const reader = bus.createWindow('reader', 'document');
    const bible = bus.createWindow('bible');
    const bibleCommands = received(bible);
    const applyLocally = jest.fn();

    expect(routeInteraction(bibleCommand, applyLocally, { channel: reader })).toBe('remote');
    expect(bibleCommands).toEqual([bibleCommand]);
    expect(onlyToast().message).toBe('Opened in the Bible window.');
    expect(actionLabels(onlyToast())).toEqual(['Got it!']);
    expect(applyLocally).not.toHaveBeenCalled();
  });

  it('offers "Move to Bible window" in the panel window for a document that went to a document window', () => {
    const mainTarget = fakeWindowTarget();
    const opener = bus.createWindow('opener', 'bible', mainTarget);
    const panel = bus.createWindow('panel', 'panel', fakeWindowTarget(mainTarget));
    const other = bus.createWindow('other');
    const reader = bus.createWindow('reader', 'document');
    other.markFocused();
    const openerCommands = received(opener);
    const otherCommands = received(other);
    const readerCommands = received(reader);
    const restoreRequests = jest.fn();
    reader.on('restore-document', restoreRequests);
    const openerFocus = jest.fn();
    opener.on('focus', openerFocus);
    const applyLocally = jest.fn();

    expect(routeInteraction(documentCommand, applyLocally, { channel: panel })).toBe('remote');
    expect(readerCommands).toEqual([documentCommand]);
    const toast = onlyToast();
    expect(actionLabels(toast)).toEqual(['Move to Bible window', 'Got it!']);

    clickAction(toast, 'Move to Bible window');
    expect(restoreRequests).toHaveBeenCalledTimes(1);
    expect(openerCommands).toEqual([documentCommand]);
    expect(otherCommands).toEqual([]);
    expect(openerFocus).toHaveBeenCalledTimes(1);
    expect(applyLocally).not.toHaveBeenCalled();
    expect(getToasts()).toEqual([]);
  });

  it('sends a panel-window document to the Bible window that opened the panel when no document window is open', () => {
    const mainTarget = fakeWindowTarget();
    const opener = bus.createWindow('opener', 'bible', mainTarget);
    const panel = bus.createWindow('panel', 'panel', fakeWindowTarget(mainTarget));
    const other = bus.createWindow('other');
    other.markFocused();
    const openerCommands = received(opener);
    const otherCommands = received(other);

    expect(routeInteraction(documentCommand, jest.fn(), { channel: panel })).toBe('remote');
    expect(openerCommands).toEqual([documentCommand]);
    expect(otherCommands).toEqual([]);
    expect(onlyToast().message).toBe('Opened in the Bible window.');
    expect(actionLabels(onlyToast())).toEqual(['Got it!']);
  });

  it('falls back to the most recently focused Bible window once the panel\'s opener is gone', () => {
    const mainTarget = fakeWindowTarget();
    const opener = bus.createWindow('opener', 'bible', mainTarget);
    const panel = bus.createWindow('panel', 'panel', fakeWindowTarget(mainTarget));
    const first = bus.createWindow('first');
    const second = bus.createWindow('second');
    mainTarget.closed = true;
    opener.stop();
    first.markFocused();
    second.markFocused();
    const secondCommands = received(second);

    expect(routeInteraction(documentCommand, jest.fn(), { channel: panel })).toBe('remote');
    expect(secondCommands).toEqual([documentCommand]);
  });

  it('names the target by its label when several Bible windows are open', () => {
    const reader = bus.createWindow('reader', 'document');
    reader.update({ label: 'Notes' });
    const romans = bus.createWindow('romans');
    romans.update({ label: 'Romans 10:12' });
    const john = bus.createWindow('john');
    john.update({ label: 'John 3:16' });
    const romansCommands = received(romans);
    const johnCommands = received(john);

    john.markFocused();
    romans.markFocused();
    routeInteraction(bibleCommand, jest.fn(), { channel: reader });

    expect(romansCommands).toEqual([bibleCommand]);
    expect(johnCommands).toEqual([]);
    expect(onlyToast().message).toBe('Opened in the Romans 10:12 window.');
  });

  it('sends documents to the most recently focused document window, named by title when several are open', () => {
    const bible = bus.createWindow('bible');
    const lexicon = bus.createWindow('lexicon', 'document');
    lexicon.update({ label: "Thayer's Greek Lexicon" });
    const notes = bus.createWindow('notes', 'document');
    notes.update({ label: 'Notes' });
    const lexiconCommands = received(lexicon);
    notes.markFocused();
    lexicon.markFocused();

    routeInteraction(documentCommand, jest.fn(), { channel: bible });
    expect(lexiconCommands).toEqual([documentCommand]);
    expect(onlyToast().message).toBe("Opened in the Thayer's Greek Lexicon window.");
  });

  it('never sends Bible interactions to a document window; opens a new Bible tab instead', () => {
    const reader = bus.createWindow('reader', 'document');
    const panel = bus.createWindow('panel', 'panel');
    const readerCommands = received(reader);
    openSpy.mockReturnValue(openedTab());

    expect(routeInteraction(bibleCommand, jest.fn(), { channel: panel })).toBe('new-window');
    expect(readerCommands).toEqual([]);
    expect(openSpy).toHaveBeenCalledWith(expect.stringMatching(/#\/Romans\/10\/12$/), '_blank');
    expect(getToasts()).toEqual([]);
  });

  it('opens a new Bible tab from a document window rather than showing the Bible there', () => {
    const reader = bus.createWindow('reader', 'document');
    const applyLocally = jest.fn();
    openSpy.mockReturnValue(openedTab());

    const showVerses: WindowCommand = {
      kind: 'bible',
      type: 'show-verses',
      payload: { context: { book: 'John', chapter: 3, verse: 16, verses: [16, 17] } },
    };
    expect(routeInteraction(showVerses, applyLocally, { channel: reader })).toBe('new-window');
    expect(applyLocally).not.toHaveBeenCalled();
    expect(openSpy).toHaveBeenCalledWith(expect.stringMatching(/#\/John\/3\/16$/), '_blank');
  });

  it('hands an open-document command to the new Bible tab through sessionStorage', () => {
    const panel = bus.createWindow('panel', 'panel');
    const openDocument: WindowCommand = {
      kind: 'document',
      type: 'open-document',
      payload: { sourceUrl: 'https://example.com/notes.pdf', title: 'Notes', kind: 'pdf' },
    };
    let carried: string | null = null;
    openSpy.mockImplementation(() => {
      carried = window.sessionStorage.getItem(PENDING_COMMAND_KEY);
      return openedTab();
    });

    expect(routeInteraction(openDocument, jest.fn(), { channel: panel })).toBe('new-window');
    expect(JSON.parse(carried as unknown as string)).toEqual(openDocument);
    expect(window.sessionStorage.getItem(PENDING_COMMAND_KEY)).toBeNull();

    window.sessionStorage.setItem(PENDING_COMMAND_KEY, JSON.stringify(openDocument));
    expect(takePendingCommand()).toEqual(openDocument);
    expect(takePendingCommand()).toBeNull();
  });

  it('sends Ctrl+K from a sub-window to the Bible window\'s search box, or carries it to a new Bible tab', () => {
    const panel = bus.createWindow('panel', 'panel');
    const reader = bus.createWindow('reader', 'document');
    const focusSearch: WindowCommand = { kind: 'bible', type: 'focus-search' };
    let carried: string | null = null;
    openSpy.mockImplementation(() => {
      carried = window.sessionStorage.getItem(PENDING_COMMAND_KEY);
      return openedTab();
    });

    expect(routeInteraction(focusSearch, jest.fn(), { channel: reader, quiet: true })).toBe('new-window');
    expect(JSON.parse(carried as unknown as string)).toEqual(focusSearch);

    const bible = bus.createWindow('bible');
    const bibleCommands = received(bible);
    expect(routeInteraction(focusSearch, jest.fn(), { channel: panel, quiet: true })).toBe('remote');
    expect(bibleCommands).toEqual([focusSearch]);
    expect(getToasts()).toEqual([]);
  });

  it('sends Find in Account Sync from a document window to the Bible window, or carries it to a new Bible tab', () => {
    const reader = bus.createWindow('reader', 'document');
    const reveal: WindowCommand = {
      kind: 'bible',
      type: 'reveal-account-sync',
      payload: { kind: 'cloud', provider: 'google', itemId: 'file-1' },
    };
    let carried: string | null = null;
    openSpy.mockImplementation(() => {
      carried = window.sessionStorage.getItem(PENDING_COMMAND_KEY);
      return openedTab();
    });

    expect(routeInteraction(reveal, jest.fn(), { channel: reader, quiet: true })).toBe('new-window');
    expect(JSON.parse(carried as unknown as string)).toEqual(reveal);

    const bible = bus.createWindow('bible');
    const bibleCommands = received(bible);
    expect(routeInteraction(reveal, jest.fn(), { channel: reader, quiet: true })).toBe('remote');
    expect(bibleCommands).toEqual([reveal]);
    expect(getToasts()).toEqual([]);
  });

  it('mutes each kind independently with "Got it!"', () => {
    const bible = bus.createWindow('bible');
    bus.createWindow('panel', 'panel');
    const reader = bus.createWindow('reader', 'document');
    reader.update({ label: 'Notes' });

    routeInteraction(panelCommand, jest.fn(), { channel: bible });
    clickAction(onlyToast(), 'Got it!');
    expect(isInteractionMuted('panel')).toBe(true);
    expect(getToasts()).toEqual([]);

    expect(routeInteraction(panelCommand, jest.fn(), { channel: bible })).toBe('remote');
    expect(getToasts()).toEqual([]);

    routeInteraction(documentCommand, jest.fn(), { channel: bible });
    expect(onlyToast().key).toBe('window-route:document');
    expect(isInteractionMuted('document')).toBe(false);
  });

  it('never toasts for silent routing', () => {
    const bible = bus.createWindow('bible');
    const panel = bus.createWindow('panel', 'panel');
    const panelCommands = received(panel);

    expect(routeInteraction(panelCommand, jest.fn(), { channel: bible, silent: true })).toBe('remote');
    expect(panelCommands).toEqual([panelCommand]);
    expect(getToasts()).toEqual([]);
  });

  it('queues Bible interactions while the Bible window refreshes and delivers them to it, not to a document window', () => {
    const panel = bus.createWindow('panel', 'panel');
    const reader = bus.createWindow('reader', 'document');
    const readerCommands = received(reader);
    bus.createWindow('bible').stop();
    const applyLocally = jest.fn();

    expect(routeInteraction(bibleCommand, applyLocally, { channel: panel })).toBe('queued');
    expect(applyLocally).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();

    const bible = new WindowChannel({
      id: 'bible-2',
      type: 'bible',
      createTransport: bus.createTransport,
      now: bus.now,
    });
    const bibleCommands = received(bible);
    bible.start();

    expect(bibleCommands).toEqual([bibleCommand]);
    expect(readerCommands).toEqual([]);
    expect(getToasts()).toEqual([]);

    bus.createWindow('second');
    expect(bibleCommands).toHaveLength(1);
  });
});
