import { queryTourTargetElement } from './tourTargetWindows';

/**
 * Scroll a tour target into the viewport (including in a popped-out panel / Bible window).
 * Joyride skips document scrolling when isFixed is true, so we do this ourselves.
 */
export function scrollTourTargetIntoView(targetId: string): void {
  if (!targetId) {
    return;
  }
  const el = queryTourTargetElement(targetId);
  if (!(el instanceof HTMLElement)) {
    return;
  }
  el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
}
