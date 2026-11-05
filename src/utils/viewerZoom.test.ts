import { MAX_SCALE, MIN_SCALE, computeFitWidthScale, FIT_WIDTH_GUTTER_PX, fitWidthPageIndex, stepScale } from './viewerZoom';

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

describe('fitWidthPageIndex', () => {
  it('uses the toolbar page number, not the first page', () => {
    expect(fitWidthPageIndex(1, 12)).toBe(0);
    expect(fitWidthPageIndex(5, 12)).toBe(4);
    expect(fitWidthPageIndex(12, 12)).toBe(11);
  });

  it('clamps to the document range', () => {
    expect(fitWidthPageIndex(0, 12)).toBe(0);
    expect(fitWidthPageIndex(99, 12)).toBe(11);
    expect(fitWidthPageIndex(3, 0)).toBe(0);
  });
});

describe('computeFitWidthScale', () => {
  it('fits the measured page width into the container minus gutter', () => {
    expect(computeFitWidthScale(840, 400, 1)).toBe((840 - FIT_WIDTH_GUTTER_PX) / 400);
    expect(computeFitWidthScale(840, 800, 2)).toBe((840 - FIT_WIDTH_GUTTER_PX) / 400);
  });

  it('returns null when the page is not measurable', () => {
    expect(computeFitWidthScale(840, 0, 1)).toBeNull();
    expect(computeFitWidthScale(0, 400, 1)).toBeNull();
    expect(computeFitWidthScale(840, 400, 0)).toBeNull();
  });
});
