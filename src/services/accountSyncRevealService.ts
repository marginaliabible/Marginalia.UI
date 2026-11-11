import type { AccountSyncRevealTarget } from '../models/accountSync';

type RevealHandler = (target: AccountSyncRevealTarget) => void;

let revealHandler: RevealHandler | null = null;

export function registerAccountSyncRevealHandler(handler: RevealHandler): () => void {
  revealHandler = handler;
  return () => {
    if (revealHandler === handler) {
      revealHandler = null;
    }
  };
}

/** Opens File Sync (when registered) and reveals/highlights the target. Returns false if File Sync is unavailable. */
export function requestAccountSyncReveal(target: AccountSyncRevealTarget): boolean {
  if (!revealHandler) {
    return false;
  }

  revealHandler(target);
  return true;
}

export function __resetAccountSyncRevealForTests(): void {
  revealHandler = null;
}
