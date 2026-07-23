import React, { useEffect, useRef } from 'react';
import PanelTabs from './PanelTabs';
import SearchResults from './SearchResults';
import TranslationsPanel from './TranslationsPanel';
import ResourcesPanel from './ResourcesPanel';
import { useAppSelector } from '../store/hooks';
import type { QuickJumpTarget, BibleTranslationMeta, TranslationRecord } from '../models/bible';
import type { PanelTab } from '../models/tab';

interface SidePanelContentProps {
  isMobileLayout: boolean;
  isDesktopLayout: boolean;
  isPanelDetached: boolean;
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
  onCloseTab: (tabId: string) => void;
  onToggleDetach: () => void;
  focusMainWindow: () => void;
}

const SidePanelContent: React.FC<SidePanelContentProps> = ({
  isMobileLayout,
  isDesktopLayout,
  isPanelDetached,
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
  onCloseTab,
  onToggleDetach,
  focusMainWindow,
}) => {
  const { tabs, activeTabId } = useAppSelector((state) => state.bible);
  const contentRef = useRef<HTMLDivElement | null>(null);

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
      {!isMobileLayout && (
        <PanelTabs
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={onSelectTab}
          onCloseTab={onCloseTab}
          isDetached={isPanelDetached}
          showDetachButton={isDesktopLayout}
          onToggleDetach={onToggleDetach}
        />
      )}
      <div className="panel-tabs-content" ref={contentRef}>
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
                  if (isMobileLayout && isMobilePanelOpen) {
                    setIsMobilePanelOpen(false);
                  }
                  if (isPanelDetached) {
                    focusMainWindow();
                  }
                }}
              />
            ) : tab.type === 'translations' ? (
              <TranslationsPanel
                tab={tab}
                translationRecords={translationRecords}
                translationMetadataById={translationMetadataById}
                addableTranslations={addableTranslations}
                onAddTranslation={onAddTranslation}
                onRemoveTranslation={onRemoveTranslation}
                onToggleStar={onToggleStar}
                onReorder={onReorder}
              />
            ) : tab.type === 'resources' ? (
              <ResourcesPanel tab={tab} />
            ) : null}
            <div className="pb-4" aria-hidden="true"></div>
          </div>
        ))}
      </div>
    </>
  );
};

export default SidePanelContent;
