import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import {
  classifySwipeAxis,
  resolveSwipeShift,
  rubberBandDelta,
  SWIPE_TRANSITION_MS,
  velocityFromSamples,
  type TranslationSwipeDirection,
} from '../utils/verseTranslationSwipe';

interface UseVerseTranslationSwipeOptions {
  enabled: boolean;
  hasVerseGrid: boolean;
  shellRef: RefObject<HTMLElement | null>;
  translationWindowStart: number;
  stride: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onShift: (direction: TranslationSwipeDirection) => void;
  onHorizontalLock: () => void;
  isBlocked: () => boolean;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }

  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function writeSwipeOffset(shell: HTMLElement, offset: number, animate: boolean): void {
  const shouldAnimate = animate && !prefersReducedMotion();
  if (!shouldAnimate) {
    shell.style.setProperty('--verse-swipe-duration', '0ms');
    shell.style.setProperty('--verse-swipe-offset', `${offset}px`);
    return;
  }

  // Commit the current dragged position, then transition to the resting offset.
  shell.style.setProperty('--verse-swipe-duration', '0ms');
  if (!shell.style.getPropertyValue('--verse-swipe-offset')) {
    shell.style.setProperty('--verse-swipe-offset', `${offset}px`);
  }
  void shell.offsetWidth;
  shell.style.setProperty('--verse-swipe-duration', `${SWIPE_TRANSITION_MS}ms`);
  shell.style.setProperty('--verse-swipe-offset', `${offset}px`);
}

function eventElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) {
    return target;
  }

  if (target instanceof Node) {
    return target.parentElement;
  }

  return null;
}

/**
 * Mobile column paging. The verse grid stays row-aligned, so this tracks one
 * horizontal pointer drag and slides every translation column together.
 * Vertical drags are left to the page scroll (see touch-action: pan-y).
 */
