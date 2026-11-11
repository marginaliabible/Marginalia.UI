export type TranslationSwipeDirection = 'left' | 'right';

export interface SwipeReleaseInput {
  deltaX: number;
  velocityX: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  stride: number;
}

const DISTANCE_RATIO = 0.22;
const MIN_DISTANCE_PX = 48;
const MAX_DISTANCE_RATIO = 0.85;
const FLICK_VELOCITY = 0.5;
const FLICK_MIN_DISTANCE = 18;
const REVERSE_VELOCITY = 0.2;
const RUBBER_STIFFNESS = 0.55;

export const SWIPE_AXIS_LOCK_PX = 10;
export const SWIPE_AXIS_DOMINANCE = 1.25;
export const SWIPE_TRANSITION_MS = 300;

export type SwipeAxis = 'undecided' | 'horizontal' | 'vertical';

/**
 * Horizontal only after the finger has moved far enough, and clearly more
 * sideways than up or down, so a vertical read can still scroll.
 */
export function classifySwipeAxis(deltaX: number, deltaY: number): SwipeAxis {
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);
  if (absX < SWIPE_AXIS_LOCK_PX && absY < SWIPE_AXIS_LOCK_PX) {
    return 'undecided';
  }

  if (absX >= SWIPE_AXIS_LOCK_PX && absX > absY * SWIPE_AXIS_DOMINANCE) {
    return 'horizontal';
  }

  if (absY >= absX) {
    return 'vertical';
  }

  return 'undecided';
}

function dampOverscroll(overscroll: number, dimension: number): number {
  const range = Math.max(dimension, 1);
  return (overscroll * range * RUBBER_STIFFNESS) / (range + (RUBBER_STIFFNESS * overscroll));
}

/**
 * 1:1 while the drag can still reach another column. Past either end, or past
 * a single column, the offset grows slower than the finger (rubber-band).
 */
export function rubberBandDelta(delta: number, min: number, max: number, dimension: number): number {
  if (delta < min) {
    return min - dampOverscroll(min - delta, dimension);
  }

  if (delta > max) {
    return max + dampOverscroll(delta - max, dimension);
  }

  return delta;
}

/**
 * Finger left (negative deltaX) moves toward the next translation, which the
 * column window calls "right" because the start index increases. Finger right
 * moves toward the previous translation ("left"). Arrows do not wrap, so a
 * release at either end snaps back.
 */
export function resolveSwipeShift(input: SwipeReleaseInput): TranslationSwipeDirection | null {
  const { deltaX, velocityX, canGoPrevious, canGoNext, stride } = input;
  if (!(stride > 0) || deltaX === 0) {
    return null;
  }

  const distanceThreshold = Math.min(
    stride * MAX_DISTANCE_RATIO,
    Math.max(MIN_DISTANCE_PX, stride * DISTANCE_RATIO),
  );
  const towardNext = deltaX < 0;
  const towardPrevious = deltaX > 0;
  const reversing = (towardNext && velocityX > REVERSE_VELOCITY)
    || (towardPrevious && velocityX < -REVERSE_VELOCITY);

  if (towardNext && canGoNext && !reversing) {
    const passedDistance = deltaX <= -distanceThreshold;
    const flicked = velocityX <= -FLICK_VELOCITY && deltaX <= -FLICK_MIN_DISTANCE;
    if (passedDistance || flicked) {
      return 'right';
    }
  }

  if (towardPrevious && canGoPrevious && !reversing) {
    const passedDistance = deltaX >= distanceThreshold;
    const flicked = velocityX >= FLICK_VELOCITY && deltaX >= FLICK_MIN_DISTANCE;
    if (passedDistance || flicked) {
      return 'left';
    }
  }

  return null;
}

export function velocityFromSamples(samples: ReadonlyArray<{ x: number; t: number }>): number {
  if (samples.length < 2) {
    return 0;
  }

  const first = samples[0];
  const last = samples[samples.length - 1];
  const elapsed = last.t - first.t;
  if (elapsed <= 0) {
    return 0;
  }

  return (last.x - first.x) / elapsed;
}
