import type { QuickJumpTarget, ThemePreference, BibleTranslationMeta, ExtraLanguageMeta } from './models/bible';

export interface TranslationSelectOption {
  value: string;
  label: string;
}

export type WorkspacePanelKey = 'search';

export interface HashRouteTarget {
  book: string;
  chapter: number;
  verse?: number;
}

const SEARCH_HASH_QUERY_PARAM = 'q';

export const DESKTOP_BREAKPOINT = '(min-width: 992px)';

export const normalizeLanguageSelection = (values: string[]): string[] => {
  const normalized = values
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);

  return Array.from(new Set(normalized));
};

export const normalizeLanguages = (language: BibleTranslationMeta['language']): string[] => {
  if (!language) return [];
  const candidates = Array.isArray(language) ? language : [language];
  return normalizeLanguageSelection(candidates);
};

export const detectPreferredLanguages = (): string[] => {
  const defaults = ['hbo', 'grc'];

  if (typeof navigator === 'undefined') {
    return normalizeLanguageSelection(['en', ...defaults]);
  }

  const navigatorLanguages =
    (Array.isArray(navigator.languages) && navigator.languages.length > 0
      ? navigator.languages
      : []) ?? [];
  const primaryLanguage = navigator.language ? [navigator.language] : [];

  const fromNavigator = [...navigatorLanguages, ...primaryLanguage];
  const normalized = fromNavigator.flatMap((entry) => {
    const lower = entry?.toLowerCase() ?? '';
    if (!lower) return [];
    const base = lower.split('-')[0];
    return base && base !== lower ? [base, lower] : [lower];
  });

  return normalizeLanguageSelection([...normalized, ...defaults]);
};

export const verseDomId = (book: string, chapter: number, verse: number): string => {
  return `${book.replace(/\s+/g, '_')}-${chapter}-${verse}`;
};

export const buildHashRoute = (target: HashRouteTarget, includeVerse = false): string => {
  const safeBook = target.book.trim();
  const safeChapter = Math.max(1, Math.trunc(target.chapter));
  const segments = [encodeURIComponent(safeBook), String(safeChapter)];

  if (includeVerse && Number.isInteger(target.verse) && Number(target.verse) > 0) {
    segments.push(String(target.verse));
  }

  return `#/${segments.join('/')}`;
};

export const parseHashRoute = (hashValue: string): HashRouteTarget | null => {
  if (!hashValue || hashValue === '#') {
    return null;
  }

  const withoutHash = hashValue.startsWith('#') ? hashValue.slice(1) : hashValue;
  const withoutQuery = withoutHash.split('?')[0];
  const trimmed = withoutQuery.startsWith('/') ? withoutQuery.slice(1) : withoutQuery;
  const [bookSegment, chapterSegment, verseSegment] = trimmed.split('/');

  if (!bookSegment || !chapterSegment) {
    return null;
  }

  const book = decodeURIComponent(bookSegment).trim();
  const chapter = Number.parseInt(chapterSegment, 10);
  if (!book || !Number.isInteger(chapter) || chapter <= 0) {
    return null;
  }

  if (!verseSegment) {
    return { book, chapter };
  }

  const verse = Number.parseInt(verseSegment, 10);
  if (!Number.isInteger(verse) || verse <= 0) {
    return { book, chapter };
  }

  return { book, chapter, verse };
};

// Builds a hash route that layers a search query onto an optional chapter/verse reference,
// e.g. "#/John/3/16?q=love" or "#/?q=love" when no reference is selected.
export const buildSearchHashRoute = (search: string, reference?: HashRouteTarget | null): string => {
  const trimmedSearch = search.trim();
  const basePath = reference ? buildHashRoute(reference, true) : '#/';

  if (!trimmedSearch) {
    return basePath;
  }

  return `${basePath}?${SEARCH_HASH_QUERY_PARAM}=${encodeURIComponent(trimmedSearch)}`;
};

export const parseSearchFromHash = (hashValue: string): string | null => {
  if (!hashValue) {
    return null;
  }

  const queryIndex = hashValue.indexOf('?');
  if (queryIndex === -1) {
    return null;
  }

  const search = new URLSearchParams(hashValue.slice(queryIndex + 1)).get(SEARCH_HASH_QUERY_PARAM);
  const trimmed = search?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
};

export const getLanguageDisplayName = (code: string, extraLanguages: ExtraLanguageMeta[] = []): string => {
  const normalizedCode = code.trim().toLowerCase();
  const extraLanguage = extraLanguages.find((entry) => entry.code.toLowerCase() === normalizedCode);
  if (extraLanguage) {
    return extraLanguage.label;
  }

  if (typeof Intl === 'undefined' || typeof Intl.DisplayNames === 'undefined') {
    return code.toUpperCase();
  }

  try {
    const displayNames = new Intl.DisplayNames(['en'], { type: 'language' });
    const name = displayNames.of(code);
    return name || code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
};

export const applyTheme = (themePreference: ThemePreference): void => {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  root.setAttribute('data-theme', themePreference);
  root.setAttribute('data-bs-theme', themePreference);
};

export const detectPreferredTheme = (): ThemePreference => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const scrollToVerse = async (target: QuickJumpTarget): Promise<void> => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  if (!target.verse) {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  const elementId = verseDomId(target.book, target.chapter, target.verse);

  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

  const element = document.getElementById(elementId);
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
};
