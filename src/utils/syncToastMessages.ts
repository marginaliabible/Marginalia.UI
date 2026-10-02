import type { FederatedProvider } from '../models/bible';
import type { SubscriptionApplySummary } from '../models/subscription';
import type { ToastInput } from '../services/toastService';

export const ACCOUNT_SYNC_APPLY_TOAST_KEY = 'account-sync-apply';
export const LANGUAGES_TOAST_KEY = 'languages';

const PROVIDER_LABELS: Record<FederatedProvider, string> = {
  google: 'Google Drive',
  microsoft: 'OneDrive',
};

export interface FolderApplyResult {
  /** Providers whose folder selection change was queued with CloudControlService. */
  queuedProviders: FederatedProvider[];
  failures: string[];
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function formatProviderList(providers: FederatedProvider[]): string {
  const labels = Array.from(new Set(providers)).map((provider) => PROVIDER_LABELS[provider]);
  return labels.join(' and ');
}

function describeSubscriptionChanges(summary: SubscriptionApplySummary | null): string[] {
  if (!summary) {
    return [];
  }

  const parts: string[] = [];
  if (summary.librariesDisconnected > 0) {
    parts.push(`${plural(summary.librariesDisconnected, 'library', 'libraries')} disconnected`);
  }
  if (summary.itemsDisabled > 0) {
    parts.push(`${plural(summary.itemsDisabled, 'item')} disabled`);
  }
  if (summary.itemsEnabled > 0) {
    parts.push(`${plural(summary.itemsEnabled, 'item')} enabled`);
  }
  if (summary.translationsDropped > 0) {
    parts.push(`${plural(summary.translationsDropped, 'translation')} removed from your list`);
  }
  return parts;
}

export function formatAccountSyncApplyToast(
  folders: FolderApplyResult | null,
  subscriptions: SubscriptionApplySummary | null
): ToastInput {
  const subscriptionParts = describeSubscriptionChanges(subscriptions);
  const details = subscriptionParts.length > 0 ? `: ${subscriptionParts.join(', ')}` : '';
  const failures = folders?.failures ?? [];

  if (failures.length > 0) {
    const saved = subscriptionParts.length > 0 ? ` Subscriptions were saved${details}.` : '';
    return {
      key: ACCOUNT_SYNC_APPLY_TOAST_KEY,
      tone: 'error',
      message: `Account Sync changes couldn't be fully applied: ${failures.join(' | ')}.${saved}`,
    };
  }

  const queued = folders?.queuedProviders ?? [];
  const syncNote = queued.length > 0
    ? ` ${formatProviderList(queued)} will start syncing in a few minutes; we'll let you know when it's done.`
    : '';
  return {
    key: ACCOUNT_SYNC_APPLY_TOAST_KEY,
    tone: 'success',
    message: `Account Sync changes saved${details}.${syncNote}`,
  };
}

export function formatSyncCompleteToast(providers: FederatedProvider[], failedCount: number): ToastInput {
  const failedNote = failedCount > 0 ? ` (${plural(failedCount, 'file')} couldn't be processed)` : '';
  return {
    tone: failedCount > 0 ? 'warning' : 'success',
    message: `Your ${formatProviderList(providers)} files finished syncing${failedNote}. Refresh to see the changes.`,
  };
}

export function formatLanguageChangeToast(options: {
  languagesSelected: number;
  previousCount: number;
  nextCount: number;
  usedFallback: boolean;
}): ToastInput {
  const { languagesSelected, previousCount, nextCount, usedFallback } = options;
  if (usedFallback) {
    return {
      key: LANGUAGES_TOAST_KEY,
      tone: 'warning',
      message: `No translations match the selected languages, so all ${plural(nextCount, 'translation')} are shown.`,
    };
  }

  const delta = nextCount - previousCount;
  const change = delta === 0 ? 'no change' : `${Math.abs(delta)} ${delta > 0 ? 'more' : 'fewer'}`;
  const lead = languagesSelected === 0 ? 'Language filter cleared.' : 'Languages updated.';
  return {
    key: LANGUAGES_TOAST_KEY,
    message: `${lead} The translation list and Subscriptions now show ${plural(nextCount, 'translation')} (${change}).`,
  };
}
