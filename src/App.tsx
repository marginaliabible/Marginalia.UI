import VerseDisplay from './components/VerseDisplay';
import SearchResults from './components/SearchResults';
import SettingsModal from './components/SettingsModal';
import { useEffect, useMemo, useRef, useState, FormEvent, ChangeEvent } from 'react';
import Select, { MultiValue } from 'react-select';
import { useAppDispatch, useAppSelector } from './store/hooks';
import {
  loadTranslations,
  refreshTranslations,
  runSearch,
  clearSearch,
  setCurrentBibleFromId
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
  restoreState
} from './store/slices/uiSlice';
import { parseQuickJump } from './utils/reference-parser';
import { bibleService } from './services/bibleService';
import type { QuickJumpTarget, ThemePreference, BibleTranslationMeta } from './models/bible';
import languageOverrides from '../public/data/languageOverrides.json';
import './App.scss';

interface TranslationSelectOption {
  value: string;
  label: string;
}

type WorkspacePanelKey = 'search';

const DESKTOP_BREAKPOINT = '(min-width: 992px)';

// Helper functions
const normalizeLanguageSelection = (values: string[]): string[] => {
  const normalized = values
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);

  return Array.from(new Set(normalized));
};

const normalizeLanguages = (language: BibleTranslationMeta['language']): string[] => {
  if (!language) return [];
  const candidates = Array.isArray(language) ? language : [language];
  return normalizeLanguageSelection(candidates);
};

