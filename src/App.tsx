import AppHeader from './components/AppHeader';
import SearchBar from './components/SearchBar';
import WorkspaceMainPane from './components/WorkspaceMainPane';
import WorkspaceDivider from './components/WorkspaceDivider';
import WorkspaceSidePanel from './components/WorkspaceSidePanel';
import PanelWindowShell from './components/PanelWindowShell';
import LoadingStatus from './components/LoadingStatus';
import SettingsModal from './components/SettingsModal';
import GitHubAuthPromptModal from './components/GitHubAuthPromptModal';
import AccountControl from './components/AccountControl';
import { sanctumPlugin } from '@marginalia/sanctum';

const SanctumAccountSync = sanctumPlugin.AccountSync;
const SanctumSettingsFooter = sanctumPlugin.SettingsFooter;
import ToastPanel from './components/ToastPanel';
import HelpTourRunner from './components/HelpTourRunner';
import { useCallback, useEffect, useMemo, useRef, useState, ChangeEvent } from 'react';
import { useAppDispatch, useAppSelector } from './store/hooks';
import {
  loadTranslation,
  refreshTranslations,
  createDeferredSearchTab,
  setActiveTab,
  openHelpTab,
  setCurrentBibleFromId,
  removeLoadedTranslations,
} from './store/slices/bibleSlice';
import { resolveSelectedVerseContext } from './utils/selectedVerseContext';
import { CLIPBOARD_MUTED_COLOR, formatVerseHtml, markupFlagsFromBible, stripVerseMarkers } from './utils/verseMarkup';
import { formatVerseReference } from './utils/scriptureReference';
import { copyRichTextToClipboard } from './utils/copyRichTextToClipboard';
import {
  setSelectedTranslationId,
  setSelectedTranslationIds,
  setSelectedBook,
  setSelectedChapter,
  setVerseSelection,
  clearVerseSelection,
  setSelectedLanguages,
  addSourceUrl,
  removeSourceUrl,
  removeTranslationsByIds,
  setTheme,
  setTranslatorItalics,
  setTranslatorParagraphMarks,
  setReady,
  restoreState,
  addTranslationRecord,
  removeTranslationRecord,
  toggleStarTranslation,
  reorderTranslations,
  setDisabledSourceItems,
  setResourceTagOverrides,
  dropTranslationRecords,
  setDocumentLinkNotice,
} from './store/slices/uiSlice';
import {
  bibleService,
  normalizeSourceUrlInput,
  type SourceProbeResult,
} from './services/bibleService';
import { loadSubscriptionCatalog, type SubscriptionLibrary } from './services/subscriptionCatalogService';
import type {
  AddSourceUrlResult,
  SubscriptionApplySummary,
  SubscriptionChanges,
  SubscriptionsBinding,
} from './models/subscription';
import { hyperlinkService } from './services/hyperlinkService';
import { showToast } from './services/toastService';
import { formatLanguageChangeToast } from './utils/syncToastMessages';
import { hasValidGitHubAuthSession } from './services/githubPrivateSourceService';
import type { QuickJumpTarget } from './models/bible';
import {
  type WorkspacePanelKey,
  normalizeLanguageSelection,
  normalizeLanguages,
  filterTranslationsByLanguages,
  detectPreferredLanguages,
  getLanguageDisplayName,
  applyTheme,
  buildHashRoute,
  parseSearchFromHash,
  detectPreferredTheme,
  scrollToVerse,
  VERSE_REFERENCE_SCROLL_OPTIONS,
} from './App';
import { useDesktopLayout } from './hooks/useDesktopLayout';
import { useWorkspaceSplit } from './hooks/useWorkspaceSplit';
import { usePopupPanel } from './hooks/usePopupPanel';
import { useMobilePanelEffects } from './hooks/useMobilePanelEffects';
import { useHashRouteSync } from './hooks/useHashRouteSync';
import { useDocumentLinkRoute } from './hooks/useDocumentLinkRoute';
import { useVerseTabContextSync } from './hooks/useVerseTabContextSync';
import { useDocumentTitle, useWindowLabel } from './hooks/useDocumentTitle';
import { useWindowRegistry } from './hooks/useWindowRegistry';
import { useWindowStateSync } from './hooks/useWindowStateSync';
import { useDocumentPopoutWindow, usePopoutBoundsTracking } from './hooks/useDocumentPopout';
import { useWindowCommandHandler } from './hooks/useWindowCommandHandler';
import { isDocumentWindow, isPanelWindow } from './services/windowChannel';
import { routeInteraction } from './services/windowRouting';
import { beginGitHubAuthorization, initializeGitHubAuthFlow } from './services/githubAuthFlowService';
import {
  computeDisabledTranslationIds,
  normalizeDisabledSourceItems,
  normalizeResourceTagOverrides,
  normalizeTimestampMap,
  parseSourceItemKey,
} from './utils/sourceSubscriptions';
import './App.scss';

const STATE_CACHE_KEY = 'marginalia:state';

