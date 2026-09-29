import { MAX_SCALE, MIN_SCALE, stepScale } from './viewerZoom';

describe('stepScale', () => {
  it('steps within the manual range', () => {
    expect(stepScale(1, 1)).toBe(1.2);
    expect(stepScale(1, -1)).toBe(0.8);
  });

  it('clamps to the manual range', () => {
    expect(stepScale(2.3, 1)).toBe(MAX_SCALE);
    expect(stepScale(0.7, -1)).toBe(MIN_SCALE);
  });

  it('never moves against the step direction from an out-of-range fit scale', () => {
    expect(stepScale(0.45, -1)).toBe(0.45);
    expect(stepScale(0.45, 1)).toBe(0.65);
    expect(stepScale(0.3, 1)).toBe(MIN_SCALE);
    expect(stepScale(3.1, 1)).toBe(3.1);
    expect(stepScale(3.1, -1)).toBe(MAX_SCALE);
  });
});
