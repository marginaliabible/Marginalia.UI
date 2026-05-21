import type { QuickJumpTarget, ThemePreference, BibleTranslationMeta } from './models/bible';
import languageOverrides from '../public/data/languageOverrides.json';

export interface TranslationSelectOption {
  value: string;
  label: string;
}

export type WorkspacePanelKey = 'search';

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

export const getLanguageDisplayName = (code: string): string => {
  const overrides = languageOverrides as Record<string, string>;
  if (overrides[code]) {
    return overrides[code];
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
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
};
