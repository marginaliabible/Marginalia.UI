import {
  clearTourResumeIndex,
  getTourResumeIndex,
  saveTourResumeIndex,
  shouldShowResumeBeacon,
} from './tourProgress';

describe('tourProgress', () => {
  beforeEach(() => {
    clearTourResumeIndex('open-settings');
    clearTourResumeIndex('try-search');
  });

  it('defaults to 0 when nothing is saved', () => {
    expect(getTourResumeIndex('open-settings', 5)).toBe(0);
  });

  it('saves and restores a resume index clamped to the tour length', () => {
    saveTourResumeIndex('open-settings', 3);
    expect(getTourResumeIndex('open-settings', 9)).toBe(3);
    expect(getTourResumeIndex('open-settings', 2)).toBe(1);
  });

  it('clears progress after a finished tour', () => {
    saveTourResumeIndex('open-settings', 2);
    clearTourResumeIndex('open-settings');
    expect(getTourResumeIndex('open-settings', 5)).toBe(0);
  });

  it('keeps progress for other tours independently', () => {
    saveTourResumeIndex('open-settings', 2);
    saveTourResumeIndex('try-search', 1);
    clearTourResumeIndex('open-settings');
    expect(getTourResumeIndex('try-search', 3)).toBe(1);
  });

  it('only shows a resume beacon for middle steps', () => {
    expect(shouldShowResumeBeacon(0, 5)).toBe(false);
    expect(shouldShowResumeBeacon(4, 5)).toBe(false);
    expect(shouldShowResumeBeacon(2, 5)).toBe(true);
    expect(shouldShowResumeBeacon(1, 2)).toBe(false);
  });
});

