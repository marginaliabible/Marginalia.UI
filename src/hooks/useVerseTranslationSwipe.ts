import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

type SwipeDirection = 'left' | 'right';

interface SwipeOptions {
  enabled: boolean;
  hasVerseGrid: boolean;
  shellRef: RefObject<HTMLElement | null>;
  translationWindowStart: number;
  stride: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onShift: (direction: SwipeDirection) => void;
  onHorizontalLock: () => void;
  isBlocked: () => boolean;
}

const AXIS_PX = 10;

function rubber(delta: number, min: number, max: number, size: number): number {
  const damp = (over: number) => (over * size * 0.55) / (Math.max(size, 1) + (0.55 * over));
  if (delta < min) return min - damp(min - delta);
  if (delta > max) return max + damp(delta - max);
  return delta;
}

function settle(
  delta: number,
  velocity: number,
  canGoPrevious: boolean,
  canGoNext: boolean,
  stride: number,
): SwipeDirection | null {
  if (!(stride > 0) || delta === 0) return null;
  const distance = Math.min(stride * 0.85, Math.max(48, stride * 0.22));
  const reversing = (delta < 0 && velocity > 0.2) || (delta > 0 && velocity < -0.2);
  const commit = !reversing && (Math.abs(delta) >= distance || (Math.abs(velocity) >= 0.5 && Math.abs(delta) >= 18));
  if (commit && delta < 0 && canGoNext) return 'right';
  if (commit && delta > 0 && canGoPrevious) return 'left';
  return null;
}

function writeOffset(shell: HTMLElement, offset: number, animate: boolean): void {
  const reduce = typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  shell.style.setProperty('--verse-swipe-duration', '0ms');
  if (!animate || reduce) {
    shell.style.setProperty('--verse-swipe-offset', `${offset}px`);
    return;
  }
  void shell.offsetWidth;
  shell.style.setProperty('--verse-swipe-duration', '300ms');
  shell.style.setProperty('--verse-swipe-offset', `${offset}px`);
}

/** Slides the mobile translation columns. Vertical drags stay with page scroll. */
export function useVerseTranslationSwipe(options: SwipeOptions): void {
  const latest = useRef(options);
  latest.current = options;
  const tracking = useRef(false);
  const previous = useRef<{ start: number; stride: number } | null>(null);
  const { enabled, hasVerseGrid, shellRef, stride, translationWindowStart } = options;

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    if (!enabled || !hasVerseGrid || !(stride > 0)) {
      shell.style.removeProperty('--verse-swipe-offset');
      shell.style.removeProperty('--verse-swipe-duration');
      delete shell.dataset['swipeDragging'];
      previous.current = null;
      return;
    }
    if (tracking.current) return;

    const before = previous.current;
    previous.current = { start: translationWindowStart, stride };
    const animate = before !== null
      && before.start !== translationWindowStart
      && Math.abs(before.stride - stride) < 0.5;
    writeOffset(shell, -translationWindowStart * stride, animate);
  }, [enabled, hasVerseGrid, shellRef, stride, translationWindowStart]);

  useEffect(() => {
    if (!enabled || !hasVerseGrid) return;
    const shell = shellRef.current;
    if (!shell) return;

    let pointerId = -1;
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let prevX = 0;
    let prevT = 0;
    let velocity = 0;
    let mode: 'pending' | 'horizontal' | 'vertical' = 'pending';
    let active = false;

    const restOffset = () => -latest.current.translationWindowStart * latest.current.stride;

    const detach = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };

    const finish = (commit: boolean) => {
      const horizontal = mode === 'horizontal';
      const delta = lastX - startX;
      active = false;
      tracking.current = false;
      mode = 'pending';
      detach();
      delete shell.dataset['swipeDragging'];
      if (!horizontal) return;

      const current = latest.current;
      const direction = commit
        ? settle(delta, velocity, current.canGoPrevious, current.canGoNext, current.stride)
        : null;
      if (direction) current.onShift(direction);
      else writeOffset(shell, restOffset(), true);
    };

    const trackVelocity = (event: PointerEvent) => {
      const dt = event.timeStamp - prevT;
      if (dt > 0) velocity = (event.clientX - prevX) / dt;
      prevX = event.clientX;
      prevT = event.timeStamp;
      lastX = event.clientX;
    };

    const onMove = (event: PointerEvent) => {
      if (!active || event.pointerId !== pointerId) return;
      const current = latest.current;
      if (!current.enabled || current.isBlocked() || !(current.stride > 0)) {
        finish(false);
        return;
      }

      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      trackVelocity(event);
      if (mode === 'pending') {
        const absX = Math.abs(dx);
        const absY = Math.abs(dy);
        if (absX < AXIS_PX && absY < AXIS_PX) return;
        if (!(absX >= AXIS_PX && absX > absY * 1.25)) {
          if (absY >= absX) finish(false);
          return;
        }
        mode = 'horizontal';
        shell.dataset['swipeDragging'] = 'true';
        current.onHorizontalLock();
      }

      if (event.cancelable) event.preventDefault();
      const min = current.canGoNext ? -current.stride : 0;
      const max = current.canGoPrevious ? current.stride : 0;
      const offset = restOffset() + rubber(dx, min, max, current.stride);
      shell.style.setProperty('--verse-swipe-duration', '0ms');
      shell.style.setProperty('--verse-swipe-offset', `${offset}px`);
    };

    const onUp = (event: PointerEvent) => {
      if (!active || event.pointerId !== pointerId) return;
      trackVelocity(event);
      finish(true);
    };

    const onCancel = (event: PointerEvent) => {
      if (!active || event.pointerId !== pointerId) return;
      finish(false);
    };

    const onDown = (event: PointerEvent) => {
      const current = latest.current;
      const target = event.target instanceof Element ? event.target : null;
      if (
        active
        || !current.enabled
        || !(current.stride > 0)
        || !event.isPrimary
        || event.button !== 0
        || (event.pointerType !== 'touch' && event.pointerType !== 'pen')
        || current.isBlocked()
        || !target?.closest('.verse-grid-rows, .verse-grid-column-headers-row')
        || target.closest('button, a, input, select, textarea, label')
      ) {
        return;
      }

      active = true;
      tracking.current = true;
      pointerId = event.pointerId;
      startX = lastX = prevX = event.clientX;
      startY = event.clientY;
      prevT = event.timeStamp;
      velocity = 0;
      mode = 'pending';
      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
    };

    shell.addEventListener('pointerdown', onDown);
    return () => {
      active = false;
      tracking.current = false;
      detach();
      shell.removeEventListener('pointerdown', onDown);
      delete shell.dataset['swipeDragging'];
    };
  }, [enabled, hasVerseGrid, shellRef]);
}
