import { useLayoutEffect, useRef } from 'react';

/**
 * Snapshots window scroll when `active` becomes true and restores it when `active` becomes false.
 * Used when the document viewer replaces the Bible chapter (which unmounts the verse DOM and
 * collapses the page, clamping scroll to the top).
 */
export const usePreserveWindowScrollWhile = (active: boolean): void => {
  const savedRef = useRef<{ x: number; y: number } | null>(null);
  const wasActiveRef = useRef(active);

  if (typeof window !== 'undefined' && active && !wasActiveRef.current) {
    savedRef.current = { x: window.scrollX, y: window.scrollY };
  }
  wasActiveRef.current = active;

  useLayoutEffect(() => {
    if (active || typeof window === 'undefined') {
      return;
    }

    const saved = savedRef.current;
    if (!saved) {
      return;
    }

    savedRef.current = null;
    const restore = () => {
      window.scrollTo(saved.x, saved.y);
    };
    restore();
    const rafId = window.requestAnimationFrame(restore);
    return () => window.cancelAnimationFrame(rafId);
  }, [active]);
};
