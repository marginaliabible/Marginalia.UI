import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import SidePanelContent from './SidePanelContent';
import PdfViewerPane from './PdfViewerPane';
import MarkupDocumentViewer from './MarkupDocumentViewer';
import { useAppSelector } from '../store/hooks';
import WorkspaceDivider from './WorkspaceDivider';

interface DetachedPanelPortalProps {
  isPanelDetached: boolean;
  hasActiveWorkspacePanel: boolean;
  popupContainer: HTMLElement | null;
  pdfViewerIsOpen: boolean;
  sidePanelContentProps: React.ComponentProps<typeof SidePanelContent>;
}

const DetachedPanelPortal: React.FC<DetachedPanelPortalProps> = ({
  isPanelDetached,
  hasActiveWorkspacePanel,
  popupContainer,
  pdfViewerIsOpen,
  sidePanelContentProps,
}) => {
  const { pdfViewer } = useAppSelector((state) => state.ui);
  const detachedWorkspaceRef = useRef<HTMLDivElement | null>(null);
  const [detachedPanelPercent, setDetachedPanelPercent] = useState(54);
  const [isDetachedPanelWide, setIsDetachedPanelWide] = useState(true);

  useEffect(() => {
    if (!isPanelDetached || !popupContainer) {
      return;
    }

    const detachedWindow = popupContainer.ownerDocument.defaultView;
    if (!detachedWindow) {
      return;
    }

    const syncDetachedOrientation = () => {
      setIsDetachedPanelWide(detachedWindow.innerWidth >= detachedWindow.innerHeight);
    };

    syncDetachedOrientation();
    detachedWindow.addEventListener('resize', syncDetachedOrientation);
    return () => {
      detachedWindow.removeEventListener('resize', syncDetachedOrientation);
    };
  }, [isPanelDetached, popupContainer]);

  const handleDetachedDividerPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!isPanelDetached || !popupContainer || !detachedWorkspaceRef.current) {
      return;
    }

    event.preventDefault();
    const detachedWindow = popupContainer.ownerDocument.defaultView ?? window;
    const bounds = detachedWorkspaceRef.current.getBoundingClientRect();

    const updateSplit = (clientX: number, clientY: number) => {
      if (isDetachedPanelWide) {
        const ratio = (clientX - bounds.left) / bounds.width;
        const clamped = Math.min(0.72, Math.max(0.28, ratio));
        setDetachedPanelPercent(Math.round(clamped * 1000) / 10);
        return;
      }

      const ratio = (clientY - bounds.top) / bounds.height;
      const clamped = Math.min(0.72, Math.max(0.28, ratio));
      setDetachedPanelPercent(Math.round(clamped * 1000) / 10);
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateSplit(moveEvent.clientX, moveEvent.clientY);
    };

    const handlePointerUp = () => {
      detachedWindow.removeEventListener('pointermove', handlePointerMove);
      detachedWindow.removeEventListener('pointerup', handlePointerUp);
    };

    detachedWindow.addEventListener('pointermove', handlePointerMove);
    detachedWindow.addEventListener('pointerup', handlePointerUp);
  }, [isPanelDetached, popupContainer, isDetachedPanelWide]);

  const handleDetachedDividerKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const decreaseKeys = isDetachedPanelWide ? ['ArrowLeft'] : ['ArrowUp'];
    const increaseKeys = isDetachedPanelWide ? ['ArrowRight'] : ['ArrowDown'];

    if (decreaseKeys.includes(event.key)) {
      event.preventDefault();
      setDetachedPanelPercent((value) => Math.max(28, value - 3));
      return;
    }

    if (increaseKeys.includes(event.key)) {
      event.preventDefault();
      setDetachedPanelPercent((value) => Math.min(72, value + 3));
    }
  }, [isDetachedPanelWide]);

  if (!isPanelDetached || !hasActiveWorkspacePanel || !popupContainer) {
    return null;
  }

  return createPortal(
    pdfViewerIsOpen ? (
      <div
        ref={detachedWorkspaceRef}
        className={`detached-workspace-layout ${isDetachedPanelWide ? 'is-row' : 'is-column'}`}
      >
        <div
          className="workspace-scroll panel-scroll-with-tabs popout-panel-shell detached-panel-pane"
          style={{ flexBasis: `${detachedPanelPercent}%` }}
        >
          <SidePanelContent {...sidePanelContentProps} />
        </div>

        <WorkspaceDivider
          orientation={isDetachedPanelWide ? 'vertical' : 'horizontal'}
          onPointerDown={handleDetachedDividerPointerDown}
          onKeyDown={handleDetachedDividerKeyDown}
        />

        <section
          className="workspace-pane workspace-main detached-pdf-pane"
          style={{ flexBasis: `${100 - detachedPanelPercent}%` }}
        >
          <div className="card border-0 shadow-sm h-100">
            <div className="card-body workspace-scroll pb-3">
              {pdfViewer.kind === 'markup' ? <MarkupDocumentViewer /> : <PdfViewerPane />}
            </div>
          </div>
        </section>
      </div>
    ) : (
      <div className="workspace-scroll panel-scroll-with-tabs popout-panel-shell">
        <SidePanelContent {...sidePanelContentProps} />
      </div>
    ),
    popupContainer
  );
};

export default DetachedPanelPortal;