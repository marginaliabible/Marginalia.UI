import { useSyncExternalStore } from 'react';
import { PANEL_POPOUT_VALUE, parsePopoutFromHash } from '../App';
import type {
  ChannelMessage,
  ChannelMessageType,
  WindowInfo,
  WindowRole,
} from '../models/windowMessages';

declare global {
  interface Window {
    /** Lets a same-origin opener/popup reference be matched to its channel window id. */
    __marginaliaWindowId?: string;
  }
}

export const WINDOW_CHANNEL_NAME = 'marginalia:windows';
export const PANEL_WINDOW_NAME = 'marginalia-panel';
/** `window.name` survives refreshes but not bookmarks, shared links, or Ctrl+click tabs. */
export const DOCUMENT_WINDOW_NAME_PREFIX = 'marginalia-document-';
export const PANEL_CLOSE_GRACE_MS = 10_000;
export const PANEL_CLOSE_CONFIRM_MS = 1_500;

export interface BroadcastChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  close(): void;
}

type MessageOf<T extends ChannelMessageType> = Extract<ChannelMessage, { type: T }>;
export type OutgoingMessage = ChannelMessage extends infer M
  ? M extends ChannelMessage ? Omit<M, 'from'> : never
  : never;

interface WindowChannelOptions {
  id: string;
  type: WindowRole;
  createTransport: () => BroadcastChannelLike | null;
  now?: () => number;
  openNamedWindow?: (name: string) => Window | null;
}

const windowNameFor = (type: WindowRole, id: string): string => {
  if (type === 'panel') {
    return PANEL_WINDOW_NAME;
  }
  return type === 'document' ? `${DOCUMENT_WINDOW_NAME_PREFIX}${id}` : `marginalia-tab-${id}`;
};

const openWindowByName = (name: string): Window | null => (
  typeof window === 'undefined' ? null : window.open('', name)
);

const isLiveWindow = (candidate: Window | null | undefined, id: string): boolean => {
  try {
    return Boolean(candidate && !candidate.closed && candidate.__marginaliaWindowId === id);
  } catch {
    // Cross-origin or already-closed references can't be focused directly.
    return false;
  }
};

const tryFocus = (ref: Window): void => {
  try {
    ref.focus();
  } catch {
    // Already closed.
  }
};

export class WindowChannel {
  readonly id: string;
  readonly type: WindowRole;
  readonly isPanelWindow: boolean;
  private readonly createTransport: () => BroadcastChannelLike | null;
  private readonly now: () => number;
  private readonly openNamedWindow: (name: string) => Window | null;
  private transport: BroadcastChannelLike | null = null;
  private info: WindowInfo;
  private readonly windows = new Map<string, WindowInfo>();
  private snapshot: readonly WindowInfo[] = [];
  private readonly registryListeners = new Set<() => void>();
  private readonly handlers = new Map<ChannelMessageType, Set<(message: ChannelMessage) => void>>();
  private detachWindowListeners: (() => void) | null = null;
  private opener: Window | null = null;
  private readonly departedAt = new Map<WindowRole, number>();

  constructor({
    id,
    type,
    createTransport,
    now = Date.now,
    openNamedWindow = openWindowByName,
  }: WindowChannelOptions) {
    this.id = id;
    this.type = type;
    this.isPanelWindow = type === 'panel';
    this.createTransport = createTransport;
    this.now = now;
    this.openNamedWindow = openNamedWindow;
    this.info = {
      id,
      type,
      lastFocusedAt: 0,
      label: null,
      windowName: windowNameFor(type, id),
      openerId: null,
    };
  }

  get isAvailable(): boolean {
    return this.transport !== null;
  }

  getSelf(): WindowInfo {
    return this.info;
  }

  /** Every other live window, oldest announcement first. */
  getWindows = (): readonly WindowInfo[] => this.snapshot;

  /** True when a window of this type said goodbye within `withinMs`, e.g. because it is refreshing. */
  recentlyDeparted(type: WindowRole, withinMs: number): boolean {
    const at = this.departedAt.get(type);
    return at !== undefined && this.now() - at <= withinMs;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.registryListeners.add(listener);
    return () => {
      this.registryListeners.delete(listener);
    };
  };

