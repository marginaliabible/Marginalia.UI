import React, { useEffect, useSyncExternalStore } from 'react';
import type { FederatedProvider } from '../models/bible';
import { requestDocumentReprocess } from '../services/cloudControlService';
import {
  ensureDeveloperCapabilities,
  isDeveloperToolsEnabled,
  subscribeDeveloperTools,
} from '../services/developerToolsService';
import { showToast } from '../services/toastService';

interface DeveloperReprocessButtonProps {
  userId: string | null | undefined;
  provider: FederatedProvider | null;
  documentId: string | null;
  documentLabel: string;
  /** Original filename with extension when known; otherwise CCS uses the package's recorded name. */
  fileName?: string;
  processed: boolean;
  variant?: 'toolbar' | 'row';
}

const CONFIRMATION = (label: string) => (
  `Blow away and reprocess '${label}'? Converted output will be deleted and the file will be converted again.`
);

const DeveloperReprocessButton: React.FC<DeveloperReprocessButtonProps> = ({
  userId,
  provider,
  documentId,
  documentLabel,
  fileName,
  processed,
  variant = 'toolbar',
}) => {
  const visible = useSyncExternalStore(subscribeDeveloperTools, isDeveloperToolsEnabled);
  useEffect(() => {
    void ensureDeveloperCapabilities(userId);
  }, [userId]);

  if (!visible) {
    return null;
  }

  const canRun = Boolean(processed && userId && provider && documentId);
  const title = canRun
    ? 'Blow away and reprocess'
    : processed
      ? 'Blow away and reprocess needs a File Sync document'
      : 'Blow away and reprocess is only available for processed documents';

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!canRun || !userId || !provider || !documentId) {
      return;
    }
    if (!window.confirm(CONFIRMATION(documentLabel))) {
      return;
    }

    showToast({ message: `"${documentLabel}" will be blown away and restarted.` });

    void requestDocumentReprocess({
      userId,
      provider,
      documentId,
      fileName,
    }).catch((error: unknown) => {
      showToast({
        tone: 'error',
        message: `Couldn't blow away and reprocess '${documentLabel}': ${error instanceof Error ? error.message : String(error)}`,
      });
    });
  };

  const isRow = variant === 'row';
  return (
    <button
      type="button"
      className={isRow
        ? 'btn btn-link btn-sm p-0 cloud-folder-selected-reprocess'
        : 'btn btn-sm btn-outline-danger'}
      title={title}
      aria-label={`Blow away and reprocess ${documentLabel}`}
      disabled={!canRun}
      onClick={handleClick}
    >
      <i className="fa-solid fa-bomb" aria-hidden="true"></i>
    </button>
  );
};

export default DeveloperReprocessButton;
