import type { FederatedProvider } from '../models/bible';
import type { AccountSyncRevealTarget, DocumentSubscriptionItem } from '../models/accountSync';
import type { DocumentSyncItem } from '../store/slices/uiSlice';
import { resourceItemKey } from './sourceSubscriptions';

/** Build a viewer syncItem for cloud or Local Folders libraries (provider unused when machineId is set). */
export function syncItemFromLibraryDoc(options: {
  cloudProvider?: FederatedProvider | null;
  localFoldersMachineId?: string | null;
  documentId: string;
}): DocumentSyncItem | null {
  const machineId = options.localFoldersMachineId?.trim();
  if (machineId) {
    return {
      provider: 'microsoft',
      itemId: options.documentId,
      machineId,
    };
  }
  if (options.cloudProvider) {
    return {
      provider: options.cloudProvider,
      itemId: options.documentId,
    };
  }
  return null;
}

/**
 * Prefer Local Folders when syncItem.machineId is set, then cloud File Sync, then Subscriptions.
 * Local docs must not be mis-routed to Subscriptions.
 */
export function resolveAccountSyncRevealTarget(options: {
  syncItem?: DocumentSyncItem | null;
  subscriptionItem?: DocumentSubscriptionItem | null;
}): AccountSyncRevealTarget | null {
  if (options.syncItem?.machineId) {
    return {
      kind: 'localFolders',
      machineId: options.syncItem.machineId,
      path: options.syncItem.itemId,
    };
  }

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
  localFoldersMachineId?: string | null;
  libraryKey?: string | null;
  resourceKey?: string | null;
}): DocumentSubscriptionItem | null {
  if (options.cloudProvider || options.localFoldersMachineId) {
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