  start(target?: Window): void {
    if (this.transport) {
      return;
    }

    this.transport = this.createTransport();
    if (!this.transport) {
      return;
    }

    this.transport.addEventListener('message', this.handleMessage);
    if (target) {
      target.__marginaliaWindowId = this.id;
      // Per-load names: a duplicated tab inherits `window.name`, which would make lookups ambiguous.
      target.name = this.info.windowName;
      try {
        this.opener = (target.opener as Window | null) ?? null;
      } catch {
        this.opener = null;
      }
      this.refreshOpenerId();
      if (target.document?.hasFocus?.()) {
        this.info = { ...this.info, lastFocusedAt: this.now() };
      }
      this.attachWindowListeners(target);
    }
    this.post({ type: 'hello', info: this.info });
  }

  stop(): void {
    if (!this.transport) {
      return;
    }

    this.post({ type: 'bye' });
    this.detachWindowListeners?.();
    this.detachWindowListeners = null;
    this.transport.removeEventListener('message', this.handleMessage);
    this.transport.close();
    this.transport = null;
    this.windows.clear();
    this.emitRegistry();
  }

  update(next: Partial<Pick<WindowInfo, 'label'>>): void {
    const label = next.label !== undefined ? next.label : this.info.label;
    if (label === this.info.label) {
      return;
    }

    this.info = { ...this.info, label };
    this.post({ type: 'announce', info: this.info });
  }

  markFocused(): void {
    this.info = { ...this.info, lastFocusedAt: this.now() };
    this.post({ type: 'announce', info: this.info });
  }

  post(message: OutgoingMessage): void {
    this.transport?.postMessage({ ...message, from: this.id });
  }

  on<T extends ChannelMessageType>(type: T, handler: (message: MessageOf<T>) => void): () => void {
    const existing = this.handlers.get(type) ?? new Set();
    const wrapped = handler as (message: ChannelMessage) => void;
    existing.add(wrapped);
    this.handlers.set(type, existing);
    return () => {
      existing.delete(wrapped);
    };
  }

  /**
   * Call synchronously from a click: browsers only honor `focus()` and `window.open` during a user gesture.
   * Prefers `window.open('', name)`, which can activate a tab where `focus()` on a reference is ignored, then
   * live same-origin references, and always asks the window to focus itself as a last resort.
   *
   * A name lookup that misses opens a blank window, so it only runs when the target is known to share this
   * browsing context group: a live reference to it is among `candidates`, one window opened the other (or
   * both share an opener), or the caller vouches for it with `reachableByName`.
   */
  focusWindow(
    id: string,
    candidates: ReadonlyArray<Window | null | undefined> = [],
    { reachableByName = false }: { reachableByName?: boolean } = {}
  ): void {
    const direct = candidates.filter((candidate): candidate is Window => Boolean(candidate) && isLiveWindow(candidate, id));
    const reachable = direct.length > 0 || reachableByName || this.sharesOpener(id);
    const focusedByName = reachable && this.focusByName(id);
    if (!focusedByName) {
      direct.forEach(tryFocus);
    }
    this.post({ type: 'focus', to: id });
  }

  /** True when one window opened the other, or the same window opened both (e.g. the panel and a document popup). */
  private sharesOpener(id: string): boolean {
    const target = this.windows.get(id);
    if (!target) {
      return false;
    }
    const ownOpener = this.info.openerId;
    return target.openerId === this.id
      || (ownOpener !== null && (target.id === ownOpener || target.openerId === ownOpener));
  }

  /**
   * Window ids change on every load, so this re-reads the opener's current id. The last known id is
   * kept once the opener closes, so popups it opened still recognize each other.
   */
  private refreshOpenerId(): boolean {
    let openerId: string | undefined;
    try {
      openerId = this.opener && !this.opener.closed ? this.opener.__marginaliaWindowId : undefined;
    } catch {
      openerId = undefined;
    }
    if (!openerId || openerId === this.info.openerId) {
      return false;
    }
    this.info = { ...this.info, openerId };
    return true;
  }

  private focusByName(id: string): boolean {
    const windowName = this.windows.get(id)?.windowName;
    if (!windowName || windowName === this.info.windowName) {
      return false;
    }

    let ref: Window | null = null;
    try {
      ref = this.openNamedWindow(windowName);
    } catch {
      return false;
    }
    if (!ref) {
      return false;
    }
    if (isLiveWindow(ref, id)) {
      tryFocus(ref);
      return true;
    }

    try {
      // A miss opens a new blank window; anything else is a real window that is still loading.
      if (!ref.__marginaliaWindowId && ref.location.href === 'about:blank') {
        ref.close();
      }
    } catch {
      // A cross-origin window is a real window; leave it alone.
    }
    return false;
  }

