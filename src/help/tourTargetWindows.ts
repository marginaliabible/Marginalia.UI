import type { WindowRole } from '../models/windowMessages';
import { PANEL_WINDOW_NAME, windowChannel } from '../services/windowChannel';
import { mostRecentWindowOfType } from '../services/windowRouting';
import { resolveHelpTourTarget } from './tourTargets';

/** Targets that live in the side panel UI (panel popout when detached, else Bible window). */
const PANEL_OWNED_TARGET_PREFIXES = [
  'panel-tabs-content',
  'search-panel',
  'search-results',
  'search-document-titles',
  'search-testament-toggles',
  'search-ot',
  'search-nt',
  'translations-',
  'resources-',
] as const;

export function isPanelOwnedTourTarget(targetId: string): boolean {
  if (!targetId || targetId === 'body') {
    return false;
  }
  return PANEL_OWNED_TARGET_PREFIXES.some((prefix) => (
    prefix.endsWith('-') ? targetId.startsWith(prefix) : targetId === prefix
  ));
}

function panelWindowIsOpen(): boolean {
  // getWindows() is every *other* live window, so the panel popout must also check self.
  return windowChannel.getSelf().type === 'panel' || Boolean(mostRecentWindowOfType('panel'));
}

/**
 * Which window should host Joyride for this target.
 * Panel-owned targets stay on the Bible window when the panel is not popped out.
 * Body/center steps stay on the window that is running the tour.
 */
export function tourTargetWindowRole(targetId: string): WindowRole {
  if (!targetId || targetId === 'body') {
    return windowChannel.getSelf().type === 'panel' ? 'panel' : 'bible';
  }
  if (isPanelOwnedTourTarget(targetId) && panelWindowIsOpen()) {
    return 'panel';
  }
  return 'bible';
}

/** True when Joyride for this target must run in another Marginalia window. */
export function tourTargetNeedsHandoff(targetId: string): boolean {
  const selfType = windowChannel.getSelf().type;
  const owner = tourTargetWindowRole(targetId);
  if (selfType === 'document') {
    return true;
  }
  return owner !== selfType;
}

/** Same-origin Window that currently owns a tour target. */
export function getTourTargetOwnerWindow(targetId: string): Window | null {
  const role = tourTargetWindowRole(targetId);
  const self = windowChannel.getSelf();
  if (role === self.type) {
    return typeof window !== 'undefined' ? window : null;
  }

  if (role === 'panel') {
    try {
      const panel = window.open('', PANEL_WINDOW_NAME);
      if (panel && !panel.closed) {
        return panel;
      }
    } catch {
      // Named lookup can fail outside the browsing context group.
    }
    return null;
  }

  try {
    if (window.opener && !window.opener.closed) {
      return window.opener as Window;
    }
  } catch {
    // Opener unavailable.
  }
  return null;
}

export function queryTourTargetElement(targetId: string): Element | null {
  if (!targetId) {
    return null;
  }
  const selector = resolveHelpTourTarget(targetId);
  const owner = getTourTargetOwnerWindow(targetId);
  try {
    return owner?.document.querySelector(selector) ?? null;
  } catch {
    return null;
  }
}
