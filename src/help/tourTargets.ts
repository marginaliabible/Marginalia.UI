/** Logical tour target ids used in Marginalia.Help tour JSON → CSS selectors in the UI. */
export const HELP_TOUR_TARGETS = {
  'help-button': '[data-help="help-button"]',
  'panel-tabs-content': '[data-help="panel-tabs-content"]',
  'settings-button': '[data-help="settings-button"]',
  'account-sync-button': '[data-help="account-sync-button"]',
  'account-sync-modal': '[data-help="account-sync-modal"]',
  'account-sync-provider-connect': '[data-help="account-sync-provider-connect"]',
  'account-sync-connect-modal': '[data-help="account-sync-connect-modal"]',
  'account-sync-sync-files': '[data-help="account-sync-sync-files"]',
  'account-sync-connect-submit': '[data-help="account-sync-connect-submit"]',
  'search-input': '[data-help="search-input"]',
  'selected-verse': '.verse-text.is-selected',
  'search-submit': '[data-help="search-submit"]',
  'search-dropdown': '[data-help="search-dropdown"]',
  'search-quick-jump': '[data-help="search-quick-jump"]',
  'search-panel': '[data-help="panel-tab-search"]',
  'search-results': '[data-help="search-results"]',
  'search-document-titles': '[data-help="search-document-titles"]',
  'search-testament-toggles': '[data-help="search-testament-toggles"]',
  'search-ot': '[data-help="search-ot"]',
  'search-nt': '[data-help="search-nt"]',
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
  'verse-resource-donut': '[data-help="verse-resource-donut"]',
  'resources-panel': '[data-help="resources-panel"]',
  'resources-tab': '[data-help="panel-tab-resources"]',
  'resources-reference': '[data-help="resources-reference"]',
  'resources-match-toggle': '[data-help="resources-match-toggle"]',
  'resources-tags': '[data-help="resources-tags"]',
  'resources-document-list': '[data-help="resources-document-list"]',
  'resources-document': '[data-help="resources-document"]',
  'resources-page-link': '[data-help="resources-page-link"]',
} as const;

export type HelpTourTargetId = keyof typeof HELP_TOUR_TARGETS;

export function resolveHelpTourTarget(targetId: string): string {
  if (Object.prototype.hasOwnProperty.call(HELP_TOUR_TARGETS, targetId)) {
    return HELP_TOUR_TARGETS[targetId as HelpTourTargetId];
  }
  // Allow authors to pass a raw CSS selector as an escape hatch during development.
  return targetId;
}
