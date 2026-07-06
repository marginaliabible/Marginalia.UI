interface GitHubAuthPromptModalProps {
  isOpen: boolean;
  title?: string;
  contextMessage?: string;
  errorMessage?: string | null;
  isLaunching?: boolean;
  onClose: () => void;
  onContinue: () => void;
}

const GitHubAuthPromptModal: React.FC<GitHubAuthPromptModalProps> = ({
  isOpen,
  title = 'Authenticate with GitHub',
  contextMessage,
  errorMessage,
  isLaunching = false,
  onClose,
  onContinue,
}) => {
  if (!isOpen) {
    return null;
  }

  return (
    <>
      <div className="modal-backdrop fade show github-auth-prompt-backdrop" />
      <div className="modal fade show d-block github-auth-prompt-modal" tabIndex={-1} aria-modal="true" role="dialog">
        <div className="modal-dialog modal-dialog-centered">
          <div className="modal-content shadow">
            <div className="modal-header">
              <h2 className="modal-title h5 mb-0">{title}</h2>
              <button
                type="button"
                className="btn-close"
                aria-label="Close"
                onClick={onClose}
              ></button>
            </div>

            <div className="modal-body d-flex flex-column gap-2">
              <p className="mb-0">
                You are about to leave this page and go to GitHub to authorize access.
              </p>
              <p className="mb-0">
                After authorization, GitHub will redirect you back to this application.
              </p>
              {contextMessage && (
                <p className="small text-body-secondary mb-0">{contextMessage}</p>
              )}
              {errorMessage && (
                <div className="alert alert-danger py-2 px-3 mb-0" role="alert">
                  {errorMessage}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={onClose}
                disabled={isLaunching}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={onContinue}
                disabled={isLaunching}
              >
                {isLaunching ? 'Redirecting...' : 'Continue to GitHub'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default GitHubAuthPromptModal;
