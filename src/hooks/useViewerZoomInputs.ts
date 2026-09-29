import { useEffect, useRef, type RefObject } from 'react';

/** Accumulated wheel delta (px) per zoom step; a mouse notch is ~100, trackpad pinches emit many small deltas. */
const WHEEL_DELTA_PER_STEP = 60;
const WHEEL_LINE_HEIGHT_PX = 16;
const PINCH_MIN_RATIO_CHANGE = 0.02;

export interface ViewerZoomInputOptions {
  enabled: boolean;
  /** Viewer stage; its owning window (main or detached popup) receives keyboard zoom. */
  stageRef: RefObject<HTMLElement | null>;
  /** Same-origin iframe hosting the document; gets the same inputs while it has focus. */
  frameRef?: RefObject<HTMLIFrameElement | null>;
  /** Changes whenever the iframe document is replaced. */
  frameKey?: unknown;
  scale: number;
  onZoomStep: (direction: -1 | 1) => void;
  onZoomReset: () => void;
  onZoomTo: (scale: number) => void;
}

type Handlers = Pick<ViewerZoomInputOptions, 'onZoomStep' | 'onZoomReset' | 'onZoomTo'> & { scale: number };

function zoomKeyDirection(event: KeyboardEvent): -1 | 0 | 1 | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) {
    return null;
  }
  switch (event.key) {
    case '=':
    case '+':
      return 1;
    case '-':
    case '_':
      return -1;
    case '0':
      return 0;
    default:
      return null;
  }
}

function touchDistance(touches: TouchList): number {
  const a = touches[0];
  const b = touches[1];
  return a && b ? Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) : 0;
}

/**
 * Ctrl/Cmd +/-/0, Ctrl/Cmd+wheel (incl. trackpad pinch) and touch pinch zoom for a
 * document viewer. When `frameRef` is given, the iframe's window gets the same
 * handling, and other modifier shortcuts pressed inside it are re-dispatched from
 * the iframe element so host-window shortcut listeners still see them.
 */
export function useViewerZoomInputs(options: ViewerZoomInputOptions): void {
  const { enabled, stageRef, frameRef, frameKey } = options;
  const handlersRef = useRef<Handlers>(options);
  handlersRef.current = options;

  useEffect(() => {
    const stage = stageRef.current;
    const hostWindow = stage?.ownerDocument.defaultView;
    if (!enabled || !stage || !hostWindow) {
      return;
    }

    let wheelAccumulator = 0;
    let pinchStartDistance = 0;
    let pinchStartScale = 1;

    const handleZoomKey = (event: KeyboardEvent): boolean => {
      if (event.defaultPrevented) {
        return false;
      }
      const direction = zoomKeyDirection(event);
      if (direction === null) {
        return false;
      }
      event.preventDefault();
      if (direction === 0) {
        handlersRef.current.onZoomReset();
      } else {
        handlersRef.current.onZoomStep(direction);
      }
      return true;
    };

    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) {
        wheelAccumulator = 0;
        return;
      }
      event.preventDefault();
      const delta = event.deltaMode === 1 ? event.deltaY * WHEEL_LINE_HEIGHT_PX : event.deltaY;
      wheelAccumulator += delta;
      while (Math.abs(wheelAccumulator) >= WHEEL_DELTA_PER_STEP) {
        const direction = wheelAccumulator < 0 ? 1 : -1;
        wheelAccumulator += direction * WHEEL_DELTA_PER_STEP;
        handlersRef.current.onZoomStep(direction);
      }
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length < 2) {
        return;
      }
      pinchStartDistance = touchDistance(event.touches);
      pinchStartScale = handlersRef.current.scale;
    };

    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length < 2 || pinchStartDistance <= 0) {
        return;
      }
      const distance = touchDistance(event.touches);
      if (distance <= 0) {
        return;
      }
      const ratio = distance / pinchStartDistance;
      if (!Number.isFinite(ratio) || Math.abs(ratio - 1) < PINCH_MIN_RATIO_CHANGE) {
        return;
      }
      event.preventDefault();
      handlersRef.current.onZoomTo(pinchStartScale * ratio);
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) {
        pinchStartDistance = 0;
      }
    };

    const attachPointerZoom = (target: EventTarget): (() => void) => {
      target.addEventListener('wheel', onWheel as EventListener, { passive: false });
      target.addEventListener('touchstart', onTouchStart as EventListener, { passive: true });
      target.addEventListener('touchmove', onTouchMove as EventListener, { passive: false });
      target.addEventListener('touchend', onTouchEnd as EventListener, { passive: true });
      target.addEventListener('touchcancel', onTouchEnd as EventListener, { passive: true });
      return () => {
        target.removeEventListener('wheel', onWheel as EventListener);
        target.removeEventListener('touchstart', onTouchStart as EventListener);
        target.removeEventListener('touchmove', onTouchMove as EventListener);
        target.removeEventListener('touchend', onTouchEnd as EventListener);
        target.removeEventListener('touchcancel', onTouchEnd as EventListener);
      };
    };

    const onHostKeyDown = (event: KeyboardEvent) => {
      handleZoomKey(event);
    };
    hostWindow.addEventListener('keydown', onHostKeyDown);
    const detachStage = attachPointerZoom(stage);

    let detachFrame: (() => void) | null = null;
    const frame = frameRef?.current ?? null;

    const attachFrame = () => {
      detachFrame?.();
      detachFrame = null;
      const frameWindow = frame?.contentWindow;
      if (!frame || !frameWindow) {
        return;
      }

      const onFrameKeyDown = (event: KeyboardEvent) => {
        if (handleZoomKey(event)) {
          return;
        }
        if (!(event.ctrlKey || event.metaKey || event.altKey) && event.key !== 'Escape') {
          return;
        }
        const forwarded = new hostWindow.KeyboardEvent('keydown', {
          key: event.key,
          code: event.code,
          location: event.location,
          repeat: event.repeat,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
          bubbles: true,
          cancelable: true,
          view: hostWindow,
        });
        if (!frame.dispatchEvent(forwarded)) {
          event.preventDefault();
        }
      };

      try {
        frameWindow.addEventListener('keydown', onFrameKeyDown);
        const detachPointer = attachPointerZoom(frameWindow);
        detachFrame = () => {
          frameWindow.removeEventListener('keydown', onFrameKeyDown);
          detachPointer();
        };
      } catch {
        // Cross-origin frame: nothing to attach to.
      }
    };

    if (frame) {
      attachFrame();
      frame.addEventListener('load', attachFrame);
    }

    return () => {
      hostWindow.removeEventListener('keydown', onHostKeyDown);
      detachStage();
      frame?.removeEventListener('load', attachFrame);
      detachFrame?.();
    };
  }, [enabled, stageRef, frameRef, frameKey]);
}
