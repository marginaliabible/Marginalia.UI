import VerseDisplay from './components/VerseDisplay';
import SearchResults from './components/SearchResults';
import PanelTabs from './components/PanelTabs';
import SearchActionDropdown from './components/SearchActionDropdown';
import SettingsModal from './components/SettingsModal';
import TranslationsPanel from './components/TranslationsPanel';
import { useEffect, useMemo, useRef, useState, FormEvent, ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { useAppDispatch, useAppSelector } from './store/hooks';
import {
  loadTranslation,
  loadTranslations,
  refreshTranslations,
  runSearch,
  runSearchInNewTab,
  runSearchInTab,
  setActiveTab,
  closeTab,
  clearSearch,
  setPanelDetached,
  setCurrentBibleFromId,
  openTranslationsTab
} from './store/slices/bibleSlice';
import {
  setSelectedTranslationId,
  setSelectedTranslationIds,
  setSelectedBook,
  setSelectedChapter,
  setFocusVerse,
  setSearchTerm,
  setSelectedLanguages,
  setTheme,
  setReady,
  restoreState,
  addTranslationRecord,
  removeTranslationRecord,
  toggleStarTranslation,
  reorderTranslations
} from './store/slices/uiSlice';
import { parseQuickJump } from './utils/reference-parser';
import { bibleService } from './services/bibleService';
import { searchIndexService } from './services/searchIndexService';
import type { BibleChapter, QuickJumpTarget } from './models/bible';
import {
  type WorkspacePanelKey,
  DESKTOP_BREAKPOINT,
  normalizeLanguageSelection,
  normalizeLanguages,
  detectPreferredLanguages,
  verseDomId,
  getLanguageDisplayName,
  applyTheme,
  detectPreferredTheme,
  scrollToVerse
} from './App';
import './App.scss';

function App() {
  const dispatch = useAppDispatch();
  const modalRef = useRef<any>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const popupWindowRef = useRef<Window | null>(null);
  const popupCleanupRef = useRef<(() => void) | null>(null);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const [isQuickJumpPreviewHidden, setIsQuickJumpPreviewHidden] = useState(true);
  const [isSearchActionDropdownOpen, setIsSearchActionDropdownOpen] = useState(false);
  const [isSearchActionDropdownSuppressed, setIsSearchActionDropdownSuppressed] = useState(false);
  const [searchActionIndex, setSearchActionIndex] = useState(0);
  const [popupContainer, setPopupContainer] = useState<HTMLElement | null>(null);
  const [mainPaneRatio, setMainPaneRatio] = useState(2 / 3);
  const [chaptersByTranslation, setChaptersByTranslation] = useState<Record<string, BibleChapter | null>>({});
  const [isDesktopLayout, setIsDesktopLayout] = useState(
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(DESKTOP_BREAKPOINT).matches
      : true
  );

  // Redux state
  const {
    availableTranslations,
    currentBible,
    isLoading,
    error,
    tabs,
    activeTabId,
    isPanelDetached,
    detachedPanelName
  } = useAppSelector((state) => state.bible);

  const {
    selectedTranslationId,
    selectedTranslationIds,
    translationRecords,
    selectedBook,
    selectedChapter,
    focusVerse,
    searchTerm,
    selectedLanguages,
    theme,
    ready
  } = useAppSelector((state) => state.ui);

  // Ctrl+F to focus search input
  useEffect(() => {
    const handleCtrlF = (e: KeyboardEvent) => {
      if (e.key === 'f' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener('keydown', handleCtrlF);
    return () => window.removeEventListener('keydown', handleCtrlF);
  }, []);

  useEffect(() => {
    const popupName = sessionStorage.getItem('gitbible-popout-name');
    if (!popupName) {
      return;
    }

    openOrReconnectPopup(false);
  }, []);

  useEffect(() => {
    if (!isPanelDetached) {
      return;
    }

    const popup = popupWindowRef.current;
    if (!popup || popup.closed) {
      dispatch(setPanelDetached({ detached: false, panelName: null }));
      setPopupContainer(null);
      sessionStorage.removeItem('gitbible-popout-name');
    }
  }, [isPanelDetached, dispatch]);

  // Initialize app
  useEffect(() => {
    const initApp = async () => {
      const savedState = bibleService.readState();
      
      // Use translationRecords if available, otherwise derive from legacy fields
      let translationRecords = savedState.translationRecords || [];
      if (translationRecords.length === 0) {
        const restoredTranslationIds = Array.from(
          new Set(
            (savedState.lastTranslationIds && savedState.lastTranslationIds.length > 0
              ? savedState.lastTranslationIds
              : [savedState.lastTranslationId || 'KJV'])
              .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
              .map((id) => id.trim())
          )
        );
        const resolvedTranslationIds = restoredTranslationIds.length > 0 ? restoredTranslationIds : ['KJV'];
        translationRecords = resolvedTranslationIds.map((id) => ({
          id,
          starred: id === (savedState.lastTranslationId || resolvedTranslationIds[0])
        }));
      }

      // Extract IDs from translationRecords and legacy selectedTranslationIds
      const resolvedTranslationIds = translationRecords.map((r) => r.id);
      const starredIds = translationRecords.filter((r) => r.starred).map((r) => r.id);
      const activeTranslationId = starredIds[0] || resolvedTranslationIds[0] || 'KJV';
      
      // Apply theme
      applyTheme(savedState.theme ?? detectPreferredTheme());
      
      // Refresh translations
      await dispatch(refreshTranslations(false));

      // Restore state
      const resolvedLanguages = savedState.languages && savedState.languages.length > 0
        ? normalizeLanguageSelection(savedState.languages)
        : detectPreferredLanguages();
      const hasSavedBookPosition = Boolean(savedState.lastBook);
      dispatch(restoreState({
        selectedTranslationId: activeTranslationId,
        selectedTranslationIds: resolvedTranslationIds,
        translationRecords,
        selectedBook: hasSavedBookPosition ? savedState.lastBook ?? null : 'John',
        selectedChapter: hasSavedBookPosition ? savedState.lastChapter || 1 : 10,
        focusVerse: hasSavedBookPosition ? savedState.lastVerse || null : 10,
        searchTerm: savedState.lastSearch || '',
        selectedLanguages: resolvedLanguages,
        theme: savedState.theme || detectPreferredTheme(),
        ready: true
      }));

      await dispatch(loadTranslation(activeTranslationId));
      dispatch(setCurrentBibleFromId(activeTranslationId));

      dispatch(setReady(true));
    };

    initApp();
  }, [dispatch]);

  // Persist state on changes
  useEffect(() => {
    if (!ready) return;

    bibleService.persistState({
      lastTranslationId: selectedTranslationId,
      lastTranslationIds: selectedTranslationIds,
      translationRecords,
      lastBook: selectedBook || undefined,
      lastChapter: selectedBook ? selectedChapter : undefined,
      lastVerse: focusVerse || undefined,
      lastSearch: searchTerm.trim() || undefined,
      theme,
      languages: selectedLanguages
    });
  }, [
    selectedTranslationId,
    selectedTranslationIds,
    translationRecords,
    selectedBook,
    selectedChapter,
    focusVerse,
    searchTerm,
    theme,
    selectedLanguages,
    ready
  ]);

  useEffect(() => {
    dispatch(setCurrentBibleFromId(selectedTranslationId));
  }, [dispatch, selectedTranslationId]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia(DESKTOP_BREAKPOINT);
    const updateLayout = (event?: MediaQueryListEvent) => {
      setIsDesktopLayout(event ? event.matches : mediaQuery.matches);
    };

    updateLayout();
    mediaQuery.addEventListener('change', updateLayout);
    return () => mediaQuery.removeEventListener('change', updateLayout);
  }, []);

  // Apply theme changes
  useEffect(() => {
    applyTheme(theme);

    const popup = popupWindowRef.current;
    if (popup && !popup.closed) {
      popup.document.documentElement.setAttribute('data-theme', theme);
      popup.document.documentElement.setAttribute('data-bs-theme', theme);
    }
  }, [theme]);

  useEffect(() => {
    return () => {
      popupCleanupRef.current?.();
    };
  }, []);

  const translationMetadataById = useMemo(
    () =>
      new Map(availableTranslations.map((translation) => [translation.id, translation] as const)),
    [availableTranslations]
  );

  const languageOptions = useMemo(() => {
    const counts = new Map<string, number>();

    for (const translation of availableTranslations) {
      const codes = normalizeLanguages(translation.language);
      for (const code of codes) {
        counts.set(code, (counts.get(code) ?? 0) + 1);
      }
    }

    return Array.from(counts.entries())
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => {
        const nameA = getLanguageDisplayName(a.code);
        const nameB = getLanguageDisplayName(b.code);
        return nameA.localeCompare(nameB);
      });
  }, [availableTranslations]);

  const filteredTranslations = useMemo(() => {
    const selected = normalizeLanguageSelection(selectedLanguages);
    if (selected.length === 0) {
      return availableTranslations;
    }

    const selectionSet = new Set(selected);
    const matches = availableTranslations.filter((translation) => {
      const codes = normalizeLanguages(translation.language);
      if (codes.length === 0) {
        return true;
      }
      return codes.some((code) => selectionSet.has(code));
    });

    return matches.length === 0 ? availableTranslations : matches;
  }, [availableTranslations, selectedLanguages]);

  // Ensure selectedTranslationId is valid; fallback to first starred or KJV
  useEffect(() => {
    const recordIds = new Set(translationRecords.map((r) => r.id));
    if (!recordIds.has(selectedTranslationId)) {
      const starredIds = translationRecords.filter((r) => r.starred).map((r) => r.id);
      const validId = starredIds[0] || translationRecords[0]?.id || 'KJV';
      dispatch(setSelectedTranslationId(validId));
    }
  }, [translationRecords, selectedTranslationId, dispatch]);

  const addableTranslations = useMemo(() => {
    const selectedIds = new Set(translationRecords.map((record) => record.id));
    return filteredTranslations
      .filter((translation) => !selectedIds.has(translation.id))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [filteredTranslations, translationRecords]);

  // Compute starred translation IDs from translationRecords
  const starredTranslationIds = useMemo(() => {
    return translationRecords.filter((r) => r.starred).map((r) => r.id);
  }, [translationRecords]);

  useEffect(() => {
    const fullTranslationWorkingSetSize = new Set([
      ...starredTranslationIds,
      selectedTranslationId,
    ]).size;

    bibleService.setFullTranslationCacheLimit(fullTranslationWorkingSetSize);
    searchIndexService.setIndexCacheLimit(Math.max(1, starredTranslationIds.length));
  }, [selectedTranslationId, starredTranslationIds]);

  useEffect(() => {
    let cancelled = false;

    const loadVisibleChapters = async () => {
      if (!selectedBook || starredTranslationIds.length === 0) {
        if (!cancelled) {
          setChaptersByTranslation({});
        }
        return;
      }

      const entries = await Promise.all(
        starredTranslationIds.map(async (translationId) => {
          const chapter = await bibleService.loadChapter(translationId, selectedBook, selectedChapter);
          return [translationId, chapter] as const;
        })
      );

      if (!cancelled) {
        setChaptersByTranslation(Object.fromEntries(entries));
      }
    };

    void loadVisibleChapters();
    return () => {
      cancelled = true;
    };
  }, [selectedBook, selectedChapter, starredTranslationIds]);

  const translationLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const translationId of starredTranslationIds) {
      const translation = translationMetadataById.get(translationId);
      labels[translationId] = translation?.label ?? translationId;
    }
    return labels;
  }, [starredTranslationIds, translationMetadataById]);

  const quickJumpTarget = useMemo<QuickJumpTarget | null>(() => {
    if (!ready || !currentBible || !searchTerm) {
      return null;
    }
    return parseQuickJump(searchTerm, currentBible.books);
  }, [ready, currentBible, searchTerm]);

  const quickJumpPreview = useMemo(() => {
    if (!currentBible || !quickJumpTarget) {
      return null;
    }

    const book = currentBible.books.find((b) => b.name === quickJumpTarget.book);
    const chapter = book?.chapters.find((c) => c.chapter === quickJumpTarget.chapter);
    const verseText = quickJumpTarget.verse
      ? chapter?.verses.find((v) => v.verse === quickJumpTarget.verse)?.text
      : undefined;

    return {
      ...quickJumpTarget,
      text: verseText
    };
  }, [currentBible, quickJumpTarget]);

  const selectedBookEntry = useMemo(() => {
    if (!currentBible || !selectedBook) {
      return null;
    }

    return currentBible.books.find((book) => book.name === selectedBook) ?? null;
  }, [currentBible, selectedBook]);

  const activeTab = useMemo(() => {
    if (!activeTabId) {
      return null;
    }
    return tabs.find((tab) => tab.id === activeTabId) ?? null;
  }, [tabs, activeTabId]);

  // Keep selectedTranslationIds in sync with translationRecords for backward compatibility
  useEffect(() => {
    const recordIds = translationRecords.map((r) => r.id);
    if (JSON.stringify(selectedTranslationIds) !== JSON.stringify(recordIds)) {
      dispatch(setSelectedTranslationIds(recordIds));
    }
  }, [translationRecords, dispatch, selectedTranslationIds]);

  const activeWorkspacePanel: WorkspacePanelKey | null = activeTab ? 'search' : null;
  const hasMultiTranslations = starredTranslationIds.length > 1;
  const horizontalElementLength = starredTranslationIds.length + (Boolean(activeTab) ? 1 : 0);
  const useWideLayout = horizontalElementLength > 3;
  const normalizedSearchTerm = searchTerm.trim();
  const canShowSearchActionDropdown =
    activeTab?.type === 'search' &&
    Boolean(activeTabId) &&
    tabs.length > 0 &&
    !quickJumpTarget &&
    normalizedSearchTerm.length > 0;

  const focusDetachedPanel = () => {
    const popup = popupWindowRef.current;
    if (!popup || popup.closed) {
      return;
    }

    popup.focus();
  };

  const runSearchByAction = async (query: string, action: 'replace' | 'new') => {
    const normalized = query.trim();
    if (!normalized) {
      return;
    }

    await dispatch(loadTranslations(starredTranslationIds));

    if (action === 'new') {
      dispatch(runSearchInNewTab({ query: normalized, translationIds: starredTranslationIds }));
    } else if (activeTabId && activeTab?.type === 'search') {
      dispatch(runSearchInTab({ tabId: activeTabId, query: normalized, translationIds: starredTranslationIds }));
    } else {
      dispatch(runSearchInNewTab({ query: normalized, translationIds: starredTranslationIds }));
    }

    setIsSearchActionDropdownOpen(false);
    setIsSearchActionDropdownSuppressed(true);
    setSearchActionIndex(0);

    if (isPanelDetached) {
      focusDetachedPanel();
    }
  };

  const attachPopupWindow = (popup: Window, windowName: string) => {
    popupWindowRef.current = popup;

    popup.document.title = 'GitBible Panel';
    popup.document.body.className = document.body.className;
    popup.document.documentElement.setAttribute('data-theme', theme);
    popup.document.documentElement.setAttribute('data-bs-theme', theme);
    popup.document.documentElement.style.height = '100%';
    popup.document.body.style.height = '100%';
    popup.document.body.style.margin = '0';
    popup.document.body.style.padding = '1rem';
    popup.document.body.style.display = 'flex';
    popup.document.body.style.flexDirection = 'column';

    const existingRoot = popup.document.getElementById('gitbible-popout-root');
    const root = existingRoot ?? popup.document.createElement('div');
    root.id = 'gitbible-popout-root';
    root.style.display = 'flex';
    root.style.flexDirection = 'column';
    root.style.flex = '1 1 auto';
    root.style.minHeight = '0';
    if (!existingRoot) {
      popup.document.body.innerHTML = '';
      popup.document.body.appendChild(root);
    }

    if (!popup.document.getElementById('gitbible-popout-base')) {
      const baseStyle = popup.document.createElement('style');
      baseStyle.id = 'gitbible-popout-base';
      baseStyle.textContent = `
        body {
          background: var(--bs-body-bg);
          color: var(--bs-body-color);
        }

        #gitbible-popout-root .popout-panel-shell {
          display: flex;
          flex: 1 1 auto;
          flex-direction: column;
          min-height: 0;
          max-height: none;
        }

        #gitbible-popout-root .popout-panel-shell.workspace-scroll {
          height: 100%;
          max-height: none;
          overflow: auto;
        }

        #gitbible-popout-root .popout-panel-shell > .card {
          flex: 1 1 auto;
          min-height: 0;
        }

        #gitbible-popout-root .popout-panel-shell .card-body {
          min-height: 0;
        }

        #gitbible-popout-root .popout-panel-shell .search-results-card {
          flex: 1 1 auto;
          min-height: 0;
        }

        #gitbible-popout-root .popout-panel-shell .search-results-body {
          flex: 1 1 auto;
          min-height: 0;
        }
      `;
      popup.document.head.appendChild(baseStyle);
    }

    document.querySelectorAll('link[rel="stylesheet"], style').forEach((styleNode) => {
      const clone = styleNode.cloneNode(true) as HTMLElement;

      if (styleNode.tagName === 'LINK') {
        const href = styleNode.getAttribute('href');
        if (!href) {
          return;
        }

        const existing = Array.from(popup.document.querySelectorAll('link[rel="stylesheet"]')).some((candidate) => candidate.getAttribute('href') === href);
        if (existing) {
          return;
        }
      }

      if (styleNode.tagName === 'STYLE') {
        const styleId = styleNode.getAttribute('id');
        if (styleId) {
          const existing = popup.document.getElementById(styleId);
          if (existing) {
            return;
          }
        }
      }

      popup.document.head.appendChild(clone);
    });

    const handlePopupBeforeUnload = () => {
      dispatch(setPanelDetached({ detached: false, panelName: null }));
      setPopupContainer(null);
      popupWindowRef.current = null;
      sessionStorage.removeItem('gitbible-popout-name');
    };

    popup.addEventListener('beforeunload', handlePopupBeforeUnload);
    popupCleanupRef.current = () => {
      popup.removeEventListener('beforeunload', handlePopupBeforeUnload);
    };

    setPopupContainer(root);
    dispatch(setPanelDetached({ detached: true, panelName: windowName }));
    sessionStorage.setItem('gitbible-popout-name', windowName);
  };

  const openOrReconnectPopup = (forceOpen: boolean) => {
    const storedName = detachedPanelName ?? sessionStorage.getItem('gitbible-popout-name');
    const windowName = storedName && storedName.trim().length > 0
      ? storedName
      : `gitbible-panel-${Date.now()}`;

    const popup = window.open('', windowName);
    if (!popup) {
      return;
    }

    if (popup.closed) {
      return;
    }

    attachPopupWindow(popup, windowName);
    if (forceOpen) {
      popup.focus();
    }
  };

  // Event handlers
  const handleSearchInput = (value: string) => {
    setIsQuickJumpPreviewHidden(false);
    if (value !== searchTerm) {
      setIsSearchActionDropdownSuppressed(false);
    }
    if (!value.trim()) {
      setIsSearchActionDropdownOpen(false);
      setSearchActionIndex(0);
    }
    dispatch(setSearchTerm(value));
  };

  const handleSearchInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const query = normalizedSearchTerm;
    if (!canShowSearchActionDropdown) {
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      void runSearchByAction(query, 'new');
      return;
    }

    if (!isSearchActionDropdownOpen) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSearchActionIndex((index) => Math.min(1, index + 1));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSearchActionIndex((index) => Math.max(0, index - 1));
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      void runSearchByAction(query, searchActionIndex === 0 ? 'replace' : 'new');
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setIsSearchActionDropdownOpen(false);
      setIsSearchActionDropdownSuppressed(true);
      setSearchActionIndex(0);
    }
  };

  const handleSubmitSearch = async (e: FormEvent) => {
    e.preventDefault();
    const query = normalizedSearchTerm;
    dispatch(setSearchTerm(query));

    if (!query) {
      dispatch(clearSearch());
      dispatch(setFocusVerse(null));
      return;
    }

    const quickJump = quickJumpTarget;
    if (quickJump) {
      await goToReference(quickJump);
      setIsQuickJumpPreviewHidden(true);
      setIsSearchActionDropdownOpen(false);
      return;
    }

    if (isSearchActionDropdownOpen && activeTabId && activeTab?.type === 'search') {
      void runSearchByAction(query, 'replace');
      return;
    }

    if (tabs.length > 0 && activeTabId && activeTab?.type === 'search') {
      setIsSearchActionDropdownOpen(true);
      setSearchActionIndex(0);
      return;
    }

    void runSearchByAction(query, 'new');
  };

  useEffect(() => {
    const query = normalizedSearchTerm;

    if (!isSearchFocused || !canShowSearchActionDropdown || isSearchActionDropdownSuppressed) {
      if (isSearchActionDropdownOpen) {
        setIsSearchActionDropdownOpen(false);
        setSearchActionIndex(0);
      }
      return;
    }

    if (query.length > 5) {
      setIsSearchActionDropdownOpen(true);
      setSearchActionIndex(0);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setIsSearchActionDropdownOpen(true);
      setSearchActionIndex(0);
    }, 1000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    normalizedSearchTerm,
    canShowSearchActionDropdown,
    isSearchActionDropdownSuppressed,
    isSearchFocused,
    isSearchActionDropdownOpen
  ]);

  const goToReference = async (target: QuickJumpTarget, translationId?: string) => {
    if (isPanelDetached) {
      window.focus();
    }

    const nextActiveId = translationId && selectedTranslationIds.includes(translationId)
      ? translationId
      : selectedTranslationId;

    const loadResult = await dispatch(loadTranslation(nextActiveId));

    if (nextActiveId !== selectedTranslationId) {
      dispatch(setSelectedTranslationId(nextActiveId));
      dispatch(setCurrentBibleFromId(nextActiveId));
    }

    const activeBible = loadTranslation.fulfilled.match(loadResult)
      ? loadResult.payload
      : currentBible;
    if (!activeBible) return;

    if (!activeBible.books.some((book) => book.name === target.book)) {
      return;
    }

    dispatch(setSelectedBook(target.book));
    dispatch(setSelectedChapter(target.chapter));
    dispatch(setFocusVerse(target.verse ?? null));

    await scrollToVerse(target);
  };

  const handleCloseTranslation = async (translationId: string) => {
    if (selectedTranslationIds.length <= 1) {
      return;
    }

    const nextIds = selectedTranslationIds.filter((id) => id !== translationId);
    const nextActiveId =
      selectedTranslationId === translationId
        ? nextIds[0]
        : selectedTranslationId;

    dispatch(setSelectedTranslationIds(nextIds));
    dispatch(setSelectedTranslationId(nextActiveId));
    await dispatch(loadTranslation(nextActiveId));
    dispatch(setCurrentBibleFromId(nextActiveId));

    const query = searchTerm.trim();
    if (query.length > 0) {
      if (activeTabId) {
        dispatch(runSearchInTab({ tabId: activeTabId, query, translationIds: nextIds }));
      } else {
        dispatch(runSearch({ query, translationIds: nextIds }));
      }
    }
  };

  const handleBookSelectionChange = (bookName: string) => {
    const nextBook = currentBible?.books.find((book) => book.name === bookName);
    if (!nextBook) {
      return;
    }

    const nextChapter = nextBook.chapters[0]?.chapter ?? 1;
    dispatch(setSelectedBook(bookName));
    dispatch(setSelectedChapter(nextChapter));
    dispatch(setFocusVerse(null));
    void scrollToVerse({ book: bookName, chapter: nextChapter, verse: 1 });
  };

  const handleChapterSelectionChange = (chapter: number) => {
    if (!selectedBook) {
      return;
    }

    const isValidChapter = selectedBookEntry?.chapters.some((entry) => entry.chapter === chapter) ?? false;
    const nextChapter = isValidChapter ? chapter : selectedBookEntry?.chapters[0]?.chapter ?? 1;

    dispatch(setSelectedChapter(nextChapter));
    dispatch(setFocusVerse(null));
    void scrollToVerse({ book: selectedBook, chapter: nextChapter, verse: 1 });
  };

  const handleDividerPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDesktopLayout || !activeWorkspacePanel || !workspaceRef.current) {
      return;
    }

    event.preventDefault();
    const workspace = workspaceRef.current;
    const bounds = workspace.getBoundingClientRect();

    const updateRatio = (clientX: number) => {
      const ratio = (clientX - bounds.left) / bounds.width;
      const clamped = Math.min(0.8, Math.max(0.42, ratio));
      setMainPaneRatio(clamped);
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateRatio(moveEvent.clientX);
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const handleDividerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setMainPaneRatio((value) => Math.max(0.42, value - 0.03));
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setMainPaneRatio((value) => Math.min(0.8, value + 0.03));
    }
  };

  const handleThemeToggle = (e: ChangeEvent<HTMLInputElement>) => {
    dispatch(setTheme(e.target.checked ? 'dark' : 'light'));
  };

  const handleLanguagesChange = (selected: string[]) => {
    dispatch(setSelectedLanguages(normalizeLanguageSelection(selected)));
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

  const handleSelectTab = (tabId: string) => {
    dispatch(setActiveTab(tabId));
    if (isPanelDetached) {
      focusDetachedPanel();
    }
  };

  const handleCloseTab = (tabId: string) => {
    dispatch(closeTab(tabId));
  };

  const handleToggleDetachPanel = () => {
    if (isPanelDetached) {
      dispatch(setPanelDetached({ detached: false, panelName: null }));
      setPopupContainer(null);
      sessionStorage.removeItem('gitbible-popout-name');
      popupCleanupRef.current?.();

      const popup = popupWindowRef.current;
      popupWindowRef.current = null;
      if (popup && !popup.closed) {
        popup.close();
      }

      window.focus();
      return;
    }

    openOrReconnectPopup(true);
  };

  const mainPanePercent = Math.round(mainPaneRatio * 1000) / 10;
  const sidePanePercent = 100 - mainPanePercent;
  const hasSidePanel = !isPanelDetached && Boolean(activeWorkspacePanel);

  const sidePanelContent = (
    <>
      <PanelTabs
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        isDetached={isPanelDetached}
        showDetachButton={isDesktopLayout}
        onToggleDetach={handleToggleDetachPanel}
      />
      <div className="panel-content-scroll">
        {activeTab?.type === 'search' && activeTab.searchResults ? (
          <SearchResults
            tab={activeTab}
            goToReference={goToReference}
            onBeforeNavigate={() => {
              if (isPanelDetached) {
                window.focus();
              }
            }}
          />
        ) : activeTab?.type === 'translations' ? (
          <TranslationsPanel
            tab={activeTab}
            translationRecords={translationRecords}
            translationMetadataById={translationMetadataById}
            addableTranslations={addableTranslations}
            onAddTranslation={async (id) => {
              dispatch(addTranslationRecord(id));
            }}
            onRemoveTranslation={(id) => dispatch(removeTranslationRecord(id))}
            onToggleStar={(id) => dispatch(toggleStarTranslation(id))}
            onReorder={(fromIndex, toIndex) => dispatch(reorderTranslations({ fromIndex, toIndex }))}
          />
        ) : null}
        <div className="pb-4" aria-hidden="true"></div>
      </div>
    </>
  );

  return (
    <>
      <div className={`container app-shell ${useWideLayout ? 'app-shell-wide' : ''}`}>
      <header className="card border-0 shadow-sm mb-4">
        <div className="card-body d-flex flex-column flex-lg-row gap-3 align-items-lg-start justify-content-lg-between">
          <div>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <h1 className="display-6 fw-semibold mb-0">GitBible</h1>
              <button
                type="button"
                className="btn btn-outline-secondary rounded-circle d-inline-flex align-items-center justify-content-center"
                aria-label="Open settings"
                data-bs-toggle="modal"
                data-bs-target="#settingsModal"
                onClick={openSettingsModal}
              >
                <i className="bi bi-gear-fill" aria-hidden="true"></i>
              </button>
            </div>
            <p className="text-body-secondary mb-0">
              Browse Scripture offline, search quickly, and jump to any verse.
            </p>
          </div>
        </div>
      </header>

      <section className="card border-0 shadow-sm mb-4">
        <div className="card-body">
          <form className="row g-2 align-items-center" onSubmit={handleSubmitSearch}>
            <fieldset className="col-12 mb-0">
              <legend className="visually-hidden">Quick search</legend>
              <div className="quick-jump-shell">
                <div className="input-group input-group-lg search-input-group">
                  <div className="search-input-wrap">
                    <input
                      id="searchInput"
                      ref={searchInputRef}
                      type="search"
                      inputMode="search"
                      name="search"
                      className="form-control"
                      autoComplete="off"
                      placeholder="Search or jump (e.g. Gen 1:3)"
                      value={searchTerm}
                      onChange={(e) => handleSearchInput(e.target.value)}
                      onKeyDown={handleSearchInputKeyDown}
                      onFocus={() => setIsSearchFocused(true)}
                      onBlur={() => setIsSearchFocused(false)}
                    />
                    {!isSearchFocused && !searchTerm && (
                      <span className="search-kbd-hint" aria-hidden="true">
                        <kbd>{isMac ? '⌘' : 'Ctrl'}+F</kbd>
                      </span>
                    )}
                    {searchTerm && (
                      <button
                        type="button"
                        className="search-clear-btn"
                        aria-label="Clear search"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleSearchInput('');
                          searchInputRef.current?.focus();
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <button className="btn btn-primary" type="submit">
                    Go
                  </button>
                </div>
                {quickJumpPreview && (
                  <div
                    className={`quick-jump-preview quick-jump-pulldown ${isQuickJumpPreviewHidden ? 'is-hidden' : 'is-visible'}`}
                    aria-hidden={isQuickJumpPreviewHidden}
                  >
                    <span className="text-uppercase fw-semibold small text-primary">Jump to</span>
                    <span className="reference">
                      {quickJumpPreview.book} {quickJumpPreview.chapter}
                      {quickJumpPreview.verse && <>:{quickJumpPreview.verse}</>}
                    </span>
                    {quickJumpPreview.text && (
                      <span className="preview-text text-body-secondary">
                        "{quickJumpPreview.text}"
                      </span>
                    )}
                  </div>
                )}
                {!quickJumpPreview && activeTab && (
                  <SearchActionDropdown
                    isOpen={isSearchActionDropdownOpen}
                    activeTabTitle={activeTab.title}
                    selectedIndex={searchActionIndex}
                    onSelectAction={(action) => runSearchByAction(normalizedSearchTerm, action)}
                  />
                )}
              </div>
            </fieldset>
          </form>
        </div>
      </section>

      <div
        ref={workspaceRef}
        className={`workspace-layout ${hasSidePanel ? 'has-side-panel' : ''} ${
          isDesktopLayout ? 'is-desktop' : 'is-mobile'
        }`}
      >
        {currentBible && (
          <section
            className="workspace-pane workspace-main"
            style={
              isDesktopLayout && activeWorkspacePanel && !isPanelDetached
                ? { flexBasis: `${mainPanePercent}%` }
                : undefined
            }
          >
            <div className="card border-0 shadow-sm">
              <div className="card-body workspace-scroll pb-4">
                {selectedBook ? (
                  <VerseDisplay
                    chaptersByTranslation={chaptersByTranslation}
                    translationOrder={starredTranslationIds}
                    translationLabels={translationLabels}
                    books={currentBible.books}
                    availableChapters={selectedBookEntry?.chapters ?? []}
                    selectedBook={selectedBook}
                    selectedChapter={selectedChapter}
                    focusVerse={focusVerse}
                    showTranslationTags={hasMultiTranslations}
                    onCloseTranslation={handleCloseTranslation}
                    onBookChange={handleBookSelectionChange}
                    onChapterChange={handleChapterSelectionChange}
                    onVerseClick={(verse) => {
                      dispatch(setFocusVerse(verse));
                      dispatch(openTranslationsTab({
                        book: selectedBook,
                        chapter: selectedChapter,
                        verse
                      }));
                    }}
                    verseDomId={verseDomId}
                  />
                ) : (
                  <p className="text-body-secondary mb-0">Select a chapter to begin.</p>
                )}
              </div>
            </div>
          </section>
        )}

        {isDesktopLayout && !isPanelDetached && activeWorkspacePanel && (
          <div
            className="workspace-divider"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize verse and panel columns"
            tabIndex={0}
            onPointerDown={handleDividerPointerDown}
            onKeyDown={handleDividerKeyDown}
          />
        )}

        {hasSidePanel && (
          <aside
            className="workspace-pane workspace-side"
            style={
              isDesktopLayout
                ? { flexBasis: `${sidePanePercent}%` }
                : undefined
            }
          >
            <div className="workspace-scroll panel-scroll-with-tabs">
              {sidePanelContent}
            </div>
          </aside>
        )}
      </div>

      {(isLoading || error) && (
        <section className="mt-4">
          {isLoading && (
            <div
              className="alert alert-info d-inline-flex align-items-center gap-2 py-2 mb-0"
              role="status"
            >
              <span className="spinner-border spinner-border-sm" aria-hidden="true"></span>
              <span>Loading...</span>
            </div>
          )}
          {error && <div className="alert alert-danger mt-3 mb-0">{error}</div>}
        </section>
      )}

      <SettingsModal
        theme={theme}
        handleThemeToggle={handleThemeToggle}
        selectedLanguages={selectedLanguages}
        handleLanguagesChange={handleLanguagesChange}
        languageOptions={languageOptions}
        getLanguageDisplayName={getLanguageDisplayName}
        closeSettingsModal={closeSettingsModal}
      />

      </div>

      {isPanelDetached && activeWorkspacePanel && popupContainer && createPortal(
        <div className="workspace-scroll panel-scroll-with-tabs popout-panel-shell">
          {sidePanelContent}
        </div>,
        popupContainer
      )}
    </>
  );
}

export default App;
