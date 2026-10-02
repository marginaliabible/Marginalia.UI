import React, { useSyncExternalStore } from 'react';
import type { DocumentSyncItem } from '../store/slices/uiSlice';
import {
  getFileSyncExclusionSnapshot,
  isItemExcludedFromSync,
  requestFileSyncExclusionToggle,
  subscribeFileSyncExclusionSnapshot,
} from '../services/fileSyncExclusionService';

interface FileSyncExclusionButtonProps {
  syncItem: DocumentSyncItem | null;
  documentLabel: string;
}

const FileSyncExclusionButton: React.FC<FileSyncExclusionButtonProps> = ({ syncItem, documentLabel }) => {
  const snapshot = useSyncExternalStore(subscribeFileSyncExclusionSnapshot, getFileSyncExclusionSnapshot);
  if (!syncItem) {
    return null;
  }

  const providerState = snapshot[syncItem.provider];
  if (!providerState.canEdit || providerState.targets.length === 0) {
    return null;
  }

  const isExcluded = isItemExcludedFromSync(providerState.targets, syncItem.itemId);

  const handleClick = () => {
    if (!isExcluded) {
      const providerLabel = syncItem.provider === 'google' ? 'Google Drive' : 'OneDrive';
      const confirmed = window.confirm(
        `Are you sure? This will remove this document from your library the next time your ${providerLabel} is synced. `
        + 'You can always add it back from the Account Sync dialogue.'
      );
      if (!confirmed) {
        return;
      }
    }
    requestFileSyncExclusionToggle(syncItem.provider, syncItem.itemId);
  };

  return (
    <button
      type="button"
      className={`btn btn-sm ${isExcluded ? 'btn-outline-warning' : 'btn-outline-info'}`}
      title={isExcluded ? 'Sync disabled. Click to resume syncing' : 'Sync enabled. Click to exclude from syncing.'}
      aria-label={isExcluded ? `Resume syncing ${documentLabel}` : `Exclude ${documentLabel} from sync`}
      aria-pressed={isExcluded}
      onClick={handleClick}
    >
      <i className={`fa-solid ${isExcluded ? 'fa-upload' : 'fa-arrows-rotate'}`} aria-hidden="true"></i>
    </button>
  );
};

export default FileSyncExclusionButton;
