import type { TranslationRecord } from './bible';
import type { SubscriptionLibrary } from '../services/subscriptionCatalogService';
import type { ResourceTagOverrides } from '../utils/sourceSubscriptions';

/** Staged Subscriptions edits handed to the app when the user clicks Apply. */
export interface SubscriptionChanges {
  disconnectLibraryKeys: string[];
  disabledSourceItems: string[];
  resourceTagOverrides: ResourceTagOverrides;
}

export interface AddSourceUrlResult {
  ok: boolean;
  message: string;
  suggestGitHubAuth?: boolean;
  /** Normalized URL that was saved (the subscription's library key). */
  url?: string;
}

/** Everything the File Sync picker needs to show and edit Subscriptions. */
export interface SubscriptionsBinding {
  sourceUrls: string[];
  libraries: SubscriptionLibrary[];
  isCatalogLoading: boolean;
  translationRecords: TranslationRecord[];
  disabledSourceItems: string[];
  resourceTagOverrides: ResourceTagOverrides;
  onRequestCatalog: () => void;
  onAddSourceUrl: (url: string) => Promise<AddSourceUrlResult>;
  onRequestGitHubAuth: () => void;
  onSubscriptionsApply: (changes: SubscriptionChanges) => Promise<void>;
}
