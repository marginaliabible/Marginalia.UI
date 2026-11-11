import React from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setActiveTab } from '../store/slices/bibleSlice';
import { resolveSelectedVerseContext } from '../utils/selectedVerseContext';
import type { PanelTab } from '../models/tab';

interface MobilePanelTabStripProps {
  tabs: PanelTab[];
  activeTabId: string | null;
  isMobilePanelOpen: boolean;
  onToggle: () => void;
  showDockToggle: boolean;
  onDockPanel: () => void;
}

const MobilePanelTabStrip: React.FC<MobilePanelTabStripProps> = ({
  tabs,
  activeTabId,
  isMobilePanelOpen,
  onToggle,
  showDockToggle,
  onDockPanel,
}) => {
  const dispatch = useAppDispatch();
  const { selectedBook, selectedChapter, selectedVerses } = useAppSelector((state) => state.ui);
  const selectedVerseContext = resolveSelectedVerseContext(selectedBook, selectedChapter, selectedVerses);

  return (
    <div className={`mobile-panel-tab-strip ${isMobilePanelOpen ? 'is-open' : 'is-collapsed'}`}>
      <button
        type="button"
        className="mobile-panel-strip-chevron"
        aria-label={isMobilePanelOpen ? 'Close side panel' : 'Open side panel'}
        onClick={onToggle}
      >
        <i
          className={`bi ${isMobilePanelOpen ? 'bi-chevron-double-right' : 'bi-chevron-double-left'}`}
          aria-hidden="true"
        ></i>
      </button>
      {isMobilePanelOpen && showDockToggle && (
        <button
          type="button"
          className="mobile-panel-strip-dock"
          aria-label="Dock panel"
          title="Dock panel"
          onClick={onDockPanel}
        >
          <i className="fa-solid fa-thumbtack" aria-hidden="true"></i>
        </button>
      )}
      {isMobilePanelOpen &&
        tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`mobile-panel-vtab${tab.id === activeTabId ? ' is-active' : ''}`}
            aria-label={tab.title}
            onClick={() => {
              dispatch(setActiveTab({
                tabId: tab.id,
                verseContext: selectedVerseContext,
              }));
            }}
          >
            <i className={tab.iconClass} aria-hidden="true"></i>
            <span className="mobile-panel-vtab-title">{tab.title}</span>
          </button>
        ))}
    </div>
  );
};

export default MobilePanelTabStrip;
