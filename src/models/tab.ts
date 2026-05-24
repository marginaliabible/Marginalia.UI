import type { SearchResultSet } from './bible';

export interface PanelTab {
  id: string;
  type: string;
  title: string;
  iconClass: string;
  searchResults?: SearchResultSet;
  translationIds?: string[];
  createdAt: number;
  updatedAt: number;
}
