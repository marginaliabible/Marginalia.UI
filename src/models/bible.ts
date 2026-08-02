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

export type RepositoryType = 'hosted' | 'local' | 'github-public' | 'github-private';
export type ArtifactType = 'translation' | 'translation-library' | 'resource-library';

export interface BibleTranslationMeta {
  id: string;
  label: string;
  source: string;
  isLocal: boolean;
  configuredSourceUrl?: string;
  repositoryType?: RepositoryType;
  artifactType?: ArtifactType;
  language?: string | string[];
  lastFetched?: number;
  owner?: string;
  repo?: string;
  ref?: string;
  path?: string;
  publicUrl?: string;
  repoAlias?: string;
  requiredPermissions?: string[];
  authHint?: string;
  orgName?: string;
}

export interface QuickJumpTarget {
  book: string;
  chapter: number;
  verse?: number;
  rangeEnd?: number;
}

export interface TranslationRecord {
  id: string;
  starred: boolean;
}

export interface MarginaliaState {
  lastTranslationId: string;
  lastTranslationIds?: string[];
  translationRecords?: TranslationRecord[];
  lastBook?: string;
  lastChapter?: number;
  lastVerse?: number;
  lastSearch?: string;
  languages?: string[];
  sourceUrls?: string[];
  resourceHiddenTags?: string[];
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
