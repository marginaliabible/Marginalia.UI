import type { SearchResultSet } from './bible';

export interface VerseContext {
  book: string;
  chapter: number;
  verse: number;
  /** All selected verses in this chapter. Defaults to `[verse]` when omitted. */
  verses?: number[];
}

export interface PanelTab {
  id: string;
  type: 'search' | 'translations' | 'resources' | 'links';
  title: string;
  iconClass: string;
  searchResults?: SearchResultSet;
  translationIds?: string[];
  verseContext?: VerseContext;
  createdAt: number;
  updatedAt: number;
}
