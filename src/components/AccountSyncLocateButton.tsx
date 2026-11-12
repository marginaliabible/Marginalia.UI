import React from 'react';
import type { DocumentSubscriptionItem } from '../models/accountSync';
import type { DocumentSyncItem } from '../store/slices/uiSlice';
import { requestAccountSyncReveal } from '../services/accountSyncRevealService';
import { showToast } from '../services/toastService';
import { routeInteraction } from '../services/windowRouting';
import { resolveAccountSyncRevealTarget } from '../utils/accountSyncTarget';

interface AccountSyncLocateButtonProps {
  syncItem: DocumentSyncItem | null;
  subscriptionItem: DocumentSubscriptionItem | null;
  documentLabel: string;
}

const AccountSyncLocateButton: React.FC<AccountSyncLocateButtonProps> = ({
  syncItem,
  subscriptionItem,
  documentLabel,
}) => {
  const target = resolveAccountSyncRevealTarget({ syncItem, subscriptionItem });
  if (!target) {
    return null;
  }

  const handleClick = () => {
    // Account Sync lives in the Bible window; from a document popout, route the reveal there.
    routeInteraction(
      { kind: 'bible', type: 'reveal-account-sync', payload: target },
      () => {
        if (requestAccountSyncReveal(target)) {
          return;
        }

        showToast({
          tone: 'error',
          message: `Couldn't open Account Sync to locate '${documentLabel}'.`,
        });
      },
      { quiet: true }
    );
  };

  return (
    <button
      type="button"
      className="btn btn-sm btn-outline-info"
      title="Find in Account Sync"
      aria-label={`Find ${documentLabel} in Account Sync`}
      onClick={handleClick}
    >
      <i className="fa-solid fa-arrows-rotate" aria-hidden="true"></i>
    </button>
  );
};

export default AccountSyncLocateButton;
