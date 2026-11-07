import React, { createContext, useContext, useMemo } from 'react';

export interface StartTourOptions {
  /** Jump to a specific step (e.g. from a target: help link). Ignores saved resume. */
  stepIndex?: number;
}

interface HelpTourContextValue {
  startTour: (tourId: string, options?: StartTourOptions) => void;
  /** Resolve a target: link to a tour step and start there. */
  startTourAtTarget: (targetSpec: string) => void;
}

const HelpTourContext = createContext<HelpTourContextValue>({
  startTour: () => {
    // No-op until HelpTourRunner mounts and provides a real starter.
  },
  startTourAtTarget: () => {
    // No-op until HelpTourRunner mounts.
  },
});

export const HelpTourProvider: React.FC<{
  startTour: (tourId: string, options?: StartTourOptions) => void;
  startTourAtTarget: (targetSpec: string) => void;
  children: React.ReactNode;
}> = ({ startTour, startTourAtTarget, children }) => {
  const value = useMemo(
    () => ({ startTour, startTourAtTarget }),
    [startTour, startTourAtTarget]
  );
  return <HelpTourContext.Provider value={value}>{children}</HelpTourContext.Provider>;
};

export function useHelpTour(): HelpTourContextValue {
  return useContext(HelpTourContext);
}
