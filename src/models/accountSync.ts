import type { FederatedProvider } from './bible';
import type { SubscriptionDocumentType } from '../utils/sourceSubscriptions';

/** Locate a cloud-synced file or a Subscriptions library document in File Sync. */
export type AccountSyncRevealTarget =
  | { kind: 'cloud'; provider: FederatedProvider; itemId: string }
  | {
    kind: 'subscription';
    libraryKey: string;
    type?: SubscriptionDocumentType;
    documentKey?: string;
  };

export interface AccountSyncRevealRequest {
  requestId: number;
  target: AccountSyncRevealTarget;
}

/** Subscription-library document a viewed resource came from (File Sync > Subscriptions). */
export interface DocumentSubscriptionItem {
  libraryKey: string;
  documentKey: string;
}
