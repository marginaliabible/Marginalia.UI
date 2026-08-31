import AppHeader from './components/AppHeader';
import SearchBar from './components/SearchBar';
import WorkspaceMainPane from './components/WorkspaceMainPane';
import WorkspaceDivider from './components/WorkspaceDivider';
import WorkspaceSidePanel from './components/WorkspaceSidePanel';
import DetachedPanelPortal from './components/DetachedPanelPortal';
import LoadingStatus from './components/LoadingStatus';
import SettingsModal from './components/SettingsModal';
import GitHubAuthPromptModal from './components/GitHubAuthPromptModal';
import AccountControl from './components/AccountControl';
import { useCallback, useEffect, useMemo, useRef, useState, ChangeEvent } from 'react';
import { useAppDispatch, useAppSelector } from './store/hooks';
import {
  loadTranslation,
  refreshTranslations,
  createDeferredSearchTab,
  setActiveTab,
  closeTab,
  updateActiveVerseTabContext,
  setCurrentBibleFromId,
  removeLoadedTranslations,
} from './store/slices/bibleSlice';
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
  setReady,
  restoreState,
  addTranslationRecord,
  removeTranslationRecord,
  toggleStarTranslation,
  reorderTranslations,
} from './store/slices/uiSlice';
import {
  bibleService,
  normalizeSourceUrlInput,
  type SourceProbeResult,
  type SourceArtifactInventory,
  type SourceLibraryRecord,
  type SourceArtifactSummary,
} from './services/bibleService';
import { hasValidGitHubAuthSession } from './services/githubPrivateSourceService';
import type { QuickJumpTarget } from './models/bible';
import {
  type WorkspacePanelKey,
  normalizeLanguageSelection,
  normalizeLanguages,
  detectPreferredLanguages,
  getLanguageDisplayName,
  applyTheme,
  buildHashRoute,
  parseSearchFromHash,
  detectPreferredTheme,
  scrollToVerse,
} from './App';
import { useDesktopLayout } from './hooks/useDesktopLayout';
import { useWorkspaceSplit } from './hooks/useWorkspaceSplit';
import { usePopupPanel } from './hooks/usePopupPanel';
import { useMobilePanelEffects } from './hooks/useMobilePanelEffects';
import { useHashRouteSync } from './hooks/useHashRouteSync';
import { beginGitHubAuthorization, initializeGitHubAuthFlow } from './services/githubAuthFlowService';
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
  const [miniSearchFocusToken, setMiniSearchFocusToken] = useState(0);
  const [isMiniSearchVisible, setIsMiniSearchVisible] = useState(false);
  const [sourceArtifactSummary, setSourceArtifactSummary] = useState<SourceArtifactSummary>({
    translation: 0,
    translationLibrary: 0,
    resourceLibrary: 0,
  });
  const [sourceLibraries, setSourceLibraries] = useState<SourceLibraryRecord[]>([]);
  const [sourceArtifactInventory, setSourceArtifactInventory] = useState<SourceArtifactInventory | null>(null);
  const [isSourceDiagnosticsLoading, setIsSourceDiagnosticsLoading] = useState(false);
  const [isGitHubAuthPromptOpen, setIsGitHubAuthPromptOpen] = useState(false);
  const [gitHubAuthPromptContext, setGitHubAuthPromptContext] = useState<string | null>(null);
  const [gitHubAuthPromptError, setGitHubAuthPromptError] = useState<string | null>(null);
  const [isLaunchingGitHubAuth, setIsLaunchingGitHubAuth] = useState(false);

  // Redux state
  const {
    availableTranslations,
    currentBible,
    isLoading,
    error,
    tabs,
    activeTabId,
    isPanelDetached,
    detachedPanelName,
  } = useAppSelector((state) => state.bible);

  const {
    selectedTranslationId,
    selectedTranslationIds,
    translationRecords,
    selectedBook,
    selectedChapter,
    selectedVerses,
    selectedLanguages,
    sourceUrls,
    resourceHiddenTags,
    pdfViewer,
    theme,
    ready,
    userId,
  } = useAppSelector((state) => state.ui);

  const safeAvailableTranslations = Array.isArray(availableTranslations) ? availableTranslations : [];
  const safeTranslationRecords = Array.isArray(translationRecords) ? translationRecords : [];
  const safeSelectedTranslationIds = Array.isArray(selectedTranslationIds) ? selectedTranslationIds : [];
  const safeSelectedLanguages = Array.isArray(selectedLanguages) ? selectedLanguages : [];

  const isDesktopLayout = useDesktopLayout();
  const isMobileLayout = !isDesktopLayout;

  const activeWorkspacePanel: WorkspacePanelKey | null = tabs.length > 0 ? 'search' : null;

  const { popupContainer, focusDetachedPanel, focusMainWindow, handleToggleDetachPanel } = usePopupPanel({
    dispatch,
    theme,
    isPanelDetached,
    detachedPanelName,
  });

  const { mainPanePercent, sidePanePercent, handleDividerPointerDown, handleDividerKeyDown } =
    useWorkspaceSplit({ workspaceRef, isDesktopLayout, activeWorkspacePanel });

  useMobilePanelEffects({
    isMobileLayout,
    isMobilePanelOpen,
    isDesktopLayout,
    isPanelDetached,
    activeWorkspacePanel,
    setIsMobilePanelOpen,
  });

  useEffect(() => {
    return initializeGitHubAuthFlow();
  }, []);

  const handleCopySelectedVerses = useCallback(async () => {
    if (!currentBible || !selectedBook) {
      return;
    }

    const book = currentBible.books.find((entry) => entry.name === selectedBook);
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

    const normalizedVerses = Array.from(new Set(chosenVerses)).sort((left, right) => left - right);
    const verseTexts = normalizedVerses
      .map((verseNumber) => ({
        verseNumber,
        text: chapter.verses.find((verse) => verse.verse === verseNumber)?.text ?? '',
      }))
      .filter((entry) => entry.text.length > 0);

    if (verseTexts.length === 0) {
      return;
    }

    const compressedReferenceParts: string[] = [];
    let rangeStart = normalizedVerses[0];
    let previousVerse = normalizedVerses[0];

    for (let index = 1; index < normalizedVerses.length; index += 1) {
      const verseNumber = normalizedVerses[index];
      if (verseNumber === previousVerse + 1) {
        previousVerse = verseNumber;
        continue;
      }

      const rangeLength = previousVerse - rangeStart + 1;
      compressedReferenceParts.push(
        rangeLength > 2 ? `${rangeStart}-${previousVerse}` : normalizedVerses.slice(normalizedVerses.indexOf(rangeStart), normalizedVerses.indexOf(previousVerse) + 1).join(', ')
      );

      rangeStart = verseNumber;
      previousVerse = verseNumber;
    }

    const finalRangeLength = previousVerse - rangeStart + 1;
    compressedReferenceParts.push(
      finalRangeLength > 2 ? `${rangeStart}-${previousVerse}` : normalizedVerses.slice(normalizedVerses.indexOf(rangeStart), normalizedVerses.indexOf(previousVerse) + 1).join(', ')
    );

    const referenceSuffix = compressedReferenceParts.join(', ');

    const header = `${selectedBook} ${selectedChapter}:${referenceSuffix}`;
    const body = verseTexts.length === 1
      ? verseTexts[0].text
      : verseTexts.map((entry) => `${entry.verseNumber}\u00A0 ${entry.text}`).join('\n');
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
      ? `${escapeHtml(verseTexts[0].text)}`
      : verseTexts
        .map((entry) => (
          `<span style="color:#808080;">${entry.verseNumber}</span> ${escapeHtml(entry.text)}`
        ))
        .join('<br/>');
    const copyHtml = `<div style="font-family:Calibri, Arial, sans-serif; font-size:11pt;">${referenceHtml}${bodyHtml}</div>`;

    const copyViaClipboardEvent = (): boolean => {
      const listener = (event: ClipboardEvent) => {
        event.preventDefault();
        event.clipboardData?.setData('text/plain', copyText);
        event.clipboardData?.setData('text/html', copyHtml);
      };

      document.addEventListener('copy', listener, { once: true });
      const didCopy = document.execCommand('copy');
      document.removeEventListener('copy', listener);
      return didCopy;
    };

    try {
      if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard.write === 'function') {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([copyText], { type: 'text/plain' }),
            'text/html': new Blob([copyHtml], { type: 'text/html' }),
          }),
        ]);
        return;
      }
    } catch {
      // Continue to legacy fallback paths below.
    }

    if (copyViaClipboardEvent()) {
      return;
    }

    if (typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(copyText);
      return;
    }

    const fallback = document.createElement('textarea');
    fallback.value = copyText;
    fallback.setAttribute('readonly', 'true');
    fallback.style.position = 'fixed';
    fallback.style.opacity = '0';
    document.body.appendChild(fallback);
    fallback.select();
    document.execCommand('copy');
    document.body.removeChild(fallback);
  }, [currentBible, selectedBook, selectedChapter, selectedVerses]);

  // Ctrl/Cmd+K to focus search input; Ctrl+C to copy selected verses from the focused main pane.
  useEffect(() => {
    const handleShortcut = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const eventWindow = (e.view as Window | null) ?? window;
        if (eventWindow !== window && !window.closed) {
          window.focus();
        }

        const searchInput = searchInputRef.current;
        const rect = searchInput?.getBoundingClientRect();
        const isTopSearchVisible = Boolean(
          rect
          && rect.width > 0
          && rect.height > 0
          && rect.bottom > 0
          && rect.top < eventWindow.innerHeight
        );

        if (isTopSearchVisible) {
          searchInput?.focus();
          searchInput?.select();
        } else {
          setMiniSearchFocusToken((token) => token + 1);
        }
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
    const detachedWindow = popupContainer?.ownerDocument.defaultView;
    if (detachedWindow && detachedWindow !== window) {
      detachedWindow.addEventListener('keydown', handleShortcut, true);
    }

    return () => {
      window.removeEventListener('keydown', handleShortcut, true);
      if (detachedWindow && detachedWindow !== window) {
        detachedWindow.removeEventListener('keydown', handleShortcut, true);
      }
    };
  }, [handleCopySelectedVerses, pdfViewer.isOpen, popupContainer]);

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
        selectedLanguages: finalLanguages,
        sourceUrls: Array.isArray(savedState?.sourceUrls) ? savedState.sourceUrls : [],
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
      languages: safeSelectedLanguages,
      sourceUrls,
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
    safeSelectedLanguages,
    sourceUrls,
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
    ready,
    selectedBook,
    selectedChapter,
    selectedTranslationId,
    selectedVerses,
  });

  const translationMetadataById = useMemo(
    () =>
      new Map(safeAvailableTranslations.map((translation) => [translation.id, translation] as const)),
    [safeAvailableTranslations]
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
        const nameA = getLanguageDisplayName(a.code);
        const nameB = getLanguageDisplayName(b.code);
        return nameA.localeCompare(nameB);
      });
  }, [safeAvailableTranslations]);

  const filteredTranslations = useMemo(() => {
    if (safeSelectedLanguages.length === 0) {
      return safeAvailableTranslations;
    }
    const normalizedCodes = new Set(normalizeLanguages(safeSelectedLanguages));
    const matches = safeAvailableTranslations.filter((t) => {
      const langs = Array.isArray(t.language) ? t.language : (t.language ? [t.language] : []);
      if (langs.length === 0) {
        // Keep source-provided translations discoverable even when language metadata is missing.
        return true;
      }
      return langs.some((l) => normalizedCodes.has(l));
    });
    return matches.length === 0 ? safeAvailableTranslations : matches;
  }, [safeAvailableTranslations, safeSelectedLanguages]);

  // Ensure selectedTranslationId is valid; fallback to first starred or KJV
  useEffect(() => {
    const recordIds = new Set(safeTranslationRecords.map((r) => r.id));
    if (!recordIds.has(selectedTranslationId)) {
      const starredIds = safeTranslationRecords.filter((r) => r.starred).map((r) => r.id);
      const validId = starredIds[0] || safeTranslationRecords[0]?.id || 'KJV';
      dispatch(setSelectedTranslationId(validId));
    }
  }, [safeTranslationRecords, selectedTranslationId, dispatch]);

  const addableTranslations = useMemo(() => {
    const selectedIds = new Set(safeTranslationRecords.map((record) => record.id));
    return filteredTranslations
      .filter((translation) => !selectedIds.has(translation.id))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [filteredTranslations, safeTranslationRecords]);

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

  const useWideLayout = starredTranslationIds.length + (activeTabId ? 1 : 0) > 3;
  const hasSidePanel = !isPanelDetached && Boolean(activeWorkspacePanel);

  const goToReference = async (target: QuickJumpTarget, translationId?: string) => {
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

      const activeTab = tabs.find((tab) => tab.id === activeTabId);
      if (activeTab && (activeTab.type === 'translations' || activeTab.type === 'resources')) {
        dispatch(updateActiveVerseTabContext({
          book: target.book,
          chapter: target.chapter,
          verse: target.verse,
        }));
      }
    } else {
      dispatch(clearVerseSelection());
    }

    mainPaneRef.current?.focus({ preventScroll: true });

    await scrollToVerse(target);
  };

  const handleThemeToggle = (e: ChangeEvent<HTMLInputElement>) => {
    dispatch(setTheme(e.target.checked ? 'dark' : 'light'));
  };

  const handleLanguagesChange = (selected: string[]) => {
    dispatch(setSelectedLanguages(normalizeLanguageSelection(selected)));
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

  const refreshSourceArtifactSummary = useCallback(async (urls?: string[]) => {
    const status = await bibleService.getSourceArtifactStatus(urls ?? sourceUrls);
    setSourceArtifactSummary(status.summary);
    setSourceLibraries(status.libraries);
  }, [sourceUrls]);

  const refreshSelectedSources = useCallback(async () => {
    await dispatch(refreshTranslations(true));
    await dispatch(loadTranslation(selectedTranslationId));
    dispatch(setCurrentBibleFromId(selectedTranslationId));
    setSourceArtifactInventory(null);
    await refreshSourceArtifactSummary();
  }, [dispatch, refreshSourceArtifactSummary, selectedTranslationId]);

  const loadSourceArtifactInventory = useCallback(async (urls?: string[]) => {
    if (isSourceDiagnosticsLoading || sourceArtifactInventory) {
      return;
    }

    setIsSourceDiagnosticsLoading(true);
    try {
      const inventory = await bibleService.getSourceArtifactInventory(urls ?? sourceUrls);
      setSourceArtifactInventory(inventory);
    } finally {
      setIsSourceDiagnosticsLoading(false);
    }
  }, [isSourceDiagnosticsLoading, sourceArtifactInventory, sourceUrls]);

  const handleAddSourceUrl = async (url: string): Promise<{ ok: boolean; message: string; suggestGitHubAuth?: boolean }> => {
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

    const nextSourceUrls = Array.from(new Set([...sourceUrls, normalizedUrl])).filter((entry) => entry.length > 0);

    dispatch(addSourceUrl(normalizedUrl));
    await dispatch(refreshTranslations(true));
    setSourceArtifactInventory(null);
    await refreshSourceArtifactSummary(nextSourceUrls);
    return { ok: true, message: probe.message };
  };

  const handleRemoveSourceUrl = async (url: string) => {
    const normalizedUrl = url.trim();
    const nextSourceUrls = sourceUrls.filter((entry) => entry.trim() !== normalizedUrl);
    const affectedIds = safeAvailableTranslations
      .filter((translation) => {
        return translation.configuredSourceUrl === normalizedUrl || translation.source === normalizedUrl;
      })
      .map((translation) => translation.id)
      .filter((id) => id !== 'KJV');

    dispatch(removeSourceUrl(normalizedUrl));

    if (affectedIds.length > 0) {
      await bibleService.purgeTranslations(affectedIds);
      dispatch(removeTranslationsByIds(affectedIds));
      dispatch(removeLoadedTranslations(affectedIds));
    }

    await dispatch(refreshTranslations(true));
    setSourceArtifactInventory(null);
    await refreshSourceArtifactSummary(nextSourceUrls);
  };

  const openSettingsModal = async () => {
    await refreshSourceArtifactSummary();

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

  const handleSelectTab = (tabId: string) => {
    dispatch(setActiveTab(tabId));
    if (isPanelDetached) {
      focusDetachedPanel();
    }
  };

  const handleCloseTab = (tabId: string) => {
    dispatch(closeTab(tabId));
  };

  const detachedSidePanelContentProps: React.ComponentProps<typeof DetachedPanelPortal>['sidePanelContentProps'] = {
    isMobileLayout: false,
    isDesktopLayout: true,
    isPanelDetached,
    isMobilePanelOpen: false,
    setIsMobilePanelOpen: () => {},
    goToReference,
    translationRecords: safeTranslationRecords,
    translationMetadataById,
    addableTranslations,
    onAddTranslation: (id) => dispatch(addTranslationRecord(id)),
    onRemoveTranslation: (id) => dispatch(removeTranslationRecord(id)),
    onToggleStar: (id) => dispatch(toggleStarTranslation(id)),
    onReorder: (fromIndex, toIndex) => dispatch(reorderTranslations({ fromIndex, toIndex })),
    onSelectTab: handleSelectTab,
    onCloseTab: handleCloseTab,
    onToggleDetach: handleToggleDetachPanel,
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

  return (
    <>
      <div className={`container app-shell ${useWideLayout ? 'app-shell-wide' : ''}`}>
        <AppHeader
          onOpenSettings={openSettingsModal}
          accountControl={<AccountControl />}
        />

        <SearchBar
          searchInputRef={searchInputRef}
          starredTranslationIds={starredTranslationIds}
          goToReference={goToReference}
          isPanelDetached={isPanelDetached}
          focusDetachedPanel={focusDetachedPanel}
          isDesktopLayout={isDesktopLayout}
          setIsMobilePanelOpen={setIsMobilePanelOpen}
          onSearchComplete={() => setIsMiniSearchVisible(false)}
        />

        <div
          ref={workspaceRef}
          className={`workspace-layout ${hasSidePanel ? 'has-side-panel' : ''} ${
            isDesktopLayout ? 'is-desktop' : 'is-mobile'
          }`}
        >
          <WorkspaceMainPane
            isDesktopLayout={isDesktopLayout}
            isPanelDetached={isPanelDetached}
            activeWorkspacePanel={activeWorkspacePanel}
            mainPanePercent={mainPanePercent}
            isMobileLayout={isMobileLayout}
            setIsMobilePanelOpen={setIsMobilePanelOpen}
            translationMetadataById={translationMetadataById}
            onCopySelectedVerses={handleCopySelectedVerses}
            onShareCurrentVerse={handleShareCurrentVerse}
            shareButtonLabel={shareButtonLabel}
            goToReference={goToReference}
            focusDetachedPanel={focusDetachedPanel}
            miniSearchFocusToken={miniSearchFocusToken}
            isMiniSearchVisible={isMiniSearchVisible}
            setIsMiniSearchVisible={setIsMiniSearchVisible}
            mainPaneRef={mainPaneRef}
            resourceHiddenTags={resourceHiddenTags}
          />

          {isDesktopLayout && !isPanelDetached && activeWorkspacePanel && (
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
              isMobilePanelOpen={isMobilePanelOpen}
              setIsMobilePanelOpen={setIsMobilePanelOpen}
              sidePanePercent={sidePanePercent}
              goToReference={goToReference}
              translationRecords={safeTranslationRecords}
              translationMetadataById={translationMetadataById}
              addableTranslations={addableTranslations}
              onAddTranslation={(id) => dispatch(addTranslationRecord(id))}
              onRemoveTranslation={(id) => dispatch(removeTranslationRecord(id))}
              onToggleStar={(id) => dispatch(toggleStarTranslation(id))}
              onReorder={(fromIndex, toIndex) => dispatch(reorderTranslations({ fromIndex, toIndex }))}
              onSelectTab={handleSelectTab}
              onCloseTab={handleCloseTab}
              onToggleDetach={handleToggleDetachPanel}
              focusMainWindow={focusMainWindow}
            />
          )}

          {isMobileLayout && hasSidePanel && isMobilePanelOpen && (
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
          selectedLanguages={safeSelectedLanguages}
          handleLanguagesChange={handleLanguagesChange}
          languageOptions={languageOptions}
          getLanguageDisplayName={getLanguageDisplayName}
          sourceUrls={sourceUrls}
          sourceArtifactSummary={sourceArtifactSummary}
          sourceLibraries={sourceLibraries}
          sourceArtifactInventory={sourceArtifactInventory}
          onLoadSourceDiagnostics={loadSourceArtifactInventory}
          onRefreshSources={refreshSelectedSources}
          onRequestGitHubAuth={handleRequestGitHubAuth}
          isSourceDiagnosticsLoading={isSourceDiagnosticsLoading}
          onAddSourceUrl={handleAddSourceUrl}
          onRemoveSourceUrl={handleRemoveSourceUrl}
          closeSettingsModal={closeSettingsModal}
          userId={userId}
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

      <DetachedPanelPortal
        isPanelDetached={isPanelDetached}
        hasActiveWorkspacePanel={Boolean(activeWorkspacePanel)}
        popupContainer={popupContainer}
        pdfViewerIsOpen={pdfViewer.isOpen}
        sidePanelContentProps={detachedSidePanelContentProps}
      />
    </>
  );
}

export default App;