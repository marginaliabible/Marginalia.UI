/** Window CustomEvent type prefix for tour gates that wait on an action, not DOM visibility. */
const HELP_TOUR_EVENT_PREFIX = 'marginalia:help-tour:';

export function helpTourEventType(name: string): string {
  return `${HELP_TOUR_EVENT_PREFIX}${name}`;
}

/** Fire from host UI when a tour-relevant action completes (e.g. quick jump). */
export function emitHelpTourEvent(name: string): void {
  if (typeof window === 'undefined' || !name.trim()) {
    return;
  }
  window.dispatchEvent(new CustomEvent(helpTourEventType(name.trim())));
}
