import React from 'react';
import SidePanelContent from './SidePanelContent';
import { useAppSelector } from '../store/hooks';

interface PanelWindowShellProps {
  sidePanelContentProps: React.ComponentProps<typeof SidePanelContent>;
  /** The panel went back to the main window, but this window couldn't close itself. */
  isDocked?: boolean;
}

/** The whole page of a `popout=panel` window: just the side panel, full height. */
const PanelWindowShell: React.FC<PanelWindowShellProps> = ({ sidePanelContentProps, isDocked = false }) => {
  const hasTabs = useAppSelector((state) => state.bible.tabs.length > 0);

  if (isDocked) {
    return (
      <div className="panel-window-shell">
        <div className="card border-0 shadow-sm h-100">
          <div className="card-body d-flex flex-column justify-content-center align-items-center text-center">
            <p className="text-body-secondary mb-0">The panel is back in the main window. You can close this tab.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="panel-window-shell">
      <div className="workspace-scroll panel-scroll-with-tabs">
        {hasTabs ? (
          <SidePanelContent {...sidePanelContentProps} />
        ) : (
          <div className="card border-0 shadow-sm h-100">
            <div className="card-body d-flex flex-column justify-content-center align-items-center text-center gap-3">
              <p className="text-body-secondary mb-0">Click a verse or run a search to fill this panel.</p>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={sidePanelContentProps.onToggleDetach}
              >
                <i className="fa-solid fa-up-right-from-square pop-toggle-icon is-pop-in me-2" aria-hidden="true"></i>
                Return to the main browser window
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PanelWindowShell;
