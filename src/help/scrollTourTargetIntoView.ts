import { resolveHelpTourTarget } from './tourTargets';

/**
 * Scroll a tour target into the viewport.
 * Joyride skips document scrolling when isFixed is true, so we do this ourselves
 * for targets like the search box that sit in the page scrollport.
 */
export function scrollTourTargetIntoView(targetId: string): void {
  if (!targetId) {
    return;
  }
  const el = document.querySelector(resolveHelpTourTarget(targetId));
  if (!(el instanceof HTMLElement)) {
    return;
  }
  el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
}
