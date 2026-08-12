import { useCallback, useState } from 'react';

interface UseHorizontalSplitOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  initialPercent: number;
  minPercent: number;
  maxPercent: number;
  stepPercent?: number;
  enabled?: boolean;
}

interface UseHorizontalSplitResult {
  primaryPercent: number;
  secondaryPercent: number;
  handleDividerPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  handleDividerKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
}

function clampPercent(value: number, minPercent: number, maxPercent: number): number {
  return Math.min(maxPercent, Math.max(minPercent, value));
}

export const useHorizontalSplit = ({
  containerRef,
  initialPercent,
  minPercent,
  maxPercent,
  stepPercent = 3,
  enabled = true,
}: UseHorizontalSplitOptions): UseHorizontalSplitResult => {
  const [primaryPercent, setPrimaryPercent] = useState(() => {
    const clamped = clampPercent(initialPercent, minPercent, maxPercent);
    return Math.round(clamped * 10) / 10;
  });

  const handleDividerPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!enabled || !containerRef.current) {
      return;
    }

    event.preventDefault();
    const bounds = containerRef.current.getBoundingClientRect();

    const updateSplit = (clientX: number) => {
      const ratio = ((clientX - bounds.left) / bounds.width) * 100;
      const clamped = clampPercent(ratio, minPercent, maxPercent);
      setPrimaryPercent(Math.round(clamped * 10) / 10);
    };

    const onMove = (moveEvent: PointerEvent) => {
      updateSplit(moveEvent.clientX);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [containerRef, enabled, maxPercent, minPercent]);

  const handleDividerKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!enabled) {
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setPrimaryPercent((current) => Math.round(clampPercent(current - stepPercent, minPercent, maxPercent) * 10) / 10);
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setPrimaryPercent((current) => Math.round(clampPercent(current + stepPercent, minPercent, maxPercent) * 10) / 10);
    }
  }, [enabled, maxPercent, minPercent, stepPercent]);

  return {
    primaryPercent,
    secondaryPercent: 100 - primaryPercent,
    handleDividerPointerDown,
    handleDividerKeyDown,
  };
};
