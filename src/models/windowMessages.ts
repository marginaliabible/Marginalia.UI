import type { QuickJumpTarget, ThemePreference } from './bible';
import type { PanelTab, VerseContext } from './tab';
import type { DocumentSubscriptionItem } from './accountSync';
import type { DocumentSyncItem, TranslationRecord } from '../store/slices/uiSlice';
import type { ResourceTagOverrides } from '../utils/sourceSubscriptions';

export type WindowRole = 'bible' | 'document' | 'panel';
export type InteractionKind = WindowRole;
export type VersePanelType = 'translations' | 'resources' | 'links';

export interface WindowInfo {
  id: string;
  /** Fixed for the window's lifetime: a Bible window showing a document is still a Bible window. */
  type: WindowRole;
  lastFocusedAt: number;
  /** Title context: a scripture reference, a document title, or "Panel". */
  label: string | null;
  /** `window.name`, so a click in the same browsing context group can recover a reference via `window.open('', name)`. */
  windowName: string;
  /** The channel id of the window that opened this one; windows sharing an opener can look each other up by name. */
  openerId: string | null;
}

export interface OpenVerseTabsPayload {
  book: string;
  chapter: number;
  verse: number;
  verses?: number[];
  hasResources: boolean;
  preferPanel?: VersePanelType;
}

export interface ShowVersesPayload {
  context: VerseContext;
  /** Also opens the verse tabs on this panel. */
  openPanel?: VersePanelType;
}

export interface OpenDocumentPayload {
  sourceUrl: string;
  title?: string;
  page?: number;
  matchRaws?: string[];
  kind?: 'pdf' | 'markup';
  syncItem?: DocumentSyncItem | null;
  subscriptionItem?: DocumentSubscriptionItem | null;
  shared?: boolean;
}

export type WindowCommand =
  | { kind: 'panel'; type: 'open-verse-tabs'; payload: OpenVerseTabsPayload }
  | { kind: 'panel'; type: 'run-search'; payload: { query: string; action: 'replace' | 'new'; translationIds: string[] } }
  | { kind: 'bible'; type: 'show-verses'; payload: ShowVersesPayload }
  | { kind: 'bible'; type: 'go-to-reference'; payload: { target: QuickJumpTarget; translationId?: string } }
  | { kind: 'bible'; type: 'focus-search' }
  | { kind: 'document'; type: 'open-document'; payload: OpenDocumentPayload }
  | { kind: 'document'; type: 'open-document-link'; payload: { hash: string } };

/** Persisted settings every window keeps in step. */
export interface SharedSettings {
  translationRecords: TranslationRecord[];
  selectedLanguages: string[];
  sourceUrls: string[];
  sourceUrlAddedAt: Record<string, number>;
  sourceUrlTombstones: Record<string, number>;
  disabledSourceItems: string[];
  resourceTagOverrides: ResourceTagOverrides;
  resourceHiddenTags: string[];
  theme: ThemePreference;
  translatorItalics: boolean;
  translatorParagraphMarks: boolean;
}

export interface SharedSelection {
  book: string | null;
  chapter: number;
  verses: number[];
  translationId: string | null;
}

export interface PanelHandoffState {
  tabs: PanelTab[];
  activeTabId: string | null;
  lastVersePanelType: VersePanelType;
  selection: SharedSelection;
}

export type ChannelMessage =
  | { type: 'hello' | 'announce'; from: string; info: WindowInfo }
  | { type: 'bye'; from: string }
  | { type: 'command'; from: string; to: string; command: WindowCommand }
  | { type: 'focus' | 'restore-document' | 'panel-state-request'; from: string; to: string }
  | { type: 'settings'; from: string; settings: SharedSettings }
  | { type: 'selection'; from: string; selection: SharedSelection }
  | { type: 'panel-state'; from: string; to: string; state: PanelHandoffState };

export type ChannelMessageType = ChannelMessage['type'];
