import { useState } from 'react';
import type { WorkspacePanelKey } from '../App';

interface UseWorkspaceSplitProps {
  workspaceRef: React.RefObject<HTMLDivElement | null>;
  isDesktopLayout: boolean;
  activeWorkspacePanel: WorkspacePanelKey | null;
}

interface UseWorkspaceSplitReturn {
  mainPanePercent: number;
  sidePanePercent: number;
  handleDividerPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  handleDividerKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
}

export const useWorkspaceSplit = ({
  workspaceRef,
  isDesktopLayout,
  activeWorkspacePanel,
}: UseWorkspaceSplitProps): UseWorkspaceSplitReturn => {
  const [mainPaneRatio, setMainPaneRatio] = useState(2 / 3);

  const handleDividerPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDesktopLayout || !activeWorkspacePanel || !workspaceRef.current) {
      return;
    }

    event.preventDefault();
    const workspace = workspaceRef.current;
    const bounds = workspace.getBoundingClientRect();

    const updateRatio = (clientX: number) => {
      const ratio = (clientX - bounds.left) / bounds.width;
      const clamped = Math.min(0.8, Math.max(0.42, ratio));
      setMainPaneRatio(clamped);
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateRatio(moveEvent.clientX);
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const handleDividerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setMainPaneRatio((value) => Math.max(0.42, value - 0.03));
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setMainPaneRatio((value) => Math.min(0.8, value + 0.03));
    }
  };

  const mainPanePercent = Math.round(mainPaneRatio * 1000) / 10;
  const sidePanePercent = 100 - mainPanePercent;

  return { mainPanePercent, sidePanePercent, handleDividerPointerDown, handleDividerKeyDown };
};
