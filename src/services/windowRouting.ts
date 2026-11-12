import { dismissToast, showToast, type ToastAction } from './toastService';
import { windowChannel, type WindowChannel } from './windowChannel';
import { buildHashRoute } from '../App';
import type { InteractionKind, WindowCommand, WindowInfo, WindowRole } from '../models/windowMessages';

type RoutingChannel = Pick<
  WindowChannel,
  'isAvailable' | 'getSelf' | 'getWindows' | 'subscribe' | 'post' | 'focusWindow' | 'recentlyDeparted'
>;

export type RouteOutcome = 'local' | 'remote' | 'queued' | 'new-window';

export interface RouteOptions {
  /** Commands replayed from another window never toast or take focus; only the window the user acted in does. */
  silent?: boolean;
  /** Focuses the target without a toast, e.g. Ctrl+K reaching for the Bible window's search box. */
  quiet?: boolean;
  channel?: RoutingChannel;
}

const TYPE_WINDOW_NOUN: Record<WindowRole, string> = {
  bible: 'Bible window',
  document: 'document window',
  panel: 'panel window',
};

/** A Bible window that left this recently is probably refreshing, so its interactions wait for it. */
export const BIBLE_REFRESH_GRACE_MS = 5_000;
export const PENDING_COMMAND_KEY = 'marginalia:pending-command';

const mutedKinds = new Set<InteractionKind>();
const knownWindowRefs = new Set<Window>();
let pendingCommands: WindowCommand[] = [];
let stopPendingWatch: (() => void) | null = null;

export function isInteractionMuted(kind: InteractionKind): boolean {
  return mutedKinds.has(kind);
}

/** A window this one opened (a panel, document popup, or Bible tab), so the toast link can focus it directly. */
export function registerWindowRef(ref: Window | null): void {
  if (ref) {
    knownWindowRefs.add(ref);
  }
}

const mostRecentlyFocused = (windows: readonly WindowInfo[]): WindowInfo | null => (
  windows.reduce<WindowInfo | null>(
    (best, entry) => (!best || entry.lastFocusedAt > best.lastFocusedAt ? entry : best),
    null
  )
);

export const mostRecentWindowOfType = (
  type: WindowRole,
  channel: Pick<RoutingChannel, 'getWindows'> = windowChannel
): WindowInfo | null => mostRecentlyFocused(channel.getWindows().filter((entry) => entry.type === type));

/** The window that opened this one when it has the given type, otherwise the most recently focused one. */
export const openerOrMostRecentWindowOfType = (
  type: WindowRole,
  channel: Pick<RoutingChannel, 'getWindows' | 'getSelf'> = windowChannel
): WindowInfo | null => {
  const { openerId } = channel.getSelf();
  const opener = openerId
    ? channel.getWindows().find((entry) => entry.id === openerId && entry.type === type)
    : undefined;
  return opener ?? mostRecentWindowOfType(type, channel);
};

const focusCandidates = (): Window[] => {
  const candidates = Array.from(knownWindowRefs).filter((ref) => {
    try {
      return !ref.closed;
    } catch {
      return false;
    }
  });
  if (typeof window !== 'undefined' && window.opener) {
    candidates.push(window.opener as Window);
  }
  return candidates;
};

/** Call synchronously from a click handler. */
export function focusChannelWindow(id: string, channel: RoutingChannel = windowChannel): void {
  channel.focusWindow(id, focusCandidates());
}

const bibleRouteFor = (command: WindowCommand): string => {
  switch (command.type) {
    case 'show-verses': {
      const { context } = command.payload;
      const verse = context.verses?.[0] ?? context.verse;
      return buildHashRoute({ book: context.book, chapter: context.chapter, verse }, true);
    }
    case 'go-to-reference':
      return buildHashRoute(command.payload.target, true);
    case 'open-document-link':
      return command.payload.hash;
    default:
      return '';
  }
};

/** Popups and tabs opened with `window.open` inherit sessionStorage, which carries what the URL can't. */
export function takePendingCommand(): WindowCommand | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_COMMAND_KEY);
    window.sessionStorage.removeItem(PENDING_COMMAND_KEY);
    return raw ? JSON.parse(raw) as WindowCommand : null;
  } catch {
    return null;
  }
}

/**
 * Opens a new Bible tab for an interaction that needs one when none is open. Call synchronously from a
 * click: browsers only allow `window.open` during a user gesture.
 */
export function openBibleWindow(command: WindowCommand): Window | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const route = bibleRouteFor(command);
  const carriesCommand = command.type === 'open-document'
    || command.type === 'focus-search'
    || command.type === 'reveal-account-sync';
  let opened: Window | null = null;
  try {
    if (carriesCommand) {
      window.sessionStorage.setItem(PENDING_COMMAND_KEY, JSON.stringify(command));
    }
    opened = window.open(`${window.location.pathname}${window.location.search}${route || '#/'}`, '_blank');
  } catch {
    opened = null;
  } finally {
    if (carriesCommand) {
      try {
        window.sessionStorage.removeItem(PENDING_COMMAND_KEY);
      } catch {
        // Storage unavailable.
      }
    }
  }
  registerWindowRef(opened);
  return opened;
}