export function useVerseTranslationSwipe({
  enabled,
  hasVerseGrid,
  shellRef,
  translationWindowStart,
  stride,
  canGoPrevious,
  canGoNext,
  onShift,
  onHorizontalLock,
  isBlocked,
}: UseVerseTranslationSwipeOptions): void {
  const latestRef = useRef({
    enabled,
    translationWindowStart,
    stride,
    canGoPrevious,
    canGoNext,
    onShift,
    onHorizontalLock,
    isBlocked,
  });
  latestRef.current = {
    enabled,
    translationWindowStart,
    stride,
    canGoPrevious,
    canGoNext,
    onShift,
    onHorizontalLock,
    isBlocked,
  };

  const sessionRef = useRef({ tracking: false });
  const previousRestRef = useRef<{ start: number; stride: number } | null>(null);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell) {
      return;
    }

    if (!enabled || !hasVerseGrid || !(stride > 0)) {
      shell.style.removeProperty('--verse-swipe-offset');
      shell.style.removeProperty('--verse-swipe-duration');
      delete shell.dataset['swipeDragging'];
      previousRestRef.current = null;
      return;
    }

    if (sessionRef.current.tracking) {
      return;
    }

    const offset = -translationWindowStart * stride;
    const previous = previousRestRef.current;
    previousRestRef.current = { start: translationWindowStart, stride };
    const strideChanged = previous !== null && Math.abs(previous.stride - stride) >= 0.5;
    const startChanged = previous !== null && previous.start !== translationWindowStart;
    writeSwipeOffset(shell, offset, startChanged && !strideChanged);
  }, [enabled, hasVerseGrid, shellRef, stride, translationWindowStart]);

  useEffect(() => {
    if (!enabled || !hasVerseGrid) {
      return;
    }

    const shell = shellRef.current;
    if (!shell) {
      return;
    }

    const session = {
      tracking: false,
      pointerId: -1,
      startX: 0,
      startY: 0,
      lastX: 0,
      mode: 'undecided' as 'undecided' | 'horizontal' | 'vertical',
      samples: [] as { x: number; t: number }[],
    };

    const trimSamples = (now: number) => {
      const cutoff = now - 80;
      while (session.samples.length > 2 && session.samples[0].t < cutoff) {
        session.samples.shift();
      }
    };

    const detachMoveListeners = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    };

    const endGesture = (kind: 'commit' | 'cancel' | 'ignore') => {
      const wasHorizontal = session.mode === 'horizontal';
      session.tracking = false;
      sessionRef.current.tracking = false;
      session.mode = 'undecided';
      detachMoveListeners();
      delete shell.dataset['swipeDragging'];

      if (!wasHorizontal || kind === 'ignore') {
        return;
      }

      const latest = latestRef.current;
      const deltaX = session.lastX - session.startX;
      const direction = kind === 'commit'
        ? resolveSwipeShift({
          deltaX,
          velocityX: velocityFromSamples(session.samples),
          canGoPrevious: latest.canGoPrevious,
          canGoNext: latest.canGoNext,
          stride: latest.stride,
        })
        : null;

      if (direction) {
        latest.onShift(direction);
        return;
      }

      writeSwipeOffset(shell, -latest.translationWindowStart * latest.stride, true);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!session.tracking || event.pointerId !== session.pointerId) {
        return;
      }

      const latest = latestRef.current;
      if (!latest.enabled || latest.isBlocked() || !(latest.stride > 0)) {
        endGesture(session.mode === 'horizontal' ? 'cancel' : 'ignore');
        return;
      }

      const deltaX = event.clientX - session.startX;
      const deltaY = event.clientY - session.startY;
      session.lastX = event.clientX;
      session.samples.push({ x: event.clientX, t: event.timeStamp });
      trimSamples(event.timeStamp);

      if (session.mode === 'undecided') {
        const axis = classifySwipeAxis(deltaX, deltaY);
        if (axis === 'undecided') {
          return;
        }

        if (axis === 'vertical') {
          endGesture('ignore');
          return;
        }

        session.mode = 'horizontal';
        shell.dataset['swipeDragging'] = 'true';
        latest.onHorizontalLock();
      }

      if (session.mode !== 'horizontal') {
        return;
      }

      if (event.cancelable) {
        event.preventDefault();
      }

      const minDelta = latest.canGoNext ? -latest.stride : 0;
      const maxDelta = latest.canGoPrevious ? latest.stride : 0;
      const banded = rubberBandDelta(deltaX, minDelta, maxDelta, latest.stride);
      const offset = (-latest.translationWindowStart * latest.stride) + banded;
      shell.style.setProperty('--verse-swipe-duration', '0ms');
      shell.style.setProperty('--verse-swipe-offset', `${offset}px`);
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!session.tracking || event.pointerId !== session.pointerId) {
        return;
      }

      session.lastX = event.clientX;
      session.samples.push({ x: event.clientX, t: event.timeStamp });
      trimSamples(event.timeStamp);
      endGesture('commit');
    };

    const onPointerCancel = (event: PointerEvent) => {
      if (!session.tracking || event.pointerId !== session.pointerId) {
        return;
      }

      endGesture(session.mode === 'horizontal' ? 'cancel' : 'ignore');
    };

    const onPointerDown = (event: PointerEvent) => {
      if (session.tracking && event.pointerId !== session.pointerId) {
        endGesture(session.mode === 'horizontal' ? 'cancel' : 'ignore');
        return;
      }

      const latest = latestRef.current;
      if (!latest.enabled || !(latest.stride > 0) || session.tracking) {
        return;
      }

      if (!event.isPrimary || event.button !== 0) {
        return;
      }

      if (event.pointerType !== 'touch' && event.pointerType !== 'pen') {
        return;
      }

      if (latest.isBlocked()) {
        return;
      }

      const element = eventElement(event.target);
      if (!element?.closest('.verse-grid-rows, .verse-grid-column-headers-row')) {
        return;
      }

      if (element.closest('button, a, input, select, textarea, label')) {
        return;
      }

      session.tracking = true;
      sessionRef.current.tracking = true;
      session.pointerId = event.pointerId;
      session.startX = event.clientX;
      session.startY = event.clientY;
      session.lastX = event.clientX;
      session.mode = 'undecided';
      session.samples = [{ x: event.clientX, t: event.timeStamp }];
      window.addEventListener('pointermove', onPointerMove, { passive: false });
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerCancel);
    };

    shell.addEventListener('pointerdown', onPointerDown);

    return () => {
      session.tracking = false;
      sessionRef.current.tracking = false;
      detachMoveListeners();
      shell.removeEventListener('pointerdown', onPointerDown);
      delete shell.dataset['swipeDragging'];
    };
  }, [enabled, hasVerseGrid, shellRef]);
}
