import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import type { AddSourceUrlResult } from '../models/subscription';
import './ProviderConnectModal.scss';

interface SubscriptionConnectModalProps {
  sourceUrls: string[];
  onAddSourceUrl: (url: string) => Promise<AddSourceUrlResult>;
  onRequestGitHubAuth: () => void;
  onConnected: (url: string) => void;
  onClose: () => void;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const SubscriptionConnectModal: React.FC<SubscriptionConnectModalProps> = ({
  sourceUrls,
  onAddSourceUrl,
  onRequestGitHubAuth,
  onConnected,
  onClose,
}) => {
  const [urlInput, setUrlInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [suggestGitHubAuth, setSuggestGitHubAuth] = useState(false);
  const [isValidating, setIsValidating] = useState(false);

  const fail = (message: string, suggestAuth = false) => {
    setError(message);
    setSuggestGitHubAuth(suggestAuth);
  };

  const handleConnect = async () => {
    const next = urlInput.trim();
    if (!next) {
      fail('Enter a URL to connect a library.');
      return;
    }

    if (!isHttpUrl(next)) {
      fail('Library URL must start with http:// or https://');
      return;
    }

    if (sourceUrls.includes(next)) {
      fail('You are already subscribed to that library.');
      return;
    }

    setIsValidating(true);
    let result: AddSourceUrlResult;
    try {
      result = await onAddSourceUrl(next);
    } finally {
      setIsValidating(false);
    }

    if (!result.ok) {
      fail(result.message, Boolean(result.suggestGitHubAuth));
      return;
    }

    onConnected(result.url ?? next);
  };

  const modal = (
    <>
      <div className="modal-backdrop fade show provider-connect-modal-backdrop" onClick={onClose} />
      <div
        className="modal fade show d-block provider-connect-modal"
        tabIndex={-1}
        aria-modal="true"
        role="dialog"
        aria-labelledby="subscriptionConnectModalTitle"
      >
        <div className="modal-dialog modal-dialog-centered">
          <div className="modal-content shadow border-0">
            <div className="modal-header">
              <h2 className="modal-title h5 mb-0 d-flex align-items-center gap-2" id="subscriptionConnectModalTitle">
                <i className="fa-solid fa-link" aria-hidden="true"></i>
                Connect a library
              </h2>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose}></button>
            </div>

            <div className="modal-body d-flex flex-column gap-2">
              <label className="form-label small text-body-secondary mb-0" htmlFor="subscriptionConnectUrl">
                Paste the URL of a translation, translation library, or resource library.
              </label>
              <input
                id="subscriptionConnectUrl"
                type="url"
                className="form-control"
                value={urlInput}
                autoFocus
                onChange={(event) => {
                  setUrlInput(event.target.value);
                  if (error) {
                    setError(null);
                    setSuggestGitHubAuth(false);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void handleConnect();
                  }
                }}
                placeholder="https://example.com/library.json"
                aria-label="Library URL"
              />

              {error && (
                <div className="text-danger small">
                  <span>{error}</span>
                  {suggestGitHubAuth && (
                    <>
                      {' '}
                      <a
                        href="#"
                        onClick={(event) => {
                          event.preventDefault();
                          onRequestGitHubAuth();
                        }}
                      >
                        Authenticate with GitHub
                      </a>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button type="button" className="btn btn-outline-secondary" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary px-4"
                disabled={urlInput.trim().length === 0 || isValidating}
                onClick={() => {
                  void handleConnect();
                }}
              >
                {isValidating ? 'Validating...' : 'Connect'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(modal, document.body);
};

export default SubscriptionConnectModal;