  private attachWindowListeners(target: Window): void {
    const handleFocus = () => this.markFocused();
    const handlePageHide = () => this.post({ type: 'bye' });
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        this.post({ type: 'hello', info: this.info });
      }
    };
    const handleFreeze = () => this.post({ type: 'bye' });
    const handleResume = () => this.post({ type: 'hello', info: this.info });

    target.addEventListener('focus', handleFocus);
    target.addEventListener('pagehide', handlePageHide);
    target.addEventListener('pageshow', handlePageShow);
    target.document?.addEventListener('freeze', handleFreeze);
    target.document?.addEventListener('resume', handleResume);
    const stopFocusRequests = this.on('focus', () => target.focus());

    this.detachWindowListeners = () => {
      target.removeEventListener('focus', handleFocus);
      target.removeEventListener('pagehide', handlePageHide);
      target.removeEventListener('pageshow', handlePageShow);
      target.document?.removeEventListener('freeze', handleFreeze);
      target.document?.removeEventListener('resume', handleResume);
      stopFocusRequests();
    };
  }

  private readonly handleMessage = (event: MessageEvent): void => {
    const message = event.data as ChannelMessage | null;
    if (!message || typeof message !== 'object' || typeof message.type !== 'string' || message.from === this.id) {
      return;
    }
    if ('to' in message && message.to !== this.id) {
      return;
    }

    if (message.type === 'hello' || message.type === 'announce') {
      this.windows.set(message.from, { ...message.info, id: message.from });
      const openerChanged = this.refreshOpenerId();
      this.emitRegistry();
      if (message.type === 'hello' || openerChanged) {
        this.post({ type: 'announce', info: this.info });
      }
    } else if (message.type === 'bye') {
      const departed = this.windows.get(message.from);
      if (departed) {
        this.departedAt.set(departed.type, this.now());
        this.windows.delete(message.from);
        this.emitRegistry();
      }
    }

    for (const handler of Array.from(this.handlers.get(message.type) ?? [])) {
      handler(message);
    }
  };

  private emitRegistry(): void {
    this.snapshot = Array.from(this.windows.values());
    for (const listener of Array.from(this.registryListeners)) {
      listener();
    }
  }
}

/** Calls `onGone` once no regular window has been seen for the grace period plus a final roll call. */
export function watchForLastRegularWindow(
  channel: Pick<WindowChannel, 'getWindows' | 'getSelf' | 'subscribe' | 'post'>,
  {
    onGone,
    graceMs = PANEL_CLOSE_GRACE_MS,
    confirmMs = PANEL_CLOSE_CONFIRM_MS,
  }: { onGone: () => void; graceMs?: number; confirmMs?: number }
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const hasRegularWindow = () => channel.getWindows().some((entry) => entry.type !== 'panel');
  const cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const evaluate = () => {
    if (hasRegularWindow()) {
      cancel();
      return;
    }
    if (timer !== null) {
      return;
    }

    timer = setTimeout(() => {
      channel.post({ type: 'hello', info: channel.getSelf() });
      timer = setTimeout(() => {
        timer = null;
        if (!hasRegularWindow()) {
          onGone();
        }
      }, confirmMs);
    }, graceMs);
  };

  const unsubscribe = channel.subscribe(evaluate);
  evaluate();
  return () => {
    unsubscribe();
    cancel();
  };
}

const createWindowId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `window-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const detectWindowType = (): WindowRole => {
  if (typeof window === 'undefined') {
    return 'bible';
  }
  if (parsePopoutFromHash(window.location.hash) === PANEL_POPOUT_VALUE) {
    return 'panel';
  }
  return window.name.startsWith(DOCUMENT_WINDOW_NAME_PREFIX) ? 'document' : 'bible';
};

/** Decided once at load; a window never changes type. */
export const windowType: WindowRole = detectWindowType();
export const isPanelWindow = windowType === 'panel';
export const isDocumentWindow = windowType === 'document';

export const windowChannel = new WindowChannel({
  id: createWindowId(),
  type: windowType,
  createTransport: () => (
    typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(WINDOW_CHANNEL_NAME)
  ),
});

export const useChannelWindows = (): readonly WindowInfo[] => (
  useSyncExternalStore(windowChannel.subscribe, windowChannel.getWindows)
);
