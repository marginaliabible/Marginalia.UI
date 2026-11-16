import type { FederatedProvider } from '../models/bible';

export type LinkedNotesSources = Record<FederatedProvider, boolean> & {
  /** Paired Local Folders (Watchman) machine(s) count as a notes source. */
  localFolders?: boolean;
};

/** Sanctum (or other account UI) reports linked notes sources here for tour gates. */
let linkedProviders: LinkedNotesSources = {
  google: false,
  microsoft: false,
  localFolders: false,
};

export function setLinkedCloudProviders(next: LinkedNotesSources): void {
  linkedProviders = {
    google: Boolean(next.google),
    microsoft: Boolean(next.microsoft),
    localFolders: Boolean(next.localFolders),
  };
}

/** True when Google, Microsoft, or Local Folders is connected as a notes source. */
export function hasLinkedCloudProvider(): boolean {
  return linkedProviders.google || linkedProviders.microsoft || Boolean(linkedProviders.localFolders);
}
