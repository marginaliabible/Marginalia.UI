/** Logical tour target ids used in Marginalia.Help tour JSON → CSS selectors in the UI. */
export const HELP_TOUR_TARGETS = {
  'settings-button': '[data-help="settings-button"]',
  'help-button': '[data-help="help-button"]',
  'search-input': '[data-help="search-input"]',
  'settings-theme': '[data-help="settings-theme"]',
  'settings-translator-italics': '[data-help="settings-translator-italics"]',
  'settings-translator-paragraphs': '[data-help="settings-translator-paragraphs"]',
  'settings-languages': '[data-help="settings-languages"]',
  'settings-sources': '[data-help="settings-sources"]',
  'settings-user-id': '[data-help="settings-user-id"]',
  'settings-version': '[data-help="settings-version"]',
  'settings-version-copy': '[data-help="settings-version-copy"]',
  'settings-close': '[data-help="settings-close"]',
  'settings-help': '[data-help="settings-help"]',
  'translations-panel': '[data-help="panel-tab-translations"]',
  'translations-selected': '[data-help="translations-selected"]',
  'translations-more': '[data-help="translations-more"]',
  'translations-filter': '[data-help="translations-filter"]',
  'translations-add-list': '[data-help="translations-add-list"]',
  'translations-unstar': '[data-help="translations-unstar"]',
  'translations-drag-handle': '[data-help="translations-drag-handle"]',
} as const;

export type HelpTourTargetId = keyof typeof HELP_TOUR_TARGETS;

export function resolveHelpTourTarget(targetId: string): string {
  if (Object.prototype.hasOwnProperty.call(HELP_TOUR_TARGETS, targetId)) {
    return HELP_TOUR_TARGETS[targetId as HelpTourTargetId];
  }
  // Allow authors to pass a raw CSS selector as an escape hatch during development.
  return targetId;
}
