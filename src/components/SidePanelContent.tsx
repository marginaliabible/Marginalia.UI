import React, { useEffect, useRef } from 'react';
import PanelTabs from './PanelTabs';
import SearchResults from './SearchResults';
import TranslationsPanel from './TranslationsPanel';
import ResourcesPanel from './ResourcesPanel';
import LinksPanel from './LinksPanel';
import HelpPanel from './HelpPanel';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { loadTranslations, runSearchInTab, setActiveTab } from '../store/slices/bibleSlice';
import type { QuickJumpTarget, BibleTranslationMeta, TranslationRecord } from '../models/bible';
import type { PanelTab } from '../models/tab';

interface SidePanelContentProps {
  isDesktopLayout: boolean;
  isPanelDetached: boolean;
  isPanelFloating: boolean;
  isMobilePanelOpen: boolean;
  setIsMobilePanelOpen: (open: boolean) => void;
  goToReference: (target: QuickJumpTarget, translationId?: string) => Promise<void>;
  translationRecords: TranslationRecord[];
  translationMetadataById: Map<string, BibleTranslationMeta>;
  addableTranslations: BibleTranslationMeta[];
  onAddTranslation: (id: string) => void;
  onRemoveTranslation: (id: string) => void;
  onToggleStar: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onSelectTab: (tabId: string) => void;
  onToggleDetach: () => void;
  onFloatPanel: () => void;
  focusMainWindow: () => void;
}

const SidePanelContent: React.FC<SidePanelContentProps> = ({
  isDesktopLayout,
  isPanelDetached,
  isPanelFloating,
  isMobilePanelOpen,
  setIsMobilePanelOpen,
  goToReference,
  translationRecords,
  translationMetadataById,
  addableTranslations,
  onAddTranslation,
  onRemoveTranslation,
  onToggleStar,
  onReorder,
  onSelectTab,
  onToggleDetach,
  onFloatPanel,
  focusMainWindow,
}) => {
  const dispatch = useAppDispatch();
  const { tabs, activeTabId } = useAppSelector((state) => state.bible);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const isPanelVisible = !isPanelFloating || isMobilePanelOpen;

  const collapseFloatingPanel = () => {
    if (isPanelFloating && isMobilePanelOpen) {
      setIsMobilePanelOpen(false);
    }
  };

  useEffect(() => {
    if (!isPanelVisible || activeTabId || tabs.length !== 1 || tabs[0].type !== 'search') {
      return;
    }

    dispatch(setActiveTab(tabs[0].id));
  }, [activeTabId, dispatch, isPanelVisible, tabs]);

  useEffect(() => {
    const activeTab = tabs.find((tab) => tab.id === activeTabId);
    if (!activeTab || activeTab.type !== 'search' || activeTab.searchResults) {
      return;
    }

    const query = activeTab.title.trim();
    const translationIds = activeTab.translationIds ?? [];
    if (!query || translationIds.length === 0) {
      return;
    }

    void (async () => {
      await dispatch(loadTranslations(translationIds));
      dispatch(runSearchInTab({ tabId: activeTab.id, query, translationIds }));
    })();
  }, [activeTabId, dispatch, tabs]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) {
      return;
    }

    const activePanel = content.querySelector<HTMLElement>('.panel-content-scroll.is-active');
    activePanel?.scrollTo({ top: 0, behavior: 'auto' });
    content.closest<HTMLElement>('.panel-scroll-with-tabs')?.scrollTo({ top: 0, behavior: 'auto' });
  }, [tabs, activeTabId]);

  return (
    <>
      {!isPanelFloating && (
        <PanelTabs
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={onSelectTab}
          isDetached={isPanelDetached}
          showDetachButton={isDesktopLayout}
          onToggleDetach={onToggleDetach}
          showDockToggle={isDesktopLayout && !isPanelDetached}
          onFloatPanel={onFloatPanel}
        />
      )}
      <div className="panel-tabs-content" ref={contentRef} data-help="panel-tabs-content">
        {tabs.map((tab: PanelTab) => (
          <div
            key={tab.id}
            className={`panel-content-scroll${tab.id === activeTabId ? ' is-active' : ''}`}
          >
            {tab.type === 'search' && tab.searchResults ? (
              <SearchResults
                tab={tab}
                goToReference={goToReference}
                onBeforeNavigate={() => {
                  collapseFloatingPanel();
                  if (isPanelDetached) {
                    focusMainWindow();
                  }
                }}
              />
            ) : tab.type === 'translations' ? (
              <TranslationsPanel
                tab={tab}
                isActive={tab.id === activeTabId}
                translationRecords={translationRecords}
                translationMetadataById={translationMetadataById}
                addableTranslations={addableTranslations}
                onAddTranslation={onAddTranslation}
                onRemoveTranslation={onRemoveTranslation}
                onToggleStar={onToggleStar}
                onReorder={onReorder}
                onBeforeNavigate={collapseFloatingPanel}
              />
            ) : tab.type === 'resources' ? (
              <ResourcesPanel
                tab={tab}
                isActive={tab.id === activeTabId}
                onBeforeNavigate={collapseFloatingPanel}
              />
            ) : tab.type === 'links' ? (
              <LinksPanel
                tab={tab}
                isActive={tab.id === activeTabId}
                onBeforeNavigate={collapseFloatingPanel}
              />
            ) : tab.type === 'help' ? (
              <HelpPanel
                tab={tab}
                isActive={tab.id === activeTabId}
              />
            ) : null}
            <div className="pb-4" aria-hidden="true"></div>
          </div>
        ))}
      </div>
    </>
  );
};

export default SidePanelContent;
