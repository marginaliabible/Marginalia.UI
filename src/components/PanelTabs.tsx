import React from 'react';
import type { PanelTab } from '../models/tab';

interface PanelTabsProps {
  tabs: PanelTab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  isDetached: boolean;
  showDetachButton: boolean;
  onToggleDetach: () => void;
}

const PanelTabs: React.FC<PanelTabsProps> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  isDetached,
  showDetachButton,
  onToggleDetach
}) => {
  if (tabs.length === 0) {
    return null;
  }

  return (
    <div className="panel-tabs">
      <div className="d-flex align-items-center justify-content-between gap-2 panel-tabs-header">
        <ul className="nav nav-tabs panel-nav-tabs" role="tablist">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <li className="nav-item" role="presentation" key={tab.id}>
                <button
                  type="button"
                  className={`nav-link d-flex align-items-center gap-2 ${isActive ? 'active' : ''}`}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => onSelectTab(tab.id)}
                  data-help={`panel-tab-${tab.type}`}
                >
                  <i className={tab.iconClass} aria-hidden="true"></i>
                  <span className="panel-tab-title">{tab.title}</span>
                  <span
                    className="panel-tab-close"
                    role="button"
                    tabIndex={0}
                    aria-label={`Close ${tab.title}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onCloseTab(tab.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.stopPropagation();
                        onCloseTab(tab.id);
                      }
                    }}
                  >
                    x
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {showDetachButton && (
          <button
            type="button"
            className={`btn btn-sm d-inline-flex align-items-center justify-content-center px-2 ${isDetached ? 'btn-primary' : 'btn-outline-secondary'}`}
            onClick={onToggleDetach}
            title={isDetached ? 'Return to the main browser window' : 'Pop into a new browser window'}
            aria-label={isDetached ? 'Return to the main browser window' : 'Pop into a new browser window'}
          >
            <i
              className={`fa-solid fa-up-right-from-square pop-toggle-icon ${isDetached ? 'is-pop-in' : ''}`}
              aria-hidden="true"
            ></i>
          </button>
        )}
      </div>
    </div>
  );
};

export default PanelTabs;
