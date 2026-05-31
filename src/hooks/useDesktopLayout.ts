import { useState, useEffect } from 'react';
import { DESKTOP_BREAKPOINT } from '../App';

export const useDesktopLayout = (): boolean => {
  const [isDesktopLayout, setIsDesktopLayout] = useState(
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(DESKTOP_BREAKPOINT).matches
      : true
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia(DESKTOP_BREAKPOINT);
    const updateLayout = (event?: MediaQueryListEvent) => {
      setIsDesktopLayout(event ? event.matches : mediaQuery.matches);
    };

    updateLayout();
    mediaQuery.addEventListener('change', updateLayout);
    return () => mediaQuery.removeEventListener('change', updateLayout);
  }, []);

  return isDesktopLayout;
};
