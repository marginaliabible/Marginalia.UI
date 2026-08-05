import React from 'react';
import AppHeaderIcon from '../assets/gitbible-header-icon.svg?react';

interface AppHeaderProps {
  onOpenSettings: () => void;
  accountControl?: React.ReactNode;
}

const AppHeader: React.FC<AppHeaderProps> = ({ onOpenSettings, accountControl }) => {
  return (
    <header className="card border-0 shadow-sm mb-4">
      <div className="card-body d-flex flex-column gap-3">
        <div className="d-flex align-items-start justify-content-end">
          <div className="d-flex align-items-center gap-2 app-header-controls">
            {accountControl}
            <button
              type="button"
              className="btn btn-outline-secondary rounded-circle d-inline-flex align-items-center justify-content-center"
              aria-label="Open settings"
              data-bs-toggle="modal"
              data-bs-target="#settingsModal"
              onClick={onOpenSettings}
            >
              <i className="bi bi-gear-fill" aria-hidden="true"></i>
            </button>
          </div>
        </div>

        <div className="d-flex align-items-start gap-2">
          <AppHeaderIcon
            width={72}
            height={72}
            className="app-header-icon flex-shrink-0"
          />
          <div>
            <h1 className="display-6 fw-semibold mb-0">Marginalia</h1>
            <p className="text-body-secondary mb-0">
              Bibles were meant to be open.
            </p>
          </div>
        </div>
      </div>
    </header>
  );
};

export default AppHeader;
