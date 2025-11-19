export interface BibleData {
  translation: string;
  books: BibleBook[];
}

export interface BibleBook {
  name: string;
  chapters: BibleChapter[];
}

export interface BibleChapter {
  chapter: number;
  verses: BibleVerse[];
}

export interface BibleVerse {
  verse: number;
  text: string;
}

export interface BibleTranslationMeta {
  id: string;
  label: string;
  source: string;
  isLocal: boolean;
  lastFetched?: number;
}

export interface QuickJumpTarget {
  book: string;
  chapter: number;
  verse?: number;
  rangeEnd?: number;
}

export interface GitBibleState {
  lastTranslationId: string;
  lastBook?: string;
  lastChapter?: number;
  lastVerse?: number;
  lastSearch?: string;
  theme?: ThemePreference;
}

export type ThemePreference = 'light' | 'dark';

export interface SearchMatch {
  book: string;
  chapter: number;
  verse: number;
  text: string;
}

export interface SearchResultSet {
  query: string;
  matches: SearchMatch[];
  total: number;
  limited: boolean;
}
