export interface HelpArticleMeta {
  id: string;
  title: string;
  section: string;
  path: string;
}

export interface HelpTourMeta {
  id: string;
  path: string;
}

export interface HelpManifest {
  schemaVersion: number;
  articles: HelpArticleMeta[];
  tours: HelpTourMeta[];
}

export interface HelpSearchDocument {
  id: string;
  title: string;
  section: string;
  headings: string[];
  headingSlugs?: string[];
  body: string;
}

export interface HelpSearchIndex {
  schemaVersion: number;
  documents: HelpSearchDocument[];
}

export type HelpTourBeforeAction =
  | { action: 'openSettings' }
  | { action: 'openTranslationsPanel' }
  | { action: 'ensureTranslationsTab' }
  | { action: 'selectPanelTab'; tabType: 'search' | 'translations' | 'resources' | 'links' | 'help' };

export interface HelpTourStep {
  target: string;
  /** Optional logical id for the spotlight cutout when it should differ from `target` (tooltip anchor). */
  spotlightTarget?: string;
  /**
   * Logical target the user must reveal (e.g. by opening a tab).
   * Next/Done stays hidden until that target is visible, then the tour advances automatically.
   */
  advanceVisible?: string;
  title?: string;
  content: string;
  placement?: 'top' | 'top-start' | 'top-end' | 'bottom' | 'bottom-start' | 'bottom-end' | 'left' | 'left-start' | 'left-end' | 'right' | 'right-start' | 'right-end' | 'center' | 'auto';
  before?: HelpTourBeforeAction;
}

export interface HelpTourDefinition {
  id: string;
  steps: HelpTourStep[];
}
