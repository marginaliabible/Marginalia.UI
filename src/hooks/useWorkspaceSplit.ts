import type { WorkspacePanelKey } from '../App';
import { useHorizontalSplit } from './useHorizontalSplit';

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
  const { primaryPercent, secondaryPercent, handleDividerPointerDown, handleDividerKeyDown } = useHorizontalSplit({
    containerRef: workspaceRef,
    initialPercent: 66.7,
    minPercent: 42,
    maxPercent: 80,
    stepPercent: 3,
    enabled: isDesktopLayout && Boolean(activeWorkspacePanel),
  });

  const mainPanePercent = primaryPercent;
  const sidePanePercent = secondaryPercent;

  return { mainPanePercent, sidePanePercent, handleDividerPointerDown, handleDividerKeyDown };
};
