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

/** A page of a resource document: `doc` is the content hash, or the publisher's documentId when `lib` is set. */
export interface DocumentLinkTarget {
  doc: string;
  lib?: string;
  page: number;
}

/** Dispatched on window to re-open the current hash's document link (clicking a link whose href is already the hash fires no hashchange). */
export const REOPEN_DOCUMENT_LINK_EVENT = 'marginalia:reopen-document-link';

const SEARCH_HASH_QUERY_PARAM = 'q';
const DOCUMENT_LINK_QUERY_PARAMS = ['doc', 'lib', 'page'] as const;

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

export interface LanguageFilterResult<T> {
  translations: T[];
  /** Nothing matched the selected languages, so every translation is returned. */
  usedFallback: boolean;
}

export const filterTranslationsByLanguages = <T extends Pick<BibleTranslationMeta, 'language'>>(
  translations: T[],
  selectedLanguages: string[]
): LanguageFilterResult<T> => {
  if (selectedLanguages.length === 0) {
    return { translations, usedFallback: false };
  }
  const normalizedCodes = new Set(normalizeLanguages(selectedLanguages));
  const matches = translations.filter((t) => {
    const langs = Array.isArray(t.language) ? t.language : (t.language ? [t.language] : []);
    if (langs.length === 0) {
      // Keep source-provided translations discoverable even when language metadata is missing.
      return true;
    }
    return langs.some((l) => normalizedCodes.has(l));
  });
  return matches.length === 0
    ? { translations, usedFallback: true }
    : { translations: matches, usedFallback: false };
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

/**
 * Sets the location hash without the browser's native jump-to-top (or jump-to-id).
 * `location.hash =` and `<a href="#…">` both scroll; chapter changes already use history instead.
 */
export const assignHashWithoutScroll = (hash: string): void => {
  if (typeof window === 'undefined') {
    return;
  }

  const nextHash = hash.startsWith('#') ? hash : `#${hash}`;
  if (window.location.hash === nextHash) {
    return;
  }

  window.history.pushState(
    window.history.state,
    '',
    `${window.location.pathname}${window.location.search}${nextHash}`
  );
  window.dispatchEvent(new HashChangeEvent('hashchange'));
};

export const verseDomId = (book: string, chapter: number, verse: number): string => {
  return `${book.replace(/\s+/g, '_')}-${chapter}-${verse}`;
};

export const verseElementId = (
  contentBook: string | null | undefined,
  contentChapter: number | null | undefined,
  verse: number
): string | undefined => {
  if (!contentBook || !contentChapter || contentChapter <= 0 || verse <= 0) {
    return undefined;
  }

  return verseDomId(contentBook, contentChapter, verse);
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

// e.g. "#/Romans/8/28?doc=<sha256>&page=12" or "#/Romans/8/28?lib=1a2b3c4d&doc=<documentId>&page=12".
export const buildDocumentLinkRoute = (
  reference: HashRouteTarget | null | undefined,
  link: DocumentLinkTarget
): string => {
  const basePath = reference ? buildHashRoute(reference, true) : '#/';
  const params = new URLSearchParams();
  if (link.lib) {
    params.set('lib', link.lib);
  }
  params.set('doc', link.doc);
  params.set('page', String(Math.max(1, Math.trunc(link.page))));
  return `${basePath}?${params.toString()}`;
};

export const parseDocumentLinkFromHash = (hashValue: string): DocumentLinkTarget | null => {
  const queryIndex = hashValue ? hashValue.indexOf('?') : -1;
  if (queryIndex === -1) {
    return null;
  }

  const params = new URLSearchParams(hashValue.slice(queryIndex + 1));
  const doc = params.get('doc')?.trim();
  if (!doc) {
    return null;
  }

  const page = Number.parseInt(params.get('page') ?? '', 10);
  const lib = params.get('lib')?.trim();
  return {
    doc,
    ...(lib ? { lib } : {}),
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
};

const POPOUT_HASH_QUERY_PARAM = 'popout';
export const PANEL_POPOUT_VALUE = 'panel';

const splitHashQuery = (hashValue: string): { base: string; params: URLSearchParams } => {
  const queryIndex = hashValue ? hashValue.indexOf('?') : -1;
  return queryIndex === -1
    ? { base: hashValue || '#/', params: new URLSearchParams() }
    : { base: hashValue.slice(0, queryIndex), params: new URLSearchParams(hashValue.slice(queryIndex + 1)) };
};

const joinHashQuery = (base: string, params: URLSearchParams): string => {
  const rest = params.toString();
  return rest ? `${base}?${rest}` : base;
};

/** e.g. "panel" for "#/John/3/16?popout=panel". */
export const parsePopoutFromHash = (hashValue: string): string | null => {
  const value = splitHashQuery(hashValue).params.get(POPOUT_HASH_QUERY_PARAM)?.trim();
  return value ? value : null;
};

export const withPopoutParam = (hashValue: string, popout: string = PANEL_POPOUT_VALUE): string => {
  const { base, params } = splitHashQuery(hashValue);
  params.set(POPOUT_HASH_QUERY_PARAM, popout);
  return joinHashQuery(base, params);
};

export const withoutPopoutParam = (hashValue: string): string => {
  const { base, params } = splitHashQuery(hashValue);
  if (!params.has(POPOUT_HASH_QUERY_PARAM)) {
    return hashValue;
  }
  params.delete(POPOUT_HASH_QUERY_PARAM);
  return joinHashQuery(base, params);
};

/** The hash without document-link params; other params (such as the search query) are kept. */
export const stripDocumentLinkFromHash = (hashValue: string): string => {
  const queryIndex = hashValue ? hashValue.indexOf('?') : -1;
  if (queryIndex === -1) {
    return hashValue;
  }

  const params = new URLSearchParams(hashValue.slice(queryIndex + 1));
  for (const name of DOCUMENT_LINK_QUERY_PARAMS) {
    params.delete(name);
  }

  const base = hashValue.slice(0, queryIndex);
  const rest = params.toString();
  return rest ? `${base}?${rest}` : base;
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

export interface ScrollToVerseOptions {
  behavior?: ScrollBehavior;
  block?: ScrollLogicalPosition;
  followLayout?: boolean;
}

export const VERSE_REFERENCE_SCROLL_OPTIONS: ScrollToVerseOptions = {
  behavior: 'auto',
  block: 'nearest',
  followLayout: true,
};

const VIEW_EPSILON_PX = 1;
const HEADER_SCROLL_PADDING_PX = 8;
const ELEMENT_WAIT_MS = 4000;
const LAYOUT_FOLLOW_MS = 2500;
const STABLE_VISIBLE_FRAMES = 3;
const USER_SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End', ' ']);

type VerseScrollSession = {
  id: number;
  cancelled: boolean;
  userInterrupted: boolean;
  ignoreProgrammaticScroll: boolean;
  rafIds: number[];
  pendingFrameResolvers: Array<() => void>;
  cleanupFns: Array<() => void>;
};

let verseScrollSessionId = 0;
let activeVerseScrollSession: VerseScrollSession | null = null;

const stickyHeaderBottom = (): number => {
  const header = document.querySelector('.verse-grid-header');
  if (!header) {
    return 0;
  }

  const rect = header.getBoundingClientRect();
  if (rect.height <= 0) {
    return 0;
  }

  return Math.max(0, rect.bottom);
};

export const isElementFullyInView = (element: Element): boolean => {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) {
    return false;
  }

  const topBound = stickyHeaderBottom();
  const bottomBound = window.innerHeight;
  const available = bottomBound - topBound;
  if (available <= 0) {
    return false;
  }

  if (rect.height > available + VIEW_EPSILON_PX) {
    return rect.top >= topBound - VIEW_EPSILON_PX && rect.top <= topBound + HEADER_SCROLL_PADDING_PX;
  }

  return rect.top >= topBound - VIEW_EPSILON_PX && rect.bottom <= bottomBound + VIEW_EPSILON_PX;
};

const applyStickyScrollMargin = (element: HTMLElement): void => {
  const headerOffset = Math.ceil(stickyHeaderBottom()) + HEADER_SCROLL_PADDING_PX;
  element.style.scrollMarginTop = `${headerOffset}px`;
};

const cancelVerseScrollSession = (session: VerseScrollSession | null): void => {
  if (!session) {
    return;
  }

  session.cancelled = true;
  session.rafIds.forEach((rafId) => window.cancelAnimationFrame(rafId));
  session.rafIds = [];
  session.pendingFrameResolvers.splice(0).forEach((resolve) => resolve());
  session.cleanupFns.splice(0).forEach((cleanup) => cleanup());
};

export const cancelActiveVerseScroll = (): void => {
  cancelVerseScrollSession(activeVerseScrollSession);
  activeVerseScrollSession = null;
};

const beginVerseScrollSession = (): VerseScrollSession => {
  cancelActiveVerseScroll();
  verseScrollSessionId += 1;
  const session: VerseScrollSession = {
    id: verseScrollSessionId,
    cancelled: false,
    userInterrupted: false,
    ignoreProgrammaticScroll: false,
    rafIds: [],
    pendingFrameResolvers: [],
    cleanupFns: [],
  };
  activeVerseScrollSession = session;
  return session;
};

const isCurrentVerseScrollSession = (session: VerseScrollSession): boolean => (
  !session.cancelled
  && !session.userInterrupted
  && activeVerseScrollSession?.id === session.id
);

const waitForAnimationFrame = (session: VerseScrollSession): Promise<void> => {
  return new Promise((resolve) => {
    const finish = () => {
      session.pendingFrameResolvers = session.pendingFrameResolvers.filter((pending) => pending !== finish);
      resolve();
    };

    session.pendingFrameResolvers.push(finish);
    const rafId = window.requestAnimationFrame(() => {
      session.rafIds = session.rafIds.filter((id) => id !== rafId);
      finish();
    });
    session.rafIds.push(rafId);
  });
};

const markProgrammaticScroll = (session: VerseScrollSession): void => {
  session.ignoreProgrammaticScroll = true;
  const firstRafId = window.requestAnimationFrame(() => {
    const secondRafId = window.requestAnimationFrame(() => {
      session.ignoreProgrammaticScroll = false;
      session.rafIds = session.rafIds.filter((id) => id !== firstRafId && id !== secondRafId);
    });
    session.rafIds.push(secondRafId);
  });
  session.rafIds.push(firstRafId);
};

const scrollElementIntoView = (
  session: VerseScrollSession,
  element: HTMLElement,
  behavior: ScrollBehavior,
  block: ScrollLogicalPosition
): void => {
  applyStickyScrollMargin(element);
  markProgrammaticScroll(session);
  element.scrollIntoView({ behavior, block });
};

const attachUserScrollInterrupt = (session: VerseScrollSession): void => {
  const interrupt = () => {
    session.userInterrupted = true;
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (USER_SCROLL_KEYS.has(event.key)) {
      interrupt();
    }
  };

  // Only treat explicit user gestures as an interrupt. Assigning location.hash on a
  // book/chapter change (and the chapter remount itself) can emit `scroll` without
  // a gesture; aborting on that leaves a cold late-verse jump stuck at chapter top.
  window.addEventListener('wheel', interrupt, { passive: true });
  window.addEventListener('touchmove', interrupt, { passive: true });
  window.addEventListener('keydown', handleKeyDown, true);

  session.cleanupFns.push(() => {
    window.removeEventListener('wheel', interrupt);
    window.removeEventListener('touchmove', interrupt);
    window.removeEventListener('keydown', handleKeyDown, true);
  });
};

const waitForVerseElement = async (
  session: VerseScrollSession,
  elementId: string,
  deadline: number
): Promise<HTMLElement | null> => {
  while (isCurrentVerseScrollSession(session) && performance.now() < deadline) {
    const element = document.getElementById(elementId);
    if (element) {
      return element;
    }

    await waitForAnimationFrame(session);
  }

  return isCurrentVerseScrollSession(session) ? document.getElementById(elementId) : null;
};

const followVerseUntilSettled = async (
  session: VerseScrollSession,
  elementId: string,
  behavior: ScrollBehavior,
  block: ScrollLogicalPosition,
  deadline: number,
  onFirstVisible: () => void
): Promise<void> => {
  let stableVisibleFrames = 0;
  let notifiedVisible = false;
  const notifyVisible = () => {
    if (!notifiedVisible) {
      notifiedVisible = true;
      onFirstVisible();
    }
  };

  while (isCurrentVerseScrollSession(session) && performance.now() < deadline) {
    const element = document.getElementById(elementId);
    if (!element) {
      stableVisibleFrames = 0;
      await waitForAnimationFrame(session);
      continue;
    }

    if (!isElementFullyInView(element)) {
      scrollElementIntoView(session, element, behavior, block);
      stableVisibleFrames = 0;
    } else {
      stableVisibleFrames += 1;
      notifyVisible();
      if (stableVisibleFrames >= STABLE_VISIBLE_FRAMES) {
        break;
      }
    }

    await waitForAnimationFrame(session);
  }

  notifyVisible();
};

const finishVerseScrollSession = (session: VerseScrollSession): void => {
  if (activeVerseScrollSession?.id === session.id) {
    cancelVerseScrollSession(session);
    activeVerseScrollSession = null;
  }
};

export const scrollToVerse = async (
  target: QuickJumpTarget,
  options: ScrollToVerseOptions = {}
): Promise<void> => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  const behavior = options.behavior ?? 'auto';
  const block = options.block ?? 'nearest';
  const followLayout = options.followLayout ?? true;
  const session = beginVerseScrollSession();
  attachUserScrollInterrupt(session);

  if (!target.verse) {
    await waitForAnimationFrame(session);
    if (isCurrentVerseScrollSession(session)) {
      markProgrammaticScroll(session);
      window.scrollTo({ top: 0, behavior });
    }
    finishVerseScrollSession(session);
    return;
  }

  const elementId = verseDomId(target.book, target.chapter, target.verse);
  const element = await waitForVerseElement(session, elementId, performance.now() + ELEMENT_WAIT_MS);
  if (!element || !isCurrentVerseScrollSession(session)) {
    finishVerseScrollSession(session);
    return;
  }

  scrollElementIntoView(session, element, behavior, block);

  if (!followLayout) {
    finishVerseScrollSession(session);
    return;
  }

  const followDeadline = performance.now() + LAYOUT_FOLLOW_MS;
  await new Promise<void>((resolve) => {
    void followVerseUntilSettled(session, elementId, behavior, block, followDeadline, resolve)
      .finally(() => {
        finishVerseScrollSession(session);
      });
  });
};
