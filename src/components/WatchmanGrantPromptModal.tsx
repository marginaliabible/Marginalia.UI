import { createPortal } from 'react-dom';

interface WatchmanGrantPromptModalProps {
  machineName: string;
  onRetry: () => void;
  onCancel: () => void;
}

/** Protocol-grant wait while browsing Local Folders on a Watchman machine. */
const WatchmanGrantPromptModal: React.FC<WatchmanGrantPromptModalProps> = ({
  machineName,
  onRetry,
  onCancel,
}) => {
  const name = String(machineName ?? '').trim() || 'this computer';
  const modal = (
    <>
      <div className="modal-backdrop fade show" onClick={onCancel} />
      <div
        className="modal fade show d-block"
        tabIndex={-1}
        aria-modal="true"
        role="dialog"
        aria-labelledby="watchmanGrantPromptTitle"
      >
        <div className="modal-dialog modal-dialog-centered">
          <div className="modal-content shadow border-0">
            <div className="modal-header">
              <h2 className="modal-title h5 mb-0 d-flex align-items-center gap-2" id="watchmanGrantPromptTitle">
                <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                Local Folders
              </h2>
              <button
                type="button"
                className="btn-close"
                aria-label="Cancel"
                onClick={onCancel}
              />
            </div>
            <div className="modal-body">
              <p className="mb-0">
                You can only do this from {name}, running Marginalia Watchman. Click{' '}
                <strong>Allow Marginalia Watchman</strong> if your browser asks to open it.
              </p>
            </div>
            <div className="modal-footer justify-content-between">
              <button type="button" className="btn btn-primary" onClick={onRetry}>
                Retry
              </button>
              <button type="button" className="btn btn-outline-secondary" onClick={onCancel}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(modal, document.body);
};

export default WatchmanGrantPromptModal;
