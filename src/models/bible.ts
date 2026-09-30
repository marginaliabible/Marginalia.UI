export interface BibleData {
  translation: string;
  /** When true, `[words]` in verse text are translator-supplied italics markers. */
  italiciseBrackets?: boolean;
  /** When true, a leading `#` in verse text is a translator paragraph mark. */
  paragraphMarks?: boolean;
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
  // When each source URL was last added / removed; lets a removal on one device win over stale copies.
  sourceUrlAddedAt?: Record<string, number>;
  sourceUrlTombstones?: Record<string, number>;
  // Subscription entries (whole document types or single documents) the user turned off.
  disabledSourceItems?: string[];
  // User tag edits layered on the publisher's tags, keyed by resource document key.
  resourceTagOverrides?: Record<string, { added: string[]; removed: string[] }>;
  resourceHiddenTags?: string[];
  theme?: ThemePreference;
  /** Italicize translator-added words in opted-in translations (default true). */
  translatorItalics?: boolean;
  /** Show translator paragraph marks in opted-in translations (default true). */
  translatorParagraphMarks?: boolean;
  cloudLinkedAccounts?: LinkedCloudAccount[];
  cloudConfigUpdatedAt?: number;
  cloudConfigLastSyncedAt?: number;
  // Per-field edit times for synced settings (keys are SyncedConfigField).
  cloudFieldUpdatedAt?: Partial<Record<string, number>>;
  // Providers disconnected on this device; kept out of merged linkedAccounts until signed in again.
  cloudDetachedProviders?: FederatedProvider[];
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
