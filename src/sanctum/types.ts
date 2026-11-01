import type { ComponentType } from 'react';
import type { SubscriptionsBinding } from '../models/subscription';
import type { DocumentSyncItem } from '../store/slices/uiSlice';

export interface SanctumDocumentToolbarExtrasProps {
  syncItem?: DocumentSyncItem | null;
  documentLabel?: string;
}

export interface SanctumPlugin {
  AccountSync?: ComponentType<{ subscriptions?: SubscriptionsBinding }>;
  DocumentToolbarExtras?: ComponentType<SanctumDocumentToolbarExtrasProps>;
  SettingsFooter?: ComponentType;
  register?(): () => void;
}
