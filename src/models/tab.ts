import type { SearchResultSet } from './bible';

export interface VerseContext {
  book: string;
  chapter: number;
  verse: number;
}

export interface PanelTab {
  id: string;
  type: 'search' | 'translations' | 'resources';
  title: string;
  iconClass: string;
  searchResults?: SearchResultSet;
  translationIds?: string[];
  verseContext?: VerseContext;
  createdAt: number;
  updatedAt: number;
}
