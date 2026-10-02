import {
  ACCOUNT_SYNC_APPLY_TOAST_KEY,
  LANGUAGES_TOAST_KEY,
  formatAccountSyncApplyToast,
  formatLanguageChangeToast,
  formatSyncCompleteToast,
} from './syncToastMessages';

const noSubscriptionChanges = { librariesDisconnected: 0, itemsEnabled: 0, itemsDisabled: 0, translationsDropped: 0 };

describe('formatAccountSyncApplyToast', () => {
  it('combines subscription changes with queued providers', () => {
    expect(formatAccountSyncApplyToast(
      { queuedProviders: ['google', 'microsoft'], failures: [] },
      { librariesDisconnected: 1, itemsEnabled: 0, itemsDisabled: 3, translationsDropped: 2 }
    )).toEqual({
      key: ACCOUNT_SYNC_APPLY_TOAST_KEY,
      tone: 'success',
      message: 'Account Sync changes saved: 1 library disconnected, 3 items disabled, 2 translations removed from your list. '
        + "Google Drive and OneDrive will start syncing in a few minutes; we'll let you know when it's done.",
    });
  });

  it('reports a plain save when nothing was queued or summarized', () => {
    expect(formatAccountSyncApplyToast({ queuedProviders: [], failures: [] }, noSubscriptionChanges).message)
      .toBe('Account Sync changes saved.');
    expect(formatAccountSyncApplyToast(null, null).message).toBe('Account Sync changes saved.');
  });

  it('reports failures as an error and still mentions saved subscription changes', () => {
    expect(formatAccountSyncApplyToast(
      { queuedProviders: [], failures: ['Google: offline'] },
      { ...noSubscriptionChanges, itemsEnabled: 1 }
    )).toEqual({
      key: ACCOUNT_SYNC_APPLY_TOAST_KEY,
      tone: 'error',
      message: "Account Sync changes couldn't be fully applied: Google: offline. Subscriptions were saved: 1 item enabled.",
    });
  });
});

describe('formatSyncCompleteToast', () => {
  it('uses success tone when every file processed', () => {
    expect(formatSyncCompleteToast(['google'], 0)).toEqual({
      tone: 'success',
      message: 'Your Google Drive files finished syncing. Refresh to see the changes.',
    });
  });

  it('warns with the failed file count', () => {
    expect(formatSyncCompleteToast(['google', 'microsoft'], 1)).toEqual({
      tone: 'warning',
      message: "Your Google Drive and OneDrive files finished syncing (1 file couldn't be processed). Refresh to see the changes.",
    });
  });
});

describe('formatLanguageChangeToast', () => {
  it('describes how many translations are now shown', () => {
    expect(formatLanguageChangeToast({ languagesSelected: 2, previousCount: 12, nextCount: 18, usedFallback: false })).toEqual({
      key: LANGUAGES_TOAST_KEY,
      message: 'Languages updated. The translation list and Subscriptions now show 18 translations (6 more).',
    });
    expect(formatLanguageChangeToast({ languagesSelected: 1, previousCount: 18, nextCount: 1, usedFallback: false }).message)
      .toBe('Languages updated. The translation list and Subscriptions now show 1 translation (17 fewer).');
    expect(formatLanguageChangeToast({ languagesSelected: 0, previousCount: 5, nextCount: 5, usedFallback: false }).message)
      .toBe('Language filter cleared. The translation list and Subscriptions now show 5 translations (no change).');
  });

  it('warns when nothing matches and every translation is shown', () => {
    expect(formatLanguageChangeToast({ languagesSelected: 1, previousCount: 4, nextCount: 20, usedFallback: true })).toEqual({
      key: LANGUAGES_TOAST_KEY,
      tone: 'warning',
      message: 'No translations match the selected languages, so all 20 translations are shown.',
    });
  });
});
