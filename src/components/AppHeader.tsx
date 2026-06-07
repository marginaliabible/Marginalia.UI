import React from 'react';
import AppHeaderIcon from '../assets/gitbible-header-icon.svg?react';

interface AppHeaderProps {
  onOpenSettings: () => void;
}

const AppHeader: React.FC<AppHeaderProps> = ({ onOpenSettings }) => {
  return (
    <header className="card border-0 shadow-sm mb-4">
      <div className="card-body d-flex flex-column flex-lg-row gap-3 align-items-lg-start justify-content-lg-between">
        <div className="d-flex align-items-start gap-3">
          <AppHeaderIcon
            width={52}
            height={52}
            className="app-header-icon flex-shrink-0"
          />
          <div>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <h1 className="display-6 fw-semibold mb-0">GitBible</h1>
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
            <p className="text-body-secondary mb-0">
              Browse Scripture offline, search quickly, and jump to any verse.
            </p>
          </div>
        </div>
      </div>
    </header>
  );
};

export default AppHeader;
