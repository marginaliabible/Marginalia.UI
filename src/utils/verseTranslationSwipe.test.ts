import {
  classifySwipeAxis,
  resolveSwipeShift,
  rubberBandDelta,
  velocityFromSamples,
} from './verseTranslationSwipe';

describe('classifySwipeAxis', () => {
  it('waits until the drag is clearly horizontal or vertical', () => {
    expect(classifySwipeAxis(0, 0)).toBe('undecided');
    expect(classifySwipeAxis(8, 8)).toBe('undecided');
    expect(classifySwipeAxis(20, 18)).toBe('undecided');
  });

  it('treats a sideways drag as horizontal and a downward drag as vertical', () => {
    expect(classifySwipeAxis(30, 4)).toBe('horizontal');
    expect(classifySwipeAxis(-24, 10)).toBe('horizontal');
    expect(classifySwipeAxis(4, 30)).toBe('vertical');
    expect(classifySwipeAxis(-6, -40)).toBe('vertical');
  });
});

describe('rubberBandDelta', () => {
  it('follows the finger while another column is in range', () => {
    expect(rubberBandDelta(-40, -300, 0, 300)).toBe(-40);
    expect(rubberBandDelta(80, 0, 300, 300)).toBe(80);
  });

  it('resists past the ends and moves less than the finger', () => {
    const resisted = rubberBandDelta(100, 0, 0, 300);
    expect(resisted).toBeGreaterThan(0);
    expect(resisted).toBeLessThan(100);

    const further = rubberBandDelta(180, 0, 0, 300);
    expect(further).toBeGreaterThan(resisted);
    expect(further).toBeLessThan(180);
  });
});

describe('resolveSwipeShift', () => {
  const stride = 200;

  it('snaps back when the drag is short and slow', () => {
    expect(resolveSwipeShift({
      deltaX: -30,
      velocityX: 0,
      canGoPrevious: true,
      canGoNext: true,
      stride,
    })).toBeNull();
  });

  it('moves to the next translation after a leftward drag past the threshold', () => {
    expect(resolveSwipeShift({
      deltaX: -80,
      velocityX: 0,
      canGoPrevious: true,
      canGoNext: true,
      stride,
    })).toBe('right');
  });

  it('moves to the previous translation after a rightward drag past the threshold', () => {
    expect(resolveSwipeShift({
      deltaX: 80,
      velocityX: 0,
      canGoPrevious: true,
      canGoNext: true,
      stride,
    })).toBe('left');
  });

  it('accepts a short flick in the drag direction', () => {
    expect(resolveSwipeShift({
      deltaX: -20,
      velocityX: -0.8,
      canGoPrevious: true,
      canGoNext: true,
      stride,
    })).toBe('right');
    expect(resolveSwipeShift({
      deltaX: 20,
      velocityX: 0.8,
      canGoPrevious: true,
      canGoNext: true,
      stride,
    })).toBe('left');
  });

  it('snaps back when the finger flicks back toward the start', () => {
    expect(resolveSwipeShift({
      deltaX: -80,
      velocityX: 0.4,
      canGoPrevious: true,
      canGoNext: true,
      stride,
    })).toBeNull();
  });

  it('does not wrap past the first or last column', () => {
    expect(resolveSwipeShift({
      deltaX: 120,
      velocityX: 1,
      canGoPrevious: false,
      canGoNext: true,
      stride,
    })).toBeNull();
    expect(resolveSwipeShift({
      deltaX: -120,
      velocityX: -1,
      canGoPrevious: true,
      canGoNext: false,
      stride,
    })).toBeNull();
  });
});

describe('velocityFromSamples', () => {
  it('measures pixels per millisecond across the sample window', () => {
    expect(velocityFromSamples([
      { x: 100, t: 0 },
      { x: 60, t: 40 },
    ])).toBeCloseTo(-1);
    expect(velocityFromSamples([{ x: 10, t: 0 }])).toBe(0);
  });
});
