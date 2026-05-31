import { useEffect } from 'react';
import type { WorkspacePanelKey } from '../App';

interface UseMobilePanelEffectsProps {
  isMobileLayout: boolean;
  isMobilePanelOpen: boolean;
  isDesktopLayout: boolean;
  isPanelDetached: boolean;
  activeWorkspacePanel: WorkspacePanelKey | null;
  setIsMobilePanelOpen: (open: boolean) => void;
}

export const useMobilePanelEffects = ({
  isMobileLayout,
  isMobilePanelOpen,
  isDesktopLayout,
  isPanelDetached,
  activeWorkspacePanel,
  setIsMobilePanelOpen,
}: UseMobilePanelEffectsProps): void => {
  // Close mobile panel when switching to desktop, detaching, or clearing panel
  useEffect(() => {
    if (isDesktopLayout || isPanelDetached || !activeWorkspacePanel) {
      setIsMobilePanelOpen(false);
    }
  }, [isDesktopLayout, isPanelDetached, activeWorkspacePanel, setIsMobilePanelOpen]);

  // Escape key closes mobile panel
  useEffect(() => {
    if (!isMobileLayout || !isMobilePanelOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMobilePanelOpen(false);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isMobileLayout, isMobilePanelOpen, setIsMobilePanelOpen]);

  // Toggle body class to prevent background scroll
  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.body.classList.toggle('mobile-panel-open', isMobileLayout && isMobilePanelOpen);
    return () => {
      document.body.classList.remove('mobile-panel-open');
    };
  }, [isMobileLayout, isMobilePanelOpen]);
};
