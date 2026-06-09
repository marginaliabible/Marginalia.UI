import React from 'react';
import MobilePanelTabStrip from './MobilePanelTabStrip';
import SidePanelContent from './SidePanelContent';
import { useAppSelector } from '../store/hooks';
import type { QuickJumpTarget, BibleTranslationMeta, TranslationRecord } from '../models/bible';

interface WorkspaceSidePanelProps {
  isMobileLayout: boolean;
  isDesktopLayout: boolean;
  isPanelDetached: boolean;
  isMobilePanelOpen: boolean;
  setIsMobilePanelOpen: (open: boolean) => void;
  sidePanePercent: number;
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
}

const WorkspaceSidePanel: React.FC<WorkspaceSidePanelProps> = ({
  isMobileLayout,
  isDesktopLayout,
  isPanelDetached,
  isMobilePanelOpen,
  setIsMobilePanelOpen,
  sidePanePercent,
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
}) => {
  const { tabs, activeTabId } = useAppSelector((state) => state.bible);

  return (
    <aside
      id="workspace-side-panel"
      className={`workspace-pane workspace-side ${isMobilePanelOpen ? 'is-open' : ''}`}
      style={isDesktopLayout ? { flexBasis: `${sidePanePercent}%` } : undefined}
    >
      {isMobileLayout && (
        <MobilePanelTabStrip
          tabs={tabs}
          activeTabId={activeTabId}
          isMobilePanelOpen={isMobilePanelOpen}
          onToggle={() => setIsMobilePanelOpen(!isMobilePanelOpen)}
        />
      )}
      <div className="workspace-scroll panel-scroll-with-tabs">
        <SidePanelContent
          isMobileLayout={isMobileLayout}
          isDesktopLayout={isDesktopLayout}
          isPanelDetached={isPanelDetached}
          isMobilePanelOpen={isMobilePanelOpen}
          setIsMobilePanelOpen={setIsMobilePanelOpen}
          goToReference={goToReference}
          translationRecords={translationRecords}
          translationMetadataById={translationMetadataById}
          addableTranslations={addableTranslations}
          onAddTranslation={onAddTranslation}
          onRemoveTranslation={onRemoveTranslation}
          onToggleStar={onToggleStar}
          onReorder={onReorder}
          onSelectTab={onSelectTab}
          onCloseTab={onCloseTab}
          onToggleDetach={onToggleDetach}
        />
      </div>
    </aside>
  );
};

export default WorkspaceSidePanel;
