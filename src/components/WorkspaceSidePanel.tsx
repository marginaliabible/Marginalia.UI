import React from 'react';
import MobilePanelTabStrip from './MobilePanelTabStrip';
import SidePanelContent from './SidePanelContent';
import { useAppSelector } from '../store/hooks';
import type { QuickJumpTarget, BibleTranslationMeta, TranslationRecord } from '../models/bible';

interface WorkspaceSidePanelProps {
  isMobileLayout: boolean;
  isDesktopLayout: boolean;
  isPanelDetached: boolean;
  isPanelFloated: boolean;
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
  onToggleDetach: () => void;
  onFloatPanel: () => void;
  onDockPanel: () => void;
  focusMainWindow: () => void;
}

const WorkspaceSidePanel: React.FC<WorkspaceSidePanelProps> = ({
  isMobileLayout,
  isDesktopLayout,
  isPanelDetached,
  isPanelFloated,
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
  onToggleDetach,
  onFloatPanel,
  onDockPanel,
  focusMainWindow,
}) => {
  const { tabs, activeTabId } = useAppSelector((state) => state.bible);
  const isPanelFloating = isMobileLayout || isPanelFloated;
  const isDockedDesktop = isDesktopLayout && !isPanelFloated;

  return (
    <aside
      id="workspace-side-panel"
      className={`workspace-pane workspace-side ${isMobilePanelOpen ? 'is-open' : ''}`}
      style={isDockedDesktop ? { flexBasis: `${sidePanePercent}%` } : undefined}
    >
      {isPanelFloating && (
        <MobilePanelTabStrip
          tabs={tabs}
          activeTabId={activeTabId}
          isMobilePanelOpen={isMobilePanelOpen}
          onToggle={() => setIsMobilePanelOpen(!isMobilePanelOpen)}
          showDockToggle={isDesktopLayout}
          onDockPanel={onDockPanel}
        />
      )}
      <div className="workspace-scroll panel-scroll-with-tabs">
        <SidePanelContent
          isDesktopLayout={isDesktopLayout}
          isPanelDetached={isPanelDetached}
          isPanelFloating={isPanelFloating}
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
          onToggleDetach={onToggleDetach}
          onFloatPanel={onFloatPanel}
          focusMainWindow={focusMainWindow}
        />
      </div>
    </aside>
  );
};

export default WorkspaceSidePanel;
