import { useSyncExternalStore } from 'react';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastInput {
  message: string;
  tone?: ToastTone;
  /** Repeats with the same key merge into one entry; defaults to `${tone}:${message}`. */
  key?: string;
  action?: ToastAction;
}

export interface Toast {
  id: string;
  key: string;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
  createdAt: number;
  repeatCount: number;
}

export const TOAST_LIFETIME_MS = 3 * 60_000;
export const ALERT_TOAST_LIFETIME_MS = 15 * 60_000;
/** A repeat only merges into one of this many newest toasts, so older entries stay as history. */
const MERGE_WINDOW = 2;

let toasts: readonly Toast[] = [];
const remainingMsById = new Map<string, number>();
const listeners = new Set<() => void>();
let nextId = 0;
let paused = false;
let runningSince: number | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;

export function isAlertTone(tone: ToastTone): boolean {
  return tone === 'warning' || tone === 'error';
}

function lifetimeFor(tone: ToastTone): number {
  return isAlertTone(tone) ? ALERT_TOAST_LIFETIME_MS : TOAST_LIFETIME_MS;
}

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Charges the time elapsed since the last settle against every toast's remaining lifetime. */
function settle(now: number): void {
  if (runningSince !== null) {
    const elapsed = Math.max(0, now - runningSince);
    if (elapsed > 0) {
      for (const [id, remaining] of remainingMsById) {
        remainingMsById.set(id, remaining - elapsed);
      }
    }
  }
  runningSince = paused ? null : now;
}

function clearExpiryTimer(): void {
  if (expiryTimer !== null) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
}

function scheduleExpiry(): void {
  clearExpiryTimer();
  if (paused || remainingMsById.size === 0) {
    return;
  }

  const soonest = Math.min(...remainingMsById.values());
  expiryTimer = setTimeout(expireDueToasts, Math.max(0, soonest));
}

function expireDueToasts(): void {
  expiryTimer = null;
  settle(Date.now());
  const expired = new Set<string>();
  for (const [id, remaining] of remainingMsById) {
    if (remaining <= 0) {
      expired.add(id);
    }
  }

  if (expired.size > 0) {
    for (const id of expired) {
      remainingMsById.delete(id);
    }
    toasts = toasts.filter((toast) => !expired.has(toast.id));
    emit();
  }
  scheduleExpiry();
}

export function showToast(input: ToastInput): string {
  const now = Date.now();
  settle(now);

  const tone = input.tone ?? 'info';
  const key = input.key ?? `${tone}:${input.message}`;
  const mergeTarget = toasts.slice(-MERGE_WINDOW).find((toast) => toast.key === key);

  let toast: Toast;
  if (mergeTarget) {
    toast = {
      ...mergeTarget,
      message: input.message,
      tone,
      action: input.action,
      createdAt: now,
      repeatCount: mergeTarget.repeatCount + 1,
    };
    toasts = [...toasts.filter((existing) => existing.id !== mergeTarget.id), toast];
  } else {
    nextId += 1;
    toast = {
      id: `toast-${nextId}`,
      key,
      message: input.message,
      tone,
      action: input.action,
      createdAt: now,
      repeatCount: 1,
    };
    toasts = [...toasts, toast];
  }

  remainingMsById.set(toast.id, lifetimeFor(tone));
  scheduleExpiry();
  emit();
  return toast.id;
}

export function dismissToast(id: string): void {
  if (!remainingMsById.has(id)) {
    return;
  }

  settle(Date.now());
  remainingMsById.delete(id);
  toasts = toasts.filter((toast) => toast.id !== id);
  scheduleExpiry();
  emit();
}

export function setToastExpiryPaused(nextPaused: boolean): void {
  if (paused === nextPaused) {
    return;
  }

  settle(Date.now());
  paused = nextPaused;
  runningSince = paused ? null : Date.now();
  scheduleExpiry();
}

/** Oldest first; the panel reverses for display. */
export function getToasts(): readonly Toast[] {
  return toasts;
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useToasts(): readonly Toast[] {
  return useSyncExternalStore(subscribeToasts, getToasts);
}

export function __resetToastsForTests(): void {
  clearExpiryTimer();
  toasts = [];
  remainingMsById.clear();
  nextId = 0;
  paused = false;
  runningSince = null;
  emit();
}
