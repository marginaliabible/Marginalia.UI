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
  language?: string | string[];
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
  lastTranslationIds?: string[];
  lastBook?: string;
  lastChapter?: number;
  lastVerse?: number;
  lastSearch?: string;
  languages?: string[];
  theme?: ThemePreference;
}

export type ThemePreference = 'light' | 'dark';

export class SearchMatch {
  constructor(
    public book: string,
    public chapter: number,
    public verse: number,
    public text: string,
    public translationId?: string,
    public translationLabel?: string
  ) {}

  get id(): string {
    const translationPrefix = this.translationId ? `${this.translationId}-` : '';
    return `${translationPrefix}${this.book}-${this.chapter}-${this.verse}`;
  }
}

export interface SearchResultSet {
  query: string;
  matches: SearchMatch[];
  total: number;
  limited: boolean;
}