const describeTarget = (target: WindowInfo, windowsOfType: number): string => (
  target.type !== 'panel' && windowsOfType > 1 && target.label
    ? `${target.label} window`
    : TYPE_WINDOW_NOUN[target.type]
);

function showRoutedToast(
  command: WindowCommand,
  target: WindowInfo,
  applyLocally: () => void,
  channel: RoutingChannel
): void {
  const { kind } = command;
  const self = channel.getSelf();
  const windowsOfType = channel.getWindows().filter((entry) => entry.type === target.type).length;
  const noun = describeTarget(target, windowsOfType);
  const key = `window-route:${kind}`;
  let toastId = '';

  const actions: ToastAction[] = [];
  if (kind === 'document' && self.type === 'bible') {
    actions.push({
      label: 'Move it here',
      onClick: () => {
        dismissToast(toastId);
        channel.post({ type: 'restore-document', to: target.id });
        applyLocally();
      },
    });
  } else if (kind === 'document' && self.type === 'panel' && target.type === 'document') {
    const bibleWindow = openerOrMostRecentWindowOfType('bible', channel);
    if (bibleWindow) {
      actions.push({
        label: 'Move to Bible window',
        onClick: () => {
          dismissToast(toastId);
          channel.post({ type: 'restore-document', to: target.id });
          channel.post({ type: 'command', to: bibleWindow.id, command });
          focusChannelWindow(bibleWindow.id, channel);
        },
      });
    }
  }
  actions.push({
    label: 'Got it!',
    onClick: () => {
      mutedKinds.add(kind);
      dismissToast(toastId);
    },
  });

  toastId = showToast({
    key,
    message: `Opened in the ${noun}.`,
    segments: ['Opened in the ', { text: noun, onClick: () => focusChannelWindow(target.id, channel) }, '.'],
    actions,
  });
}

function watchForBibleWindow(channel: RoutingChannel): void {
  if (stopPendingWatch) {
    return;
  }

  const flush = () => {
    const bibleWindow = mostRecentWindowOfType('bible', channel);
    if (!bibleWindow) {
      return;
    }

    const queued = pendingCommands;
    pendingCommands = [];
    stopPendingWatch?.();
    stopPendingWatch = null;
    for (const command of queued) {
      channel.post({ type: 'command', to: bibleWindow.id, command });
    }
  };

  stopPendingWatch = channel.subscribe(flush);
}

type Resolution =
  | { to: 'local' }
  | { to: 'window'; target: WindowInfo }
  | { to: 'missing-bible' };

/**
 * Window types are fixed. A Bible window acts as the fallback for all three kinds; Document and Panel
 * windows only ever handle their own kind, so anything Bible-bound leaves them.
 */
function resolveTarget(kind: InteractionKind, channel: RoutingChannel): Resolution {
  const self = channel.getSelf();
  if (self.type === kind) {
    return { to: 'local' };
  }

  const owner = mostRecentWindowOfType(kind, channel);
  if (owner) {
    return { to: 'window', target: owner };
  }

  if (kind === 'panel' || self.type === 'bible') {
    return { to: 'local' };
  }

  // A document from the panel window belongs to the Bible window that opened the panel.
  const bibleWindow = kind === 'document' ? openerOrMostRecentWindowOfType('bible', channel) : null;
  return bibleWindow ? { to: 'window', target: bibleWindow } : { to: 'missing-bible' };
}

/**
 * Runs an interaction here when this window handles its kind; otherwise posts it to the window that does
 * and offers the actions that fit this window's type. With no Bible window left, Bible-bound interactions
 * from Document and Panel windows open a new Bible tab (or wait for one that is refreshing).
 */
export function routeInteraction(
  command: WindowCommand,
  applyLocally: () => void,
  { silent = false, quiet = false, channel = windowChannel }: RouteOptions = {}
): RouteOutcome {
  if (!channel.isAvailable) {
    if (channel.getSelf().type === 'document' && command.kind === 'bible') {
      return silent || !openBibleWindow(command) ? 'queued' : 'new-window';
    }
    applyLocally();
    return 'local';
  }

  const resolution = resolveTarget(command.kind, channel);
  if (resolution.to === 'local') {
    applyLocally();
    return 'local';
  }

  if (resolution.to === 'missing-bible') {
    if (silent || channel.recentlyDeparted('bible', BIBLE_REFRESH_GRACE_MS) || !openBibleWindow(command)) {
      pendingCommands.push(command);
      watchForBibleWindow(channel);
      return 'queued';
    }
    return 'new-window';
  }

  const { target } = resolution;
  channel.post({ type: 'command', to: target.id, command });
  if (!silent) {
    // Still inside (or just after) the user's click, while the browser allows focusing another window.
    focusChannelWindow(target.id, channel);
    if (!quiet && !mutedKinds.has(command.kind)) {
      showRoutedToast(command, target, applyLocally, channel);
    }
  }
  return 'remote';
}

export function __resetWindowRoutingForTests(): void {
  mutedKinds.clear();
  knownWindowRefs.clear();
  pendingCommands = [];
  stopPendingWatch?.();
  stopPendingWatch = null;
}
