import React from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setActiveTab, closeTab } from '../store/slices/bibleSlice';
import { resolveSelectedVerseContext } from '../utils/selectedVerseContext';
import type { PanelTab } from '../models/tab';

interface MobilePanelTabStripProps {
  tabs: PanelTab[];
  activeTabId: string | null;
  isMobilePanelOpen: boolean;
  onToggle: () => void;
}

const MobilePanelTabStrip: React.FC<MobilePanelTabStripProps> = ({
  tabs,
  activeTabId,
  isMobilePanelOpen,
  onToggle,
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
            <span
              className={`mobile-panel-vtab-close${tab.id === activeTabId ? '' : ' is-hidden'}`}
              role="button"
              tabIndex={tab.id === activeTabId ? 0 : -1}
              aria-hidden={tab.id === activeTabId ? undefined : true}
              aria-label={tab.id === activeTabId ? `Close ${tab.title}` : undefined}
              onClick={(event) => {
                if (tab.id !== activeTabId) return;
                event.stopPropagation();
                dispatch(closeTab({
                  tabId: tab.id,
                  verseContext: selectedVerseContext,
                }));
              }}
              onKeyDown={(event) => {
                if (tab.id !== activeTabId) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  event.stopPropagation();
                  dispatch(closeTab({
                    tabId: tab.id,
                    verseContext: selectedVerseContext,
                  }));
                }
              }}
            >
              ×
            </span>
            <i className={tab.iconClass} aria-hidden="true"></i>
            <span className="mobile-panel-vtab-title">{tab.title}</span>
          </button>
        ))}
    </div>
  );
};

export default MobilePanelTabStrip;
