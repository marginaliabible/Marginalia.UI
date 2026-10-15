import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import type { FederatedProvider } from '../models/bible';
import './ProviderConnectModal.scss';

export type ProviderConnectMode = 'connect' | 'upgrade' | 'reconnect' | 'disconnect';

export interface ProviderSyncDraft {
  syncSettings: boolean;
  syncFiles: boolean;
}

interface ProviderConnectModalProps {
  provider: FederatedProvider;
  mode: ProviderConnectMode;
  accountLabel: string | null;
  initialDraft: ProviderSyncDraft;
  onConnect: (draft: ProviderSyncDraft) => void;
  onReconnect: () => void;
  onDisconnect: () => void;
  onClose: () => void;
}

const PROVIDER_LABEL: Record<FederatedProvider, string> = {
  google: 'Google',
  microsoft: 'Microsoft',
};

const PROVIDER_ICON: Record<FederatedProvider, string> = {
  google: 'fa-google',
  microsoft: 'fa-microsoft',
};

const STORAGE_LABEL: Record<FederatedProvider, string> = {
  google: 'Google Drive',
  microsoft: 'OneDrive',
};

const STORAGE_SHORT_LABEL: Record<FederatedProvider, string> = {
  google: 'Drive',
  microsoft: 'OneDrive',
};

// Sync Files requires Sync Settings (marginalia-config.json is the selection SoT).
function toggleDraft(draft: ProviderSyncDraft, field: keyof ProviderSyncDraft): ProviderSyncDraft {
  const nextValue = !draft[field];
  if (field === 'syncFiles' && nextValue) {
    return { syncSettings: true, syncFiles: true };
  }
  if (field === 'syncSettings' && !nextValue) {
    return { syncSettings: false, syncFiles: false };
  }
  return { ...draft, [field]: nextValue };
}

const ProviderConnectModal: React.FC<ProviderConnectModalProps> = ({
  provider,
  mode,
  accountLabel,
  initialDraft,
  onConnect,
  onReconnect,
  onDisconnect,
  onClose,
}) => {
  const [draft, setDraft] = useState<ProviderSyncDraft>(initialDraft);

  const settingsLocked = mode !== 'connect';
  const filesLocked = mode === 'reconnect' || mode === 'disconnect';
  const lockedTitle = mode === 'upgrade' ? undefined : 'Reconnect to modify';
  const connected = mode !== 'connect';
  const storageLabel = STORAGE_LABEL[provider];

  let primaryAction: React.ReactNode;
  if (mode === 'connect') {
    primaryAction = (
      <button
        type="button"
        className="btn btn-primary px-4"
        disabled={!draft.syncSettings && !draft.syncFiles}
        onClick={() => onConnect(draft)}
      >
        Connect
      </button>
    );
  } else if (mode === 'upgrade') {
    primaryAction = (
      <button
        type="button"
        className="btn btn-primary px-4"
        disabled={!draft.syncFiles}
        onClick={() => onConnect(draft)}
      >
        Connect
      </button>
    );
  } else if (mode === 'reconnect') {
    primaryAction = (
      <button type="button" className="btn btn-primary px-4" onClick={onReconnect}>
        Reconnect
      </button>
    );
  } else {
    primaryAction = (
      <button type="button" className="btn btn-danger px-4" onClick={onDisconnect}>
        Disconnect
      </button>
    );
  }

  const modal = (
    <>
      <div className="modal-backdrop fade show provider-connect-modal-backdrop" onClick={onClose} />
      <div
        className={`modal fade show d-block provider-connect-modal provider-connect-modal-${provider}`}
        tabIndex={-1}
        aria-modal="true"
        role="dialog"
        aria-labelledby="providerConnectModalTitle"
      >
        <div className="modal-dialog modal-dialog-centered">
          <div className="modal-content shadow border-0">
            <div className="modal-header">
              <h2 className="modal-title h5 mb-0 d-flex align-items-center gap-2" id="providerConnectModalTitle">
                <i className={`fa-brands ${PROVIDER_ICON[provider]}`} aria-hidden="true"></i>
                {connected ? 'Connected to' : 'Connect to'} {PROVIDER_LABEL[provider]}
              </h2>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose}></button>
            </div>

            <div className="modal-body d-flex flex-column gap-3">
              {connected && accountLabel && (
                <div className="provider-connect-account">
                  <i className="fa-regular fa-circle-check provider-connect-account-icon" aria-hidden="true"></i>
                  <span className="text-truncate">{accountLabel}</span>
                </div>
              )}

              <label className="account-provider-option" htmlFor={`${provider}-sync-settings`}>
                <input
                  id={`${provider}-sync-settings`}
                  type="checkbox"
                  checked={draft.syncSettings}
                  disabled={settingsLocked}
                  title={settingsLocked ? lockedTitle : undefined}
                  onChange={() => setDraft((current) => toggleDraft(current, 'syncSettings'))}
                />
                <span className="account-provider-option-content">
                  <span className="account-provider-option-title">Sync my settings</span>
                  <span className="account-provider-option-description">
                    Stores your Marginalia settings in {storageLabel}. This backs up your settings and lets you sync them across all your devices. We'll only access a tiny file in your {STORAGE_SHORT_LABEL[provider]}.
                  </span>
                </span>
              </label>

              <label className="account-provider-option" htmlFor={`${provider}-sync-files`}>
                <input
                  id={`${provider}-sync-files`}
                  type="checkbox"
                  checked={draft.syncFiles}
                  disabled={filesLocked}
                  title={filesLocked ? lockedTitle : undefined}
                  onChange={() => setDraft((current) => toggleDraft(current, 'syncFiles'))}
                />
                <span className="account-provider-option-content">
                  <span className="account-provider-option-title">Sync my files</span>
                  <span className="account-provider-option-description">
                    Access your own Bible notes directly in Marginalia, indexed by verse! This requires read access to your entire {storageLabel}, but you can pick which files & folders you want to sync and we pinky promise to only ever look at those files.
                  </span>
                </span>
              </label>
            </div>

            <div className="modal-footer">
              {mode === 'upgrade' && (
                <button type="button" className="btn btn-outline-danger me-auto" onClick={onDisconnect}>
                  Disconnect
                </button>
              )}
              <button type="button" className="btn btn-outline-secondary" onClick={onClose}>
                Cancel
              </button>
              {primaryAction}
            </div>
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(modal, document.body);
};

export default ProviderConnectModal;