const detectPreferredLanguages = (): string[] => {
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

const verseDomId = (book: string, chapter: number, verse: number): string => {
  return `${book.replace(/\s+/g, '_')}-${chapter}-${verse}`;
};

const getLanguageDisplayName = (code: string): string => {
  // Check overrides first
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

const applyTheme = (themePreference: ThemePreference): void => {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  root.setAttribute('data-theme', themePreference);
  root.setAttribute('data-bs-theme', themePreference);
};

const detectPreferredTheme = (): ThemePreference => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const scrollToVerse = async (target: QuickJumpTarget): Promise<void> => {
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

function App() {
  const dispatch = useAppDispatch();
  const modalRef = useRef<any>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const [isQuickJumpPreviewHidden, setIsQuickJumpPreviewHidden] = useState(true);
  const [mainPaneRatio, setMainPaneRatio] = useState(2 / 3);
  const [isDesktopLayout, setIsDesktopLayout] = useState(
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(DESKTOP_BREAKPOINT).matches
      : true
  );

  // Redux state
  const {
    availableTranslations,
    currentBible,
    loadedTranslations,
    isLoading,
    error,
    searchResults
  } = useAppSelector((state) => state.bible);

  const {
    selectedTranslationId,
    selectedTranslationIds,
    selectedBook,
    selectedChapter,
    focusVerse,
    searchTerm,
    selectedLanguages,
    theme,
    ready
  } = useAppSelector((state) => state.ui);

  // Initialize app
  useEffect(() => {
    const initApp = async () => {
      const savedState = bibleService.readState();
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
      const activeTranslationId =
        savedState.lastTranslationId && resolvedTranslationIds.includes(savedState.lastTranslationId)
          ? savedState.lastTranslationId
          : resolvedTranslationIds[0];
      
      // Apply theme
      applyTheme(savedState.theme ?? detectPreferredTheme());
      
      // Refresh translations
      await dispatch(refreshTranslations(false));

      // Restore state
      const resolvedLanguages = savedState.languages && savedState.languages.length > 0
        ? normalizeLanguageSelection(savedState.languages)
        : detectPreferredLanguages();
      dispatch(restoreState({
        selectedTranslationId: activeTranslationId,
        selectedTranslationIds: resolvedTranslationIds,
        selectedBook: savedState.lastBook || null,
        selectedChapter: savedState.lastChapter || 1,
        focusVerse: savedState.lastVerse || null,
        searchTerm: savedState.lastSearch || '',
        selectedLanguages: resolvedLanguages,
        theme: savedState.theme || detectPreferredTheme(),
        ready: true
      }));

      await dispatch(loadTranslations(resolvedTranslationIds));
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
  }, [theme]);

  // Computed values
  const books = useMemo(() => currentBible?.books ?? [], [currentBible]);

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

  const selectableTranslations = useMemo(() => {
    const map = new Map(filteredTranslations.map((translation) => [translation.id, translation] as const));
    for (const translationId of selectedTranslationIds) {
      const existing = translationMetadataById.get(translationId);
      if (existing) {
        map.set(translationId, existing);
      }
    }

    return Array.from(map.values()).sort((a, b) => a.id.localeCompare(b.id));
  }, [filteredTranslations, selectedTranslationIds, translationMetadataById]);

  const translationSelectOptions = useMemo<TranslationSelectOption[]>(
    () =>
      selectableTranslations.map((translation) => ({
        value: translation.id,
        label: `${translation.id} - ${translation.label}`
      })),
    [selectableTranslations]
  );

  const selectedTranslationOptions = useMemo<TranslationSelectOption[]>(() => {
    const optionsById = new Map(translationSelectOptions.map((option) => [option.value, option] as const));

    return selectedTranslationIds
      .map((id) => {
        const existing = optionsById.get(id);
        if (existing) {
          return existing;
        }

        const translation = translationMetadataById.get(id);
        return {
          value: id,
          label: translation ? `${translation.id} - ${translation.label}` : id
        };
      })
      .filter((option): option is TranslationSelectOption => option !== null);
  }, [selectedTranslationIds, translationSelectOptions, translationMetadataById]);

  const chapters = useMemo(() => {
    const book = books.find((b) => b.name === selectedBook) ?? books?.[0];
    return book?.chapters ?? [];
  }, [books, selectedBook]);

  const currentChapter = useMemo(() => {
    return chapters.find((c) => c.chapter === selectedChapter) ?? null;
  }, [chapters, selectedChapter]);

  const chaptersByTranslation = useMemo(() => {
    const chaptersMap: Record<string, typeof currentChapter> = {};

    for (const translationId of selectedTranslationIds) {
      const bible = loadedTranslations[translationId] ?? null;
      if (!bible || !selectedBook) {
        chaptersMap[translationId] = null;
        continue;
      }

      const book = bible.books.find((entry) => entry.name === selectedBook);
      chaptersMap[translationId] = book?.chapters.find((entry) => entry.chapter === selectedChapter) ?? null;
    }

    return chaptersMap;
  }, [loadedTranslations, selectedBook, selectedChapter, selectedTranslationIds, currentChapter]);

  const translationLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const translationId of selectedTranslationIds) {
      const translation = translationMetadataById.get(translationId);
      labels[translationId] = translation?.label ?? translationId;
    }
    return labels;
  }, [selectedTranslationIds, translationMetadataById]);

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

  const activeWorkspacePanel: WorkspacePanelKey | null = searchResults ? 'search' : null;
  const hasMultiTranslations = selectedTranslationIds.length > 1;
  const horizontalElementLength = selectedTranslationIds.length + (Boolean(searchResults) ? 1 : 0);
  const useWideLayout = horizontalElementLength > 3;

  // Event handlers
  const handleTranslationSelectionChange = async (selected: MultiValue<TranslationSelectOption>) => {
    const nextIds = Array.from(new Set(selected.map((option) => option.value)));
    if (nextIds.length === 0) {
      return;
    }

    const nextActiveId = nextIds.includes(selectedTranslationId)
      ? selectedTranslationId
      : nextIds[0];

    dispatch(setSelectedTranslationIds(nextIds));
    dispatch(setSelectedTranslationId(nextActiveId));
    await dispatch(loadTranslations(nextIds));
    dispatch(setCurrentBibleFromId(nextActiveId));

    const query = searchTerm.trim();
    if (query.length > 0) {
      dispatch(runSearch({ query, translationIds: nextIds }));
    }
  };

  const handleSearchInput = (value: string) => {
    setIsQuickJumpPreviewHidden(false);
    dispatch(setSearchTerm(value));
    if (searchResults) {
      dispatch(clearSearch());
    }
  };

  const handleSubmitSearch = async (e: FormEvent) => {
    e.preventDefault();
    const query = searchTerm.trim();
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
      return;
    }

    dispatch(runSearch({ query, translationIds: selectedTranslationIds }));
  };

  const goToReference = async (target: QuickJumpTarget, translationId?: string) => {
    const nextActiveId = translationId && selectedTranslationIds.includes(translationId)
      ? translationId
      : selectedTranslationId;

    if (nextActiveId !== selectedTranslationId) {
      dispatch(setSelectedTranslationId(nextActiveId));
      dispatch(setCurrentBibleFromId(nextActiveId));
    }

    const activeBible = loadedTranslations[nextActiveId] ?? currentBible;
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
    await dispatch(loadTranslations(nextIds));
    dispatch(setCurrentBibleFromId(nextActiveId));

    const query = searchTerm.trim();
    if (query.length > 0) {
      dispatch(runSearch({ query, translationIds: nextIds }));
    }
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

  const mainPanePercent = Math.round(mainPaneRatio * 1000) / 10;
  const sidePanePercent = 100 - mainPanePercent;

  return (
    <div className={`container py-4 app-shell ${useWideLayout ? 'app-shell-wide' : ''}`}>
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
                <div className="input-group input-group-lg">
                  <input
                    id="searchInput"
                    type="search"
                    inputMode="search"
                    name="search"
                    className="form-control"
                    autoComplete="off"
                    placeholder="Search or jump (e.g. Gen 1:3)"
                    value={searchTerm}
                    onChange={(e) => handleSearchInput(e.target.value)}
                  />
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
              </div>
            </fieldset>
          </form>
        </div>
      </section>

      <div
        ref={workspaceRef}
        className={`workspace-layout has-side-panel ${
          isDesktopLayout ? 'is-desktop' : 'is-mobile'
        }`}
      >
        {currentBible && (
          <section
            className="workspace-pane workspace-main"
            style={
              isDesktopLayout && activeWorkspacePanel
                ? { flexBasis: `${mainPanePercent}%` }
                : undefined
            }
          >
            <div className="card border-0 shadow-sm">
              <div className="card-body workspace-scroll">
                <div className="translation-selector-wrap mb-3">
                  <label className="form-label fw-semibold small mb-2" htmlFor="translationSelectorInput">
                    Translations
                  </label>
                  <Select
                    inputId="translationSelectorInput"
                    isMulti
                    options={translationSelectOptions}
                    value={selectedTranslationOptions}
                    onChange={handleTranslationSelectionChange}
                    classNamePrefix="translation-select"
                    className="translation-selector"
                    placeholder="Select translations..."
                    isSearchable={true}
                    closeMenuOnSelect={false}
                    hideSelectedOptions={true}
                    noOptionsMessage={() => 'No translations available'}
                  />
                </div>
                {selectedBook ? (
                  <VerseDisplay
                    chaptersByTranslation={chaptersByTranslation}
                    translationOrder={selectedTranslationIds}
                    translationLabels={translationLabels}
                    selectedBook={selectedBook}
                    selectedChapter={selectedChapter}
                    focusVerse={focusVerse}
                    showTranslationTags={hasMultiTranslations}
                    onCloseTranslation={handleCloseTranslation}
                    verseDomId={verseDomId}
                    chapterName={selectedBook ? `${selectedBook} ${selectedChapter}` : undefined}
                  />
                ) : (
                  <p className="text-body-secondary mb-0">Select a chapter to begin.</p>
                )}
              </div>
            </div>
          </section>
        )}

        {isDesktopLayout && (
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

        <aside
          className={`workspace-pane workspace-side ${!activeWorkspacePanel ? 'is-empty' : ''}`}
          style={
            isDesktopLayout
              ? { flexBasis: `${sidePanePercent}%` }
              : undefined
          }
        >
          <div className="workspace-scroll">
            {searchResults ? (
              <SearchResults searchResults={searchResults} goToReference={goToReference} />
            ) : (
              <div className="card border-0 shadow-sm h-100">
                <div className="card-body d-flex flex-column justify-content-center align-items-center text-center">
                  <p className="text-body-secondary mb-0">Search to find verses</p>
                </div>
              </div>
            )}
          </div>
        </aside>
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
  );
}

export default App;
