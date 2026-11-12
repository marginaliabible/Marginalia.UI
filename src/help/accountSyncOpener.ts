/** Sanctum (or File Sync stub) registers how to open the Account Sync modal for tours. */
let opener: (() => void) | null = null;

export function registerHelpAccountSyncOpener(open: () => void): () => void {
  opener = open;
  return () => {
    if (opener === open) {
      opener = null;
    }
  };
}

/** Opens Account Sync when a registered opener exists. */
export function openHelpAccountSync(): boolean {
  if (!opener) {
    return false;
  }
  opener();
  return true;
}
