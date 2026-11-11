import { useCallback, useEffect, useRef, useState } from 'react';
import type { SubscriptionsBinding } from '../models/subscription';
import type { AccountSyncRevealRequest, AccountSyncRevealTarget } from '../models/accountSync';
import CloudFolderPicker, {
  type CloudFolderPickerHandle,
  type FolderSelectionTarget,
} from './CloudFolderPicker';
import type { FederatedProvider, FederatedSession } from '../models/bible';
import { setLinkedCloudProviders } from '../help/linkedCloudProviders';
import { registerAccountSyncRevealHandler } from '../services/accountSyncRevealService';
import './AccountControl.scss';

interface AccountControlProps {
  subscriptions?: SubscriptionsBinding;
}

const EMPTY_SESSIONS: Record<FederatedProvider, FederatedSession | null> = {
  google: null,
  microsoft: null,
};

const EMPTY_SELECTIONS: Record<FederatedProvider, FolderSelectionTarget[]> = {
  google: [],
  microsoft: [],
};

const EMPTY_PROVIDER_FLAGS: Record<FederatedProvider, boolean> = {
  google: false,
  microsoft: false,
};

const AccountControl: React.FC<AccountControlProps> = ({ subscriptions }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [revealRequest, setRevealRequest] = useState<AccountSyncRevealRequest | null>(null);
  const revealRequestCounterRef = useRef(0);
  const folderPickerRef = useRef<CloudFolderPickerHandle | null>(null);

  useEffect(() => {
    setLinkedCloudProviders(EMPTY_PROVIDER_FLAGS);
  }, []);

  useEffect(() => registerAccountSyncRevealHandler((target: AccountSyncRevealTarget) => {
    revealRequestCounterRef.current += 1;
    setRevealRequest({ requestId: revealRequestCounterRef.current, target });
    setIsModalOpen(true);
  }), []);

  const handleApply = useCallback(async () => ({
    queuedProviders: [] as FederatedProvider[],
    failures: [] as string[],
  }), []);

  const discardAndCloseModal = () => {
    folderPickerRef.current?.cancel();
    setHasUnsavedChanges(false);
    setIsModalOpen(false);
  };

  const closeModal = () => {
    if (hasUnsavedChanges && !window.confirm('You have unapplied File Sync changes. Discard them?')) {
      return;
    }

    discardAndCloseModal();
  };

  return (
    <div className="account-control">
      <button
        type="button"
        className="btn btn-outline-secondary rounded-circle d-inline-flex align-items-center justify-content-center account-trigger"
        aria-label="Open File Sync"
        onClick={() => setIsModalOpen(true)}
      >
        <i className="fa-solid fa-folder-open" aria-hidden="true"></i>
      </button>

      {isModalOpen && (
        <>
          <div
            className="modal-backdrop fade show account-modal-backdrop"
            onClick={closeModal}
          />
          <div className="modal fade show d-block account-modal" tabIndex={-1} aria-modal="true" role="dialog">
            <div className="modal-dialog modal-dialog-centered modal-lg account-modal-dialog">
              <div className="modal-content shadow border-0">
                <div className="modal-header">
                  <div className="d-flex align-items-center gap-2">
                    <i className="fa-solid fa-folder-open" aria-hidden="true"></i>
                    <h2 className="modal-title h5 mb-0">File Sync</h2>
                  </div>
                  <button
                    type="button"
                    className="btn-close"
                    aria-label="Close"
                    onClick={closeModal}
                  ></button>
                </div>

                <div className="modal-body d-flex flex-column gap-3">
                  <CloudFolderPicker
                    sessions={EMPTY_SESSIONS}
                    initialSelections={EMPTY_SELECTIONS}
                    providerSyncFilesEnabled={EMPTY_PROVIDER_FLAGS}
                    linkedProviders={EMPTY_PROVIDER_FLAGS}
                    focusRequest={null}
                    revealRequest={revealRequest}
                    onSelectionsChange={handleApply}
                    onConnectRequested={() => undefined}
                    onDirtyChange={setHasUnsavedChanges}
                    subscriptions={subscriptions}
                    ref={folderPickerRef}
                  />
                </div>

                <div className="modal-footer account-modal-footer">
                  <div className="d-flex gap-2 ms-auto">
                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      onClick={discardAndCloseModal}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={!hasUnsavedChanges}
                      onClick={() => folderPickerRef.current?.apply()}
                    >
                      <i className="fa-solid fa-check me-2" aria-hidden="true" />
                      Apply
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default AccountControl;
