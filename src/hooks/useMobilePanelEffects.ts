import { useEffect } from 'react';
import type { WorkspacePanelKey } from '../App';

interface UseMobilePanelEffectsProps {
  isPanelFloating: boolean;
  isMobilePanelOpen: boolean;
  isPanelDockedDesktop: boolean;
  isPanelDetached: boolean;
  activeWorkspacePanel: WorkspacePanelKey | null;
  setIsMobilePanelOpen: (open: boolean) => void;
}

export const useMobilePanelEffects = ({
  isPanelFloating,
  isMobilePanelOpen,
  isPanelDockedDesktop,
  isPanelDetached,
  activeWorkspacePanel,
  setIsMobilePanelOpen,
}: UseMobilePanelEffectsProps): void => {
  // Close floating panel when docking on desktop, detaching, or clearing panel
  useEffect(() => {
    if (isPanelDockedDesktop || isPanelDetached || !activeWorkspacePanel) {
      setIsMobilePanelOpen(false);
    }
  }, [isPanelDockedDesktop, isPanelDetached, activeWorkspacePanel, setIsMobilePanelOpen]);

  // Escape key closes floating panel
  useEffect(() => {
    if (!isPanelFloating || !isMobilePanelOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMobilePanelOpen(false);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isPanelFloating, isMobilePanelOpen, setIsMobilePanelOpen]);

  // Toggle body class to prevent background scroll
  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.body.classList.toggle('mobile-panel-open', isPanelFloating && isMobilePanelOpen);
    return () => {
      document.body.classList.remove('mobile-panel-open');
    };
  }, [isPanelFloating, isMobilePanelOpen]);
};
