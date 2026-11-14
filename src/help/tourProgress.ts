/** In-memory only — intentionally does not survive a page refresh. Synced across windows. */
const progressByTour: Record<string, number> = {};
const PROGRESS_CHANNEL = 'marginalia:help-tour-progress';

type ProgressMessage =
  | { type: 'save'; tourId: string; index: number }
  | { type: 'clear'; tourId: string };

function getProgressBus(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') {
    return null;
  }
  try {
    return new BroadcastChannel(PROGRESS_CHANNEL);
  } catch {
    return null;
  }
}

let progressBus: BroadcastChannel | null = null;

function ensureProgressSync(): void {
  if (progressBus || typeof window === 'undefined') {
    return;
  }
  progressBus = getProgressBus();
  progressBus?.addEventListener('message', (event: MessageEvent<ProgressMessage>) => {
    const data = event.data;
    if (!data || typeof data !== 'object') {
      return;
    }
    if (data.type === 'save' && typeof data.tourId === 'string' && typeof data.index === 'number') {
      progressByTour[data.tourId] = data.index;
      return;
    }
    if (data.type === 'clear' && typeof data.tourId === 'string') {
      delete progressByTour[data.tourId];
    }
  });
}

ensureProgressSync();

/** Returns a saved step index for a tour, or 0 if none / invalid. */
export function getTourResumeIndex(tourId: string, stepCount: number): number {
  ensureProgressSync();
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
  ensureProgressSync();
  if (!tourId || index < 0) {
    return;
  }
  progressByTour[tourId] = index;
  progressBus?.postMessage({ type: 'save', tourId, index } satisfies ProgressMessage);
}

/** Clear resume state after a tour finishes successfully. */
export function clearTourResumeIndex(tourId: string): void {
  ensureProgressSync();
  delete progressByTour[tourId];
  progressBus?.postMessage({ type: 'clear', tourId } satisfies ProgressMessage);
}

/** Mid-tour exits (not first/last) get a resume beacon on the left-off step. */
export function shouldShowResumeBeacon(index: number, stepCount: number): boolean {
  return stepCount > 2 && index > 0 && index < stepCount - 1;
}

/** How long a mid-tour resume beacon stays visible. */
export const RESUME_BEACON_TTL_MS = 3 * 60 * 1000;
