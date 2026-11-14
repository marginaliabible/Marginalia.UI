/** Window CustomEvent type prefix for tour gates that wait on an action, not DOM visibility. */
const HELP_TOUR_EVENT_PREFIX = 'marginalia:help-tour:';
const HELP_TOUR_EVENT_CHANNEL = 'marginalia:help-tour-events';

export function helpTourEventType(name: string): string {
  return `${HELP_TOUR_EVENT_PREFIX}${name}`;
}

function getTourEventBus(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') {
    return null;
  }
  try {
    return new BroadcastChannel(HELP_TOUR_EVENT_CHANNEL);
  } catch {
    return null;
  }
}

/** Fire from host UI when a tour-relevant action completes (e.g. quick jump). */
export function emitHelpTourEvent(name: string): void {
  const trimmed = name.trim();
  if (typeof window === 'undefined' || !trimmed) {
    return;
  }
  window.dispatchEvent(new CustomEvent(helpTourEventType(trimmed)));
  const bus = getTourEventBus();
  if (bus) {
    bus.postMessage({ name: trimmed });
    bus.close();
  }
}

/** Listen for tour events from this window or sibling Marginalia windows. */
export function subscribeHelpTourEvent(name: string, listener: () => void): () => void {
  const trimmed = name.trim();
  const eventType = helpTourEventType(trimmed);
  const onWindow = () => listener();
  window.addEventListener(eventType, onWindow);

  const bus = getTourEventBus();
  const onBus = (event: MessageEvent) => {
    if (event.data?.name === trimmed) {
      listener();
    }
  };
  bus?.addEventListener('message', onBus);

  return () => {
    window.removeEventListener(eventType, onWindow);
    if (bus) {
      bus.removeEventListener('message', onBus);
      bus.close();
    }
  };
}
