import { dismissToastsByKey, showToast } from './toastService';

export const BROKER_SESSION_TOAST_KEY = 'broker-session-required';

const SESSION_ERRORS = new Set(['session_required', 'user_mismatch']);

let openAccountSync: (() => void) | null = null;
let required = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function registerAccountSyncOpener(open: () => void): () => void {
  openAccountSync = open;
  return () => {
    if (openAccountSync === open) {
      openAccountSync = null;
    }
  };
}

export function isBrokerSessionRequired(): boolean {
  return required;
}

export function subscribeBrokerSessionRequired(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearBrokerSessionRequired(): void {
  if (!required) {
    return;
  }
  required = false;
  dismissToastsByKey(BROKER_SESSION_TOAST_KEY);
  emit();
}

/** True when CCS refused the call because this browser has no (or the wrong) session cookie. */
export function noteCcsAuthFailure(status: number, bodyText: string): boolean {
  if (status !== 401 && status !== 403) {
    return false;
  }

  let error = '';
  try {
    const parsed = JSON.parse(bodyText) as { error?: string };
    error = String(parsed?.error ?? '').trim();
  } catch {
    if (bodyText.includes('session_required')) {
      error = 'session_required';
    } else if (bodyText.includes('user_mismatch')) {
      error = 'user_mismatch';
    }
  }

  if (!SESSION_ERRORS.has(error)) {
    return false;
  }

  promptBrokerSessionRequired();
  return true;
}

export function promptBrokerSessionRequired(): void {
  const already = required;
  required = true;
  if (!already) {
    emit();
  }
  showToast({
    key: BROKER_SESSION_TOAST_KEY,
    tone: 'warning',
    message: 'Sign in again to continue.',
    action: { label: 'Open Account Sync', onClick: () => openAccountSync?.() },
  });
}

export function __resetBrokerSessionPromptForTests(): void {
  required = false;
  openAccountSync = null;
  listeners.clear();
  emit();
}