function App() {
    const formatSourceProbeFailure = (probe: Extract<SourceProbeResult, { ok: false }>): string => {
      if (probe.message && probe.message.trim().length > 0) {
        return probe.message;
      }

      if (probe.code === 'not-authorized') {
        return 'Not authorized. Connect GitHub (for private sources), then retry.';
      }

      if (probe.code === 'not-found') {
        return 'Source not found. Verify the URL path and file name, then retry.';
      }

      if (probe.code === 'rate-limited') {
        return 'Rate limited by the source. Wait a moment and retry.';
      }

      if (probe.code === 'source-unavailable') {
        return 'Source unavailable. Check host status or try again later.';
      }

      if (probe.code === 'invalid-payload') {
        return 'Invalid payload format. Use a settings JSON or a translation JSON with expected shape.';
      }

      return 'Source could not be reached due to network or CORS restrictions. Check CORS policy and connectivity.';
    };

  const dispatch = useAppDispatch();
  const modalRef = useRef<any>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const mainPaneRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [isMobilePanelOpen, setIsMobilePanelOpen] = useState(false);
  const [isPanelFloated, setIsPanelFloated] = useState(false);
  const [miniSearchFocusToken, setMiniSearchFocusToken] = useState(0);
  const [isMiniSearchVisible, setIsMiniSearchVisible] = useState(false);
  const [subscriptionLibraries, setSubscriptionLibraries] = useState<SubscriptionLibrary[]>([]);
  const [isSubscriptionCatalogLoading, setIsSubscriptionCatalogLoading] = useState(false);
  const [subscriptionCatalogRequest, setSubscriptionCatalogRequest] = useState(0);
  const subscriptionCatalogGenerationRef = useRef(0);
  const [isGitHubAuthPromptOpen, setIsGitHubAuthPromptOpen] = useState(false);
  const [gitHubAuthPromptContext, setGitHubAuthPromptContext] = useState<string | null>(null);
  const [gitHubAuthPromptError, setGitHubAuthPromptError] = useState<string | null>(null);
  const [isLaunchingGitHubAuth, setIsLaunchingGitHubAuth] = useState(false);
  const goToReferenceGenerationRef = useRef(0);

  // Redux state
  const {
    availableTranslations,
    extraLanguages,
    currentBible,
    loadedTranslations,
    isLoading,
    error,
    tabs,
    activeTabId,
    isPanelDetached,
  } = useAppSelector((state) => state.bible);

  const {
    selectedTranslationId,
    selectedTranslationIds,
    translationRecords,
    selectedBook,
    selectedChapter,
    selectedVerses,
    selectedVerseTranslationId,
    selectedLanguages,
    sourceUrls,
    sourceUrlAddedAt,
    sourceUrlTombstones,
    disabledSourceItems,
    resourceTagOverrides,
    resourceHiddenTags,
    pdfViewer,
    documentLinkNotice,
    theme,
    translatorItalics,
    translatorParagraphMarks,
    ready,
    userId,
  } = useAppSelector((state) => state.ui);

  const safeAvailableTranslations = Array.isArray(availableTranslations) ? availableTranslations : [];
  const safeExtraLanguages = Array.isArray(extraLanguages) ? extraLanguages : [];
  const safeTranslationRecords = Array.isArray(translationRecords) ? translationRecords : [];
  const safeSelectedTranslationIds = Array.isArray(selectedTranslationIds) ? selectedTranslationIds : [];
  const safeSelectedLanguages = Array.isArray(selectedLanguages) ? selectedLanguages : [];

  const isDesktopLayout = useDesktopLayout();
  const isMobileLayout = !isDesktopLayout;
  const isPanelFloating = isMobileLayout || isPanelFloated;
  const isPanelDockedDesktop = isDesktopLayout && !isPanelFloated;

  const activeWorkspacePanel: WorkspacePanelKey | null = tabs.length > 0 ? 'search' : null;

  const { focusMainWindow, handleToggleDetachPanel, isPanelWindowDocked } = usePopupPanel({
    dispatch,
    isPanelDetached,
  });

  useDocumentTitle(isPanelWindow);
  const windowLabel = useWindowLabel(isPanelWindow);
  useWindowRegistry({ label: windowLabel });
  useWindowStateSync({ ready });
  useDocumentPopoutWindow({ ready });
  usePopoutBoundsTracking();

  const { mainPanePercent, sidePanePercent, handleDividerPointerDown, handleDividerKeyDown } =
    useWorkspaceSplit({ workspaceRef, isDesktopLayout, activeWorkspacePanel });

  useMobilePanelEffects({
    isPanelFloating,
    isMobilePanelOpen,
    isPanelDockedDesktop,
    isPanelDetached,
    activeWorkspacePanel,
    setIsMobilePanelOpen,
  });

  useEffect(() => {
    return initializeGitHubAuthFlow();
  }, []);

  const handleCopySelectedVerses = useCallback(async () => {
    if (!selectedBook) {
      return;
    }

    // Copy from the translation column the selection came from, not the primary translation.
    const sourceBible = (selectedVerseTranslationId
      ? loadedTranslations[selectedVerseTranslationId]
      : null) ?? currentBible;
    if (!sourceBible) {
      return;
    }

    const book = sourceBible.books.find((entry) => entry.name === selectedBook);
    const chapter = book?.chapters.find((entry) => entry.chapter === selectedChapter);
    if (!book || !chapter) {
      return;
    }

    const availableVerseNumbers = chapter.verses.map((verse) => verse.verse);
    const chosenVerses = selectedVerses.length > 0
      ? selectedVerses.filter((verse) => availableVerseNumbers.includes(verse))
      : [chapter.verses[0]?.verse].filter((verse): verse is number => typeof verse === 'number');

    if (chosenVerses.length === 0) {
      return;
    }

    const markupFlags = markupFlagsFromBible(sourceBible);
    const verseMarkupSettings = { italics: translatorItalics };
    const normalizedVerses = Array.from(new Set(chosenVerses)).sort((left, right) => left - right);
    const verseTexts = normalizedVerses
      .map((verseNumber) => {
        const raw = chapter.verses.find((verse) => verse.verse === verseNumber)?.text ?? '';
        return {
          verseNumber,
          plain: stripVerseMarkers(raw, markupFlags),
          html: formatVerseHtml(raw, markupFlags, verseMarkupSettings),
        };
      })
      .filter((entry) => entry.plain.length > 0);

    if (verseTexts.length === 0) {
      return;
    }

    const header = formatVerseReference(selectedBook, selectedChapter, normalizedVerses);
    const body = verseTexts.length === 1
      ? verseTexts[0].plain
      : verseTexts.map((entry) => `${entry.verseNumber}\u00A0 ${entry.plain}`).join('\n');
    const copyText = `${header}\n${body}`;

    const escapeHtml = (value: string): string => {
      return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    };

    const referenceHtml = `<span>${escapeHtml(header)}</span><br/>`;
    const bodyHtml = verseTexts.length === 1
      ? verseTexts[0].html
      : verseTexts
        .map((entry) => (
          `<span style="color:${CLIPBOARD_MUTED_COLOR};">${entry.verseNumber}</span> ${entry.html}`
        ))
        .join('<br/>');
    const copyHtml = `<div style="font-family:Calibri, Arial, sans-serif; font-size:11pt;">${referenceHtml}${bodyHtml}</div>`;

    const copied = await copyRichTextToClipboard(copyText, copyHtml);
    if (copied) {
      showToast({ message: `${header} copied to your clipboard.` });
    }
  }, [
    currentBible,
    loadedTranslations,
    selectedBook,
    selectedChapter,
    selectedVerses,
    selectedVerseTranslationId,
    translatorItalics,
  ]);

  const focusSearchBox = useCallback(() => {
    const searchInput = searchInputRef.current;
    const rect = searchInput?.getBoundingClientRect();
    const isTopSearchVisible = Boolean(
      rect
      && rect.width > 0
      && rect.height > 0
      && rect.bottom > 0
      && rect.top < window.innerHeight
    );

    if (isTopSearchVisible) {
      searchInput?.focus();
      searchInput?.select();
    } else {
      setMiniSearchFocusToken((token) => token + 1);
    }
  }, []);

  // Ctrl/Cmd+K to focus search input (the Bible window's, from panel and document windows);
  // Ctrl+C to copy selected verses from the focused main pane.
  useEffect(() => {
    const handleShortcut = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (isPanelWindow || isDocumentWindow) {
          routeInteraction({ kind: 'bible', type: 'focus-search' }, () => {}, { quiet: true });
          return;
        }
        focusSearchBox();
        return;
      }

      const isMainPaneFocused = Boolean(
        mainPaneRef.current && document.activeElement && mainPaneRef.current.contains(document.activeElement)
      );

      if (pdfViewer.isOpen) {
        return;
      }

      if (isMainPaneFocused && e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        void handleCopySelectedVerses();
      }
    };

    window.addEventListener('keydown', handleShortcut, true);
    return () => {
      window.removeEventListener('keydown', handleShortcut, true);
    };
  }, [focusSearchBox, handleCopySelectedVerses, pdfViewer.isOpen]);

  // Initialize app
  useEffect(() => {
    const initApp = async () => {
      const hasPersistedState =
        typeof window !== 'undefined' && window.localStorage.getItem(STATE_CACHE_KEY) !== null;
      const savedState = bibleService.readState();

      const normalizedLanguages = normalizeLanguages(savedState?.languages);
      const detectedLanguages = detectPreferredLanguages();
      const finalLanguages = normalizedLanguages.length > 0 ? normalizedLanguages : detectedLanguages;

      const hydratedTranslationRecords = Array.isArray(savedState?.translationRecords)
        ? savedState.translationRecords
        : undefined;
      const hydratedTranslationIds = Array.isArray(savedState?.lastTranslationIds)
        ? savedState.lastTranslationIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        : undefined;
      const fallbackTranslationId = hydratedTranslationRecords?.[0]?.id || hydratedTranslationIds?.[0] || 'KJV';
      const nextTranslationId =
        typeof savedState?.lastTranslationId === 'string' && savedState.lastTranslationId.trim().length > 0
          ? savedState.lastTranslationId
          : fallbackTranslationId;
      const nextTranslationIds = hydratedTranslationIds && hydratedTranslationIds.length > 0
        ? hydratedTranslationIds
        : [nextTranslationId];
      const nextTranslationRecords = hydratedTranslationRecords && hydratedTranslationRecords.length > 0
        ? hydratedTranslationRecords
        : [{ id: nextTranslationId, starred: true }];
      const initialSearchTerm = typeof window !== 'undefined'
        ? parseSearchFromHash(window.location.hash) ?? ''
        : '';
      const hasSavedReference =
        hasPersistedState
        && typeof savedState?.lastBook === 'string'
        && savedState.lastBook.trim().length > 0
        && typeof savedState?.lastChapter === 'number'
        && savedState.lastChapter > 0;
      const initialBook = hasSavedReference ? savedState.lastBook : 'John';
      const initialChapter = hasSavedReference ? savedState.lastChapter : 10;
      dispatch(restoreState({
        selectedTranslationId: nextTranslationId,
        selectedTranslationIds: nextTranslationIds,
        translationRecords: nextTranslationRecords,
        selectedBook: initialBook,
        selectedChapter: initialChapter,
        theme: savedState?.theme ?? detectPreferredTheme(),
        translatorItalics: typeof savedState?.translatorItalics === 'boolean' ? savedState.translatorItalics : true,
        translatorParagraphMarks: typeof savedState?.translatorParagraphMarks === 'boolean'
          ? savedState.translatorParagraphMarks
          : true,
        selectedLanguages: finalLanguages,
        sourceUrls: Array.isArray(savedState?.sourceUrls) ? savedState.sourceUrls : [],
        sourceUrlAddedAt: normalizeTimestampMap(savedState?.sourceUrlAddedAt),
        sourceUrlTombstones: normalizeTimestampMap(savedState?.sourceUrlTombstones),
        disabledSourceItems: normalizeDisabledSourceItems(savedState?.disabledSourceItems),
        resourceTagOverrides: normalizeResourceTagOverrides(savedState?.resourceTagOverrides),
        resourceHiddenTags: Array.isArray(savedState?.resourceHiddenTags) ? savedState.resourceHiddenTags : [],
        searchTerm: initialSearchTerm,
        userId: typeof savedState?.userId === 'string' && savedState.userId.trim().length > 0 ? savedState.userId : null,
      }));

      await dispatch(loadTranslation(nextTranslationId));
      if (initialSearchTerm) {
        const initialStarredTranslationIds = nextTranslationRecords
          .filter((record) => record.starred)
          .map((record) => record.id);
        const searchTranslationIds = initialStarredTranslationIds.length > 0
          ? initialStarredTranslationIds
          : nextTranslationIds;
        dispatch(createDeferredSearchTab({ query: initialSearchTerm, translationIds: searchTranslationIds }));
      }
      void dispatch(refreshTranslations(false));
      dispatch(setReady(true));
    };

    initApp();
  }, [dispatch]);

  // Persist state on changes
  useEffect(() => {
    if (!ready) return;

    bibleService.persistState({
      lastTranslationId: selectedTranslationId,
      lastTranslationIds: safeSelectedTranslationIds,
      translationRecords: safeTranslationRecords,
      lastBook: selectedBook || undefined,
      lastChapter: selectedBook ? selectedChapter : undefined,
      lastVerse: undefined,
      lastSearch: undefined,
      theme,
      translatorItalics,
      translatorParagraphMarks,
      languages: safeSelectedLanguages,
      sourceUrls,
      sourceUrlAddedAt,
      sourceUrlTombstones,
      disabledSourceItems,
      resourceTagOverrides,
      resourceHiddenTags,
      userId: userId ?? undefined,
    });
  }, [
    selectedTranslationId,
    safeSelectedTranslationIds,
    safeTranslationRecords,
    selectedBook,
    selectedChapter,
    theme,
    translatorItalics,
    translatorParagraphMarks,
    safeSelectedLanguages,
    sourceUrls,
    sourceUrlAddedAt,
    sourceUrlTombstones,
    disabledSourceItems,
    resourceTagOverrides,
    resourceHiddenTags,
    userId,
    ready,
  ]);

  useEffect(() => {
    dispatch(setCurrentBibleFromId(selectedTranslationId));
  }, [dispatch, selectedTranslationId]);

  // Safety fallback: if a translation is loaded but selection is missing,
  // default to John 10:10 (or closest available chapter in John).
  useEffect(() => {
    if (!currentBible || selectedBook) {
      return;
    }

    const johnBook = currentBible.books.find((book) => book.name === 'John') ?? currentBible.books[0];
    if (!johnBook) {
      return;
    }

    const chapterTenExists = johnBook.chapters.some((chapter) => chapter.chapter === 10);
    const defaultChapter = chapterTenExists
      ? 10
      : (johnBook.chapters[0]?.chapter ?? 1);
    dispatch(setSelectedBook(johnBook.name));
    dispatch(setSelectedChapter(defaultChapter));
    dispatch(clearVerseSelection());
  }, [currentBible, selectedBook, dispatch]);

  // Apply theme changes to document
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useHashRouteSync({
    currentBible,
    ready: ready && !isPanelWindow,
    selectedBook,
    selectedChapter,
    selectedTranslationId,
    selectedVerses,
  });

  useDocumentLinkRoute({ ready });

  useVerseTabContextSync();

  const translationMetadataById = useMemo(
    () =>
      new Map(safeAvailableTranslations.map((translation) => [translation.id, translation] as const)),
    [safeAvailableTranslations]
  );

  const getLoadedLanguageDisplayName = useCallback(
    (code: string) => getLanguageDisplayName(code, safeExtraLanguages),
    [safeExtraLanguages]
  );

  const languageOptions = useMemo(() => {
    const langMap = new Map<string, { code: string; count: number }>();
    for (const translation of safeAvailableTranslations) {
      const rawLang = translation.language;
      const codes = Array.isArray(rawLang) ? rawLang : (rawLang ? [rawLang] : []);
      for (const code of codes) {
        const existing = langMap.get(code);
        if (existing) {
          existing.count++;
        } else {
          langMap.set(code, { code, count: 1 });
        }
      }
    }
    return Array.from(langMap.values())
      .sort((a, b) => {
          const nameA = getLoadedLanguageDisplayName(a.code);
          const nameB = getLoadedLanguageDisplayName(b.code);
        return nameA.localeCompare(nameB);
      });
        }, [safeAvailableTranslations, getLoadedLanguageDisplayName]);

  const filteredTranslations = useMemo(
    () => filterTranslationsByLanguages(safeAvailableTranslations, safeSelectedLanguages).translations,
    [safeAvailableTranslations, safeSelectedLanguages]
  );

  // Ensure selectedTranslationId is valid; fallback to first starred or KJV
  useEffect(() => {
    const recordIds = new Set(safeTranslationRecords.map((r) => r.id));
    if (!recordIds.has(selectedTranslationId)) {
      const starredIds = safeTranslationRecords.filter((r) => r.starred).map((r) => r.id);
      const validId = starredIds[0] || safeTranslationRecords[0]?.id || 'KJV';
      dispatch(setSelectedTranslationId(validId));
    }
  }, [safeTranslationRecords, selectedTranslationId, dispatch]);

  const languageFilteredSubscriptionLibraries = useMemo(() => {
    const visibleIds = new Set(filteredTranslations.map((translation) => translation.id));
    return subscriptionLibraries.map((library) => {
      const translations = library.types.translation;
      if (!translations) {
        return library;
      }

      const visible = translations.filter((document) => visibleIds.has(document.itemId));
      if (visible.length === translations.length) {
        return library;
      }

      const { translation: _hidden, ...otherTypes } = library.types;
      return { ...library, types: visible.length > 0 ? { ...otherTypes, translation: visible } : otherTypes };
    });
  }, [filteredTranslations, subscriptionLibraries]);

  const disabledTranslationIds = useMemo(
    () => computeDisabledTranslationIds(safeAvailableTranslations, sourceUrls, disabledSourceItems),
    [disabledSourceItems, safeAvailableTranslations, sourceUrls]
  );

  const addableTranslations = useMemo(() => {
    const selectedIds = new Set(safeTranslationRecords.map((record) => record.id));
    return filteredTranslations
      .filter((translation) => !selectedIds.has(translation.id) && !disabledTranslationIds.has(translation.id))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [disabledTranslationIds, filteredTranslations, safeTranslationRecords]);

  const starredTranslationIds = useMemo(() => {
    return safeTranslationRecords.filter((r) => r.starred).map((r) => r.id);
  }, [safeTranslationRecords]);

  // Keep selectedTranslationIds in sync with translationRecords for backward compatibility
  useEffect(() => {
    const recordIds = safeTranslationRecords.map((r) => r.id);
    if (JSON.stringify(safeSelectedTranslationIds) !== JSON.stringify(recordIds)) {
      dispatch(setSelectedTranslationIds(recordIds));
    }
  }, [safeTranslationRecords, dispatch, safeSelectedTranslationIds]);

  const isDocumentViewerInMainPane = Boolean(pdfViewer?.isOpen);
  const useWideLayout = isDocumentViewerInMainPane
    || starredTranslationIds.length + (activeTabId ? 1 : 0) > 3;
  const hasSidePanel = !isPanelDetached && Boolean(activeWorkspacePanel);

  const goToReference = async (target: QuickJumpTarget, translationId?: string) => {
    const generation = ++goToReferenceGenerationRef.current;
    const nextActiveId = translationId && safeSelectedTranslationIds.includes(translationId)
      ? translationId
      : selectedTranslationId;

    // Only navigating without an explicit translation (e.g. quick jump) should switch the app's
    // primary translation. Jumping to a specific match (e.g. a search result) must only highlight
    // that verse in its own translation column, not permanently change the primary translation.
    let activeBible = currentBible;
    if (nextActiveId !== selectedTranslationId) {
      const loadResult = await dispatch(loadTranslation(nextActiveId));
      activeBible = loadTranslation.fulfilled.match(loadResult) ? loadResult.payload : currentBible;
    }
    if (generation !== goToReferenceGenerationRef.current) {
      return;
    }
    if (!activeBible) return;

    if (!activeBible.books.some((book) => book.name === target.book)) {
      return;
    }

    dispatch(setSelectedBook(target.book));
    dispatch(setSelectedChapter(target.chapter));
    if (target.verse) {
      dispatch(setVerseSelection({
        translationId: nextActiveId,
        verses: [target.verse],
        anchorVerse: target.verse,
      }));
    } else {
      dispatch(clearVerseSelection());
    }

    mainPaneRef.current?.focus({ preventScroll: true });

    await scrollToVerse(target, VERSE_REFERENCE_SCROLL_OPTIONS);
  };

  useWindowCommandHandler({ ready, goToReference, focusSearch: focusSearchBox });

  /** Panel navigation (e.g. a search result) belongs to whichever window shows the Bible. */
  const goToReferenceFromPanel = async (target: QuickJumpTarget, translationId?: string) => {
    const localNavigations: Promise<void>[] = [];
    routeInteraction(
      { kind: 'bible', type: 'go-to-reference', payload: { target, translationId } },
      () => {
        localNavigations.push(goToReference(target, translationId));
      }
    );
    await Promise.all(localNavigations);
  };

  const handleThemeToggle = (e: ChangeEvent<HTMLInputElement>) => {
    dispatch(setTheme(e.target.checked ? 'dark' : 'light'));
  };

  const handleTranslatorItalicsToggle = (e: ChangeEvent<HTMLInputElement>) => {
    dispatch(setTranslatorItalics(e.target.checked));
  };

  const handleTranslatorParagraphMarksToggle = (e: ChangeEvent<HTMLInputElement>) => {
    dispatch(setTranslatorParagraphMarks(e.target.checked));
  };

  const handleLanguagesChange = (selected: string[]) => {
    const nextLanguages = normalizeLanguageSelection(selected);
    const next = filterTranslationsByLanguages(safeAvailableTranslations, nextLanguages);
    dispatch(setSelectedLanguages(nextLanguages));
    showToast(formatLanguageChangeToast({
      languagesSelected: nextLanguages.length,
      previousCount: filteredTranslations.length,
      nextCount: next.translations.length,
      usedFallback: next.usedFallback,
    }));
  };

  const isLikelyGitHubSourceUrl = (value: string): boolean => {
    try {
      const parsed = new URL(value);
      const host = parsed.hostname.toLowerCase();
      return host === 'github.com' || host === 'raw.githubusercontent.com' || host === 'api.github.com';
    } catch {
      return false;
    }
  };

  const openGitHubAuthPrompt = useCallback((contextMessage?: string) => {
    setGitHubAuthPromptContext(contextMessage ?? null);
    setGitHubAuthPromptError(null);
    setIsLaunchingGitHubAuth(false);
    setIsGitHubAuthPromptOpen(true);
  }, []);

  const closeGitHubAuthPrompt = useCallback(() => {
    setIsGitHubAuthPromptOpen(false);
    setGitHubAuthPromptError(null);
    setIsLaunchingGitHubAuth(false);
  }, []);

  const handleContinueGitHubAuth = useCallback(() => {
    setIsLaunchingGitHubAuth(true);
    setGitHubAuthPromptError(null);
    const callbackBase = (import.meta.env.VITE_AUTH_SERVICE_URL || '').trim();
    const result = beginGitHubAuthorization(callbackBase);

    if (!result.ok) {
      setIsLaunchingGitHubAuth(false);
      setGitHubAuthPromptError(result.message ?? 'Unable to start GitHub sign-in.');
      return;
    }

    setIsGitHubAuthPromptOpen(false);
    setIsLaunchingGitHubAuth(false);
  }, []);

  const handleRequestGitHubAuth = useCallback((): void => {
    openGitHubAuthPrompt('Authentication is required before this source can be accessed.');
  }, [openGitHubAuthPrompt]);

  const requestSubscriptionCatalog = useCallback(() => {
    setSubscriptionCatalogRequest((current) => current + 1);
  }, []);

  useEffect(() => {
    if (subscriptionCatalogRequest === 0) {
      return;
    }

    const generation = ++subscriptionCatalogGenerationRef.current;
    setIsSubscriptionCatalogLoading(true);
    const translations = Array.isArray(availableTranslations) ? availableTranslations : [];
    void loadSubscriptionCatalog({ sourceUrls, userId, translations })
      .then((libraries) => {
        if (generation === subscriptionCatalogGenerationRef.current) {
          setSubscriptionLibraries(libraries);
        }
      })
      .catch((catalogError) => {
        console.warn('Failed to load subscription catalog.', catalogError);
      })
      .finally(() => {
        if (generation === subscriptionCatalogGenerationRef.current) {
          setIsSubscriptionCatalogLoading(false);
        }
      });
  }, [availableTranslations, sourceUrls, subscriptionCatalogRequest, userId]);

  const handleAddSourceUrl = async (url: string): Promise<AddSourceUrlResult> => {
    const normalizedUrl = normalizeSourceUrlInput(url);

    if (sourceUrls.includes(normalizedUrl)) {
      return { ok: false, message: 'That source URL is already saved.' };
    }

    const probe = await bibleService.probeSourceUrl(normalizedUrl);
    if (!probe.ok) {
      const isGitHubUrl = isLikelyGitHubSourceUrl(url) || isLikelyGitHubSourceUrl(normalizedUrl);
      if ((probe.code === 'not-authorized' || probe.code === 'not-found') && isGitHubUrl && !hasValidGitHubAuthSession()) {
        return {
          ok: false,
          message: 'Source not found or not accessible. Is this a private GitHub repo?',
          suggestGitHubAuth: true,
        };
      }

      return { ok: false, message: formatSourceProbeFailure(probe) };
    }

    dispatch(addSourceUrl(normalizedUrl));
    hyperlinkService.invalidate();
    await dispatch(refreshTranslations(true));
    return { ok: true, message: probe.message, url: normalizedUrl };
  };

  const handleRemoveSourceUrl = async (url: string) => {
    const normalizedUrl = url.trim();
    const affectedIds = safeAvailableTranslations
      .filter((translation) => {
        return translation.configuredSourceUrl === normalizedUrl || translation.source === normalizedUrl;
      })
      .map((translation) => translation.id)
      .filter((id) => id !== 'KJV');

    dispatch(removeSourceUrl(normalizedUrl));
    await hyperlinkService.purgeSource(normalizedUrl);

    if (affectedIds.length > 0) {
      await bibleService.purgeTranslations(affectedIds);
      dispatch(removeTranslationsByIds(affectedIds));
      dispatch(removeLoadedTranslations(affectedIds));
    }

    await dispatch(refreshTranslations(true));
  };

  const handleSubscriptionsApply = async (changes: SubscriptionChanges): Promise<SubscriptionApplySummary> => {
    const disconnected = new Set(changes.disconnectLibraryKeys);
    const isInKeptLibrary = (key: string) => {
      const parsed = parseSourceItemKey(key);
      return !parsed || !disconnected.has(parsed.libraryKey);
    };
    const nextDisabledSourceItems = changes.disabledSourceItems.filter(isInKeptLibrary);
    const previouslyDisabled = new Set(disabledSourceItems);
    const nowDisabled = new Set(nextDisabledSourceItems);
    const remainingSourceUrls = sourceUrls.filter((url) => !disconnected.has(url));
    const nextDisabledIds = computeDisabledTranslationIds(
      safeAvailableTranslations,
      remainingSourceUrls,
      nextDisabledSourceItems
    );
    const recordIdsToDrop = safeTranslationRecords
      .map((record) => record.id)
      .filter((id) => nextDisabledIds.has(id));

    dispatch(setDisabledSourceItems(nextDisabledSourceItems));
    dispatch(setResourceTagOverrides(changes.resourceTagOverrides));
    if (recordIdsToDrop.length > 0) {
      dispatch(dropTranslationRecords(recordIdsToDrop));
    }

    for (const url of disconnected) {
      await handleRemoveSourceUrl(url);
    }

    requestSubscriptionCatalog();
    return {
      librariesDisconnected: disconnected.size,
      itemsEnabled: disabledSourceItems.filter((key) => !nowDisabled.has(key) && isInKeptLibrary(key)).length,
      itemsDisabled: nextDisabledSourceItems.filter((key) => !previouslyDisabled.has(key)).length,
      translationsDropped: recordIdsToDrop.length,
    };
  };

  const subscriptionsBinding: SubscriptionsBinding = {
    sourceUrls,
    libraries: languageFilteredSubscriptionLibraries,
    isCatalogLoading: isSubscriptionCatalogLoading,
    translationRecords: safeTranslationRecords,
    disabledSourceItems,
    resourceTagOverrides,
    onRequestCatalog: requestSubscriptionCatalog,
    onAddSourceUrl: handleAddSourceUrl,
    onRequestGitHubAuth: handleRequestGitHubAuth,
    onSubscriptionsApply: handleSubscriptionsApply,
  };

  const openSettingsModal = async () => {
    const el = document.getElementById('settingsModal');
    if (!el) return;

    if (!modalRef.current) {
      const { default: Modal } = await import('bootstrap/js/dist/modal');
      modalRef.current = Modal.getOrCreateInstance(el);
    }

    modalRef.current?.show();
  };

  const closeSettingsModal = () => {
    modalRef.current?.hide();
  };

  const handleOpenHelp = () => {
    dispatch(openHelpTab());
    if (isPanelFloating) {
      setIsMobilePanelOpen(true);
    }
  };

  const handleSelectTab = (tabId: string) => {
    dispatch(setActiveTab({
      tabId,
      verseContext: resolveSelectedVerseContext(selectedBook, selectedChapter, selectedVerses),
    }));
  };

  const handleFloatPanel = () => {
    setIsPanelFloated(true);
    setIsMobilePanelOpen(true);
  };

  const handleDockPanel = () => {
    setIsPanelFloated(false);
    setIsMobilePanelOpen(false);
  };

  const panelWindowContentProps: React.ComponentProps<typeof PanelWindowShell>['sidePanelContentProps'] = {
    isDesktopLayout: true,
    isPanelDetached: true,
    isPanelFloating: false,
    isMobilePanelOpen: false,
    setIsMobilePanelOpen: () => {},
    goToReference: goToReferenceFromPanel,
    translationRecords: safeTranslationRecords,
    translationMetadataById,
    addableTranslations,
    onAddTranslation: (id) => dispatch(addTranslationRecord(id)),
    onRemoveTranslation: (id) => dispatch(removeTranslationRecord(id)),
    onToggleStar: (id) => dispatch(toggleStarTranslation(id)),
    onReorder: (fromIndex, toIndex) => dispatch(reorderTranslations({ fromIndex, toIndex })),
    onSelectTab: handleSelectTab,
    onToggleDetach: handleToggleDetachPanel,
    onFloatPanel: () => {},
    focusMainWindow,
  };

  const shareTarget = useMemo(() => {
    if (!selectedBook) {
      return null;
    }

    const book = currentBible?.books.find((entry) => entry.name === selectedBook);
    const chapter = book?.chapters.find((entry) => entry.chapter === selectedChapter);
    const fallbackVerse = chapter?.verses[0]?.verse ?? 1;
    const verse = selectedVerses[0] ?? fallbackVerse;
    return { book: selectedBook, chapter: selectedChapter, verse };
  }, [currentBible, selectedBook, selectedChapter, selectedVerses]);

  const shareButtonLabel = shareTarget
    ? `Share ${shareTarget.book} ${shareTarget.chapter}:${shareTarget.verse}`
    : 'Share verse';

  const handleShareCurrentVerse = useCallback(async () => {
    if (typeof window === 'undefined' || !shareTarget) {
      return;
    }

    const routeHash = buildHashRoute(shareTarget, true);

    const shareUrl = new URL(window.location.href);
    shareUrl.hash = routeHash;

    if (typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(shareUrl.toString());
      return;
    }

    const fallback = document.createElement('textarea');
    fallback.value = shareUrl.toString();
    fallback.setAttribute('readonly', 'true');
    fallback.style.position = 'fixed';
    fallback.style.opacity = '0';
    document.body.appendChild(fallback);
    fallback.select();
    document.execCommand('copy');
    document.body.removeChild(fallback);
  }, [shareTarget]);

  if (isPanelWindow) {
    return (
      <HelpTourRunner onOpenSettings={openSettingsModal} goToReference={goToReference}>
        <PanelWindowShell sidePanelContentProps={panelWindowContentProps} isDocked={isPanelWindowDocked} />
        <ToastPanel />
      </HelpTourRunner>
    );
  }

  return (
    <HelpTourRunner onOpenSettings={openSettingsModal} goToReference={goToReference}>
      <div className={`container app-shell ${useWideLayout ? 'app-shell-wide' : ''}`}>
        {!isDocumentWindow && (
          <>
            <AppHeader
              onOpenSettings={openSettingsModal}
              onOpenHelp={handleOpenHelp}
              accountControl={SanctumAccountSync
                ? <SanctumAccountSync subscriptions={subscriptionsBinding} />
                : <AccountControl subscriptions={subscriptionsBinding} />}
            />

            <SearchBar
              searchInputRef={searchInputRef}
              starredTranslationIds={starredTranslationIds}
              goToReference={goToReference}
              isPanelDetached={isPanelDetached}
              isPanelFloating={isPanelFloating}
              setIsMobilePanelOpen={setIsMobilePanelOpen}
              onSearchComplete={() => setIsMiniSearchVisible(false)}
            />
          </>
        )}

        {documentLinkNotice && (
          <div className="alert alert-warning alert-dismissible small py-2 mb-2" role="alert">
            {documentLinkNotice}
            <button
              type="button"
              className="btn-close py-2"
              aria-label="Dismiss"
              onClick={() => dispatch(setDocumentLinkNotice(null))}
            ></button>
          </div>
        )}

        <div
          ref={workspaceRef}
          className={[
            'workspace-layout',
            hasSidePanel ? 'has-side-panel' : '',
            isPanelDockedDesktop ? 'is-desktop' : '',
            isMobileLayout ? 'is-mobile' : '',
            isDesktopLayout && isPanelFloated ? 'is-panel-floated' : '',
          ].filter(Boolean).join(' ')}
        >
          <WorkspaceMainPane
            isDesktopLayout={isDesktopLayout}
            isPanelDetached={isPanelDetached}
            isPanelFloated={isPanelFloated}
            activeWorkspacePanel={activeWorkspacePanel}
            mainPanePercent={mainPanePercent}
            isMobileLayout={isMobileLayout}
            setIsMobilePanelOpen={setIsMobilePanelOpen}
            translationMetadataById={translationMetadataById}
            onCopySelectedVerses={handleCopySelectedVerses}
            onShareCurrentVerse={handleShareCurrentVerse}
            shareButtonLabel={shareButtonLabel}
            goToReference={goToReference}
            miniSearchFocusToken={miniSearchFocusToken}
            isMiniSearchVisible={isMiniSearchVisible}
            setIsMiniSearchVisible={setIsMiniSearchVisible}
            mainPaneRef={mainPaneRef}
            resourceHiddenTags={resourceHiddenTags}
          />

          {isPanelDockedDesktop && !isPanelDetached && activeWorkspacePanel && (
            <WorkspaceDivider
              onPointerDown={handleDividerPointerDown}
              onKeyDown={handleDividerKeyDown}
            />
          )}

          {hasSidePanel && (
            <WorkspaceSidePanel
              isMobileLayout={isMobileLayout}
              isDesktopLayout={isDesktopLayout}
              isPanelDetached={isPanelDetached}
              isPanelFloated={isPanelFloated}
              isMobilePanelOpen={isMobilePanelOpen}
              setIsMobilePanelOpen={setIsMobilePanelOpen}
              sidePanePercent={sidePanePercent}
              goToReference={goToReferenceFromPanel}
              translationRecords={safeTranslationRecords}
              translationMetadataById={translationMetadataById}
              addableTranslations={addableTranslations}
              onAddTranslation={(id) => dispatch(addTranslationRecord(id))}
              onRemoveTranslation={(id) => dispatch(removeTranslationRecord(id))}
              onToggleStar={(id) => dispatch(toggleStarTranslation(id))}
              onReorder={(fromIndex, toIndex) => dispatch(reorderTranslations({ fromIndex, toIndex }))}
              onSelectTab={handleSelectTab}
              onToggleDetach={handleToggleDetachPanel}
              onFloatPanel={handleFloatPanel}
              onDockPanel={handleDockPanel}
              focusMainWindow={focusMainWindow}
            />
          )}

          {isPanelFloating && hasSidePanel && isMobilePanelOpen && (
            <button
              type="button"
              className="mobile-panel-backdrop"
              aria-label="Close side panel"
              onClick={() => setIsMobilePanelOpen(false)}
            />
          )}
        </div>

        <LoadingStatus isLoading={isLoading} error={error} />

        <SettingsModal
          theme={theme}
          handleThemeToggle={handleThemeToggle}
          translatorItalics={translatorItalics}
          handleTranslatorItalicsToggle={handleTranslatorItalicsToggle}
          translatorParagraphMarks={translatorParagraphMarks}
          handleTranslatorParagraphMarksToggle={handleTranslatorParagraphMarksToggle}
          selectedLanguages={safeSelectedLanguages}
          handleLanguagesChange={handleLanguagesChange}
          languageOptions={languageOptions}
          getLanguageDisplayName={getLoadedLanguageDisplayName}
          closeSettingsModal={closeSettingsModal}
          settingsFooter={SanctumSettingsFooter ? <SanctumSettingsFooter /> : null}
        />

        <GitHubAuthPromptModal
          isOpen={isGitHubAuthPromptOpen}
          contextMessage={gitHubAuthPromptContext ?? undefined}
          errorMessage={gitHubAuthPromptError}
          isLaunching={isLaunchingGitHubAuth}
          onClose={closeGitHubAuthPrompt}
          onContinue={handleContinueGitHubAuth}
        />
      </div>

      <ToastPanel />
    </HelpTourRunner>
  );
}

export default App;