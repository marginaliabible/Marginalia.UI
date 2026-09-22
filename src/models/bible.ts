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
  documentStoreAddress?: string;
  documentViewer?: string;
  documentManifestAddress?: string;
  referencesAddress?: string;
  modifiedOn?: string;
}

export interface ExtraLanguageMeta {
  code: string;
  label: string;
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

export type FederatedProvider = 'google' | 'microsoft';

export interface LinkedCloudAccount {
  provider: FederatedProvider;
  providerAccountId: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
  linkedAt: number;
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
  cloudLinkedAccounts?: LinkedCloudAccount[];
  cloudConfigUpdatedAt?: number;
  cloudConfigLastSyncedAt?: number;
  // Email of the first cloud account ever connected; internal reference only, synced across devices.
  userId?: string;
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
