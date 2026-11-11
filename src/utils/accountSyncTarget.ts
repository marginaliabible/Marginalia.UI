import type { FederatedProvider } from '../models/bible';
import type { AccountSyncRevealTarget, DocumentSubscriptionItem } from '../models/accountSync';
import type { DocumentSyncItem } from '../store/slices/uiSlice';
import { resourceItemKey } from './sourceSubscriptions';

/** Prefer cloud File Sync when the document came from a connected Drive/OneDrive library. */
export function resolveAccountSyncRevealTarget(options: {
  syncItem?: DocumentSyncItem | null;
  subscriptionItem?: DocumentSubscriptionItem | null;
}): AccountSyncRevealTarget | null {
  if (options.syncItem) {
    return {
      kind: 'cloud',
      provider: options.syncItem.provider,
      itemId: options.syncItem.itemId,
    };
  }

  if (options.subscriptionItem) {
    return {
      kind: 'subscription',
      libraryKey: options.subscriptionItem.libraryKey,
      type: 'resource',
      documentKey: options.subscriptionItem.documentKey,
    };
  }

  return null;
}

export function subscriptionItemFromResource(options: {
  cloudProvider?: FederatedProvider | null;
  libraryKey?: string | null;
  resourceKey?: string | null;
}): DocumentSubscriptionItem | null {
  if (options.cloudProvider) {
    return null;
  }

  const libraryKey = options.libraryKey?.trim() ?? '';
  const resourceKey = options.resourceKey?.trim() ?? '';
  if (!libraryKey || !resourceKey) {
    return null;
  }

  return {
    libraryKey,
    documentKey: resourceItemKey(libraryKey, resourceKey),
  };
}
