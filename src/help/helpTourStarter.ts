import type { StartTourOptions } from './HelpTourContext';
import { tourTargetNeedsHandoff, tourTargetWindowRole } from './tourTargetWindows';
import { routeInteraction } from '../services/windowRouting';

type TourStarter = (tourId: string, options?: StartTourOptions) => void;

let starter: TourStarter | null = null;

/** HelpTourRunner registers its local starter so other windows can deliver tours here. */
export function registerHelpTourStarter(next: TourStarter): () => void {
  starter = next;
  return () => {
    if (starter === next) {
      starter = null;
    }
  };
}

export function startHelpTourFromCommand(tourId: string, options?: StartTourOptions): boolean {
  if (!starter) {
    return false;
  }
  starter(tourId, { ...options, local: true });
  return true;
}

/**
 * When the step's target lives in another window, send start-help-tour there.
 * Returns true when the tour was handed off (caller should stop / not start locally).
 */
export function handOffHelpTourIfNeeded(tourId: string, stepIndex: number, targetId: string): boolean {
  if (!tourTargetNeedsHandoff(targetId)) {
    return false;
  }
  const ownerRole = tourTargetWindowRole(targetId);
  if (ownerRole !== 'bible' && ownerRole !== 'panel') {
    return false;
  }
  const outcome = routeInteraction(
    {
      kind: ownerRole,
      type: 'start-help-tour',
      payload: { tourId, stepIndex },
    },
    () => {
      // Owner resolved locally somehow — caller continues.
    },
    { quiet: true }
  );
  return outcome !== 'local';
}
