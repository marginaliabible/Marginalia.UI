import type { FederatedProvider } from '../models/bible';

export interface FileSyncExclusionTarget {
  id: string;
  excludedItemIds?: string[];
}

export interface FileSyncProviderExclusionState {
  /** Sync Files is enabled and the provider is signed in on this device, so selections can be applied. */
  canEdit: boolean;
  targets: FileSyncExclusionTarget[];
}

export type FileSyncExclusionSnapshot = Record<FederatedProvider, FileSyncProviderExclusionState>;

export interface FileSyncExclusionToggleResult {
  failures: string[];
}

type ToggleHandler = (provider: FederatedProvider, itemId: string) => Promise<FileSyncExclusionToggleResult>;

const EMPTY_SNAPSHOT: FileSyncExclusionSnapshot = {
  google: { canEdit: false, targets: [] },
  microsoft: { canEdit: false, targets: [] },
};

let snapshot: FileSyncExclusionSnapshot = EMPTY_SNAPSHOT;
const listeners = new Set<() => void>();
let toggleHandler: ToggleHandler | null = null;

export function publishFileSyncExclusionSnapshot(next: FileSyncExclusionSnapshot): void {
  snapshot = next;
  for (const listener of listeners) {
    listener();
  }
}

export function getFileSyncExclusionSnapshot(): FileSyncExclusionSnapshot {
  return snapshot;
}

export function subscribeFileSyncExclusionSnapshot(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function registerFileSyncExclusionToggleHandler(handler: ToggleHandler): () => void {
  toggleHandler = handler;
  return () => {
    if (toggleHandler === handler) {
      toggleHandler = null;
    }
  };
}

/** Returns null when no handler is registered (Account Sync is not mounted). */
export function requestFileSyncExclusionToggle(
  provider: FederatedProvider,
  itemId: string
): Promise<FileSyncExclusionToggleResult> | null {
  if (!toggleHandler) {
    return null;
  }

  return toggleHandler(provider, itemId);
}

export function isItemExcludedFromSync(targets: FileSyncExclusionTarget[], itemId: string): boolean {
  return targets.some((target) => target.excludedItemIds?.includes(itemId));
}

/**
 * Excludes (or restores) `itemId` across every root selection of a provider. The containing root
 * isn't known without walking the item's cloud parents, but CloudControlService flattens exclusions
 * per provider and the File Sync tree only consults a root's list for its own descendants.
 */
export function toggleItemExclusion<T extends FileSyncExclusionTarget>(targets: T[], itemId: string): T[] {
  const restoring = isItemExcludedFromSync(targets, itemId);

  return targets.map((target) => {
    const current = target.excludedItemIds ?? [];
    if (restoring) {
      if (!current.includes(itemId)) {
        return target;
      }

      const next = current.filter((id) => id !== itemId);
      return { ...target, excludedItemIds: next.length > 0 ? next : undefined };
    }

    return { ...target, excludedItemIds: [...current, itemId].sort() };
  });
}
