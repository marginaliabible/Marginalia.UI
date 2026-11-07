const STORAGE_KEY = 'marginalia.help.tour-progress';

function readAll(): Record<string, number> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, number>;
  } catch {
    return {};
  }
}

function writeAll(map: Record<string, number>): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore quota / private-mode failures; resume is best-effort.
  }
}

/** Returns a saved step index for a tour, or 0 if none / invalid. */
export function getTourResumeIndex(tourId: string, stepCount: number): number {
  if (stepCount <= 0) {
    return 0;
  }
  const saved = readAll()[tourId];
  if (typeof saved !== 'number' || !Number.isInteger(saved) || saved < 0) {
    return 0;
  }
  return Math.min(saved, stepCount - 1);
}

/** Persist where the user left a tour (closed/skipped mid-way). */
export function saveTourResumeIndex(tourId: string, index: number): void {
  if (!tourId || index < 0) {
    return;
  }
  const map = readAll();
  map[tourId] = index;
  writeAll(map);
}

/** Clear resume state after a tour finishes successfully. */
export function clearTourResumeIndex(tourId: string): void {
  const map = readAll();
  if (!(tourId in map)) {
    return;
  }
  delete map[tourId];
  writeAll(map);
}

/** Mid-tour exits (not first/last) get a resume beacon on the left-off step. */
export function shouldShowResumeBeacon(index: number, stepCount: number): boolean {
  return stepCount > 2 && index > 0 && index < stepCount - 1;
}

/** How long a mid-tour resume beacon stays visible. */
export const RESUME_BEACON_TTL_MS = 3 * 60 * 1000;
