/** In-memory only — intentionally does not survive a page refresh. */
const progressByTour: Record<string, number> = {};

/** Returns a saved step index for a tour, or 0 if none / invalid. */
export function getTourResumeIndex(tourId: string, stepCount: number): number {
  if (stepCount <= 0) {
    return 0;
  }
  const saved = progressByTour[tourId];
  if (typeof saved !== 'number' || !Number.isInteger(saved) || saved < 0) {
    return 0;
  }
  return Math.min(saved, stepCount - 1);
}

/** Remember where the user left a tour (closed/skipped mid-way) for this page load only. */
export function saveTourResumeIndex(tourId: string, index: number): void {
  if (!tourId || index < 0) {
    return;
  }
  progressByTour[tourId] = index;
}

/** Clear resume state after a tour finishes successfully. */
export function clearTourResumeIndex(tourId: string): void {
  delete progressByTour[tourId];
}

/** Mid-tour exits (not first/last) get a resume beacon on the left-off step. */
export function shouldShowResumeBeacon(index: number, stepCount: number): boolean {
  return stepCount > 2 && index > 0 && index < stepCount - 1;
}

/** How long a mid-tour resume beacon stays visible. */
export const RESUME_BEACON_TTL_MS = 3 * 60 * 1000;
