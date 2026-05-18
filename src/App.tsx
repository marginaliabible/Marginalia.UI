import ChapterSelect from './components/ChapterSelect';
import VerseDisplay from './components/VerseDisplay';
import SearchResults from './components/SearchResults';
import SettingsModal from './components/SettingsModal';
import { useEffect, useMemo, useRef, FormEvent, ChangeEvent } from 'react';
import { useAppDispatch, useAppSelector } from './store/hooks';
import { loadTranslation, refreshTranslations, runSearch, clearSearch } from './store/slices/bibleSlice';
import {
  setSelectedTranslationId,
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

  // Redux state
  const {
    availableTranslations,
    currentBible,
    isLoading,
    error,
    searchResults
  } = useAppSelector((state) => state.bible);

  const {
    selectedTranslationId,
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
      
      // Apply theme
      applyTheme(savedState.theme ?? detectPreferredTheme());
      
      // Refresh translations
      await dispatch(refreshTranslations(false));

      // Restore state
      const resolvedLanguages = savedState.languages && savedState.languages.length > 0 
        ? normalizeLanguageSelection(savedState.languages)
        : detectPreferredLanguages();
      dispatch(restoreState({
        selectedTranslationId: savedState.lastTranslationId || 'KJV',
        selectedBook: savedState.lastBook || null,
        selectedChapter: savedState.lastChapter || 1,
        focusVerse: savedState.lastVerse || null,
        searchTerm: savedState.lastSearch || '',
        selectedLanguages: resolvedLanguages,
        theme: savedState.theme || detectPreferredTheme(),
        ready: true
      }));

      // Load initial translation
      if (savedState.lastTranslationId) {
        await dispatch(loadTranslation(savedState.lastTranslationId));
        
        // Restore book after bible loads
        if (savedState.lastBook) {
          dispatch(setSelectedBook(savedState.lastBook));
          if (savedState.lastChapter) {
            dispatch(setSelectedChapter(savedState.lastChapter));
          }
          if (savedState.lastVerse) {
            dispatch(setFocusVerse(savedState.lastVerse));
          }
        }
      }

      dispatch(setReady(true));
    };

    initApp();
  }, [dispatch]);

  // Persist state on changes
  useEffect(() => {
    if (!ready) return;

    bibleService.persistState({
      lastTranslationId: selectedTranslationId,
      lastBook: selectedBook || undefined,
      lastChapter: selectedBook ? selectedChapter : undefined,
      lastVerse: focusVerse || undefined,
      lastSearch: searchTerm.trim() || undefined,
      theme,
      languages: selectedLanguages
    });
  }, [selectedTranslationId, selectedBook, selectedChapter, focusVerse, searchTerm, theme, selectedLanguages, ready]);

  // Apply theme changes
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Computed values
  const books = useMemo(() => currentBible?.books ?? [], [currentBible]);

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

  const chapters = useMemo(() => {
    const book = books.find((b) => b.name === selectedBook) ?? books?.[0];
    return book?.chapters ?? [];
  }, [books, selectedBook]);

  const currentChapter = useMemo(() => {
    return chapters.find((c) => c.chapter === selectedChapter) ?? null;
  }, [chapters, selectedChapter]);

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

  // Event handlers
  const handleTranslationChange = async (translationId: string) => {
    dispatch(setSelectedTranslationId(translationId));
    await dispatch(loadTranslation(translationId));
    
    // Reset book selection if current book doesn't exist in new translation
    if (selectedBook && currentBible) {
      const bookExists = currentBible.books.some((b) => b.name === selectedBook);
      if (!bookExists) {
        dispatch(setSelectedBook(null));
        dispatch(setSelectedChapter(1));
        dispatch(setFocusVerse(null));
      }
    }
  };

  const handleBookChange = (bookName: string) => {
    if (!bookName) return;

    dispatch(setSelectedBook(bookName));
    const book = books.find((b) => b.name === bookName);
    const chapter = book?.chapters[0]?.chapter ?? 1;
    dispatch(setSelectedChapter(chapter));
    dispatch(setFocusVerse(null));
  };

  const handleChapterChange = (value: string) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return;

    dispatch(setSelectedChapter(parsed));
    dispatch(setFocusVerse(null));
  };

  const handleSearchInput = (value: string) => {
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
      return;
    }

    dispatch(runSearch(query));
    
    // Navigate to first result
    if (searchResults && searchResults.matches.length > 0) {
      const firstMatch = searchResults.matches[0];
      await goToReference({
        book: firstMatch.book,
        chapter: firstMatch.chapter,
        verse: firstMatch.verse
      });
    }
  };

  const goToReference = async (target: QuickJumpTarget) => {
    if (!currentBible) return;

    if (!currentBible.books.some((book) => book.name === target.book)) {
      return;
    }

    dispatch(setSelectedBook(target.book));
    dispatch(setSelectedChapter(target.chapter));
    dispatch(setFocusVerse(target.verse ?? null));

    await scrollToVerse(target);
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

  return (
    <div className="container py-4">
      <header className="card border-0 shadow-sm mb-4">
        <div className="card-body d-flex flex-column flex-lg-row gap-3 align-items-lg-start justify-content-lg-between position-relative">
          <div>
            <h1 className="display-6 fw-semibold mb-1">GitBible</h1>
            <p className="text-body-secondary mb-0">
              Browse Scripture offline, search quickly, and jump to any verse.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-outline-secondary rounded-circle d-inline-flex align-items-center justify-content-center position-absolute top-0 end-0 m-3"
            aria-label="Open settings"
            data-bs-toggle="modal"
            data-bs-target="#settingsModal"
            onClick={openSettingsModal}
          >
            <i className="bi bi-gear-fill" aria-hidden="true"></i>
          </button>
          <div className="d-flex flex-wrap align-items-center gap-3 justify-content-end">
            <div className="translation-select d-flex flex-column flex-grow-1 flex-lg-grow-0">
              <label className="form-label fw-semibold small mb-1" htmlFor="translationSelect">
                Translation
              </label>
              <select
                id="translationSelect"
                className="form-select"
                value={selectedTranslationId}
                onChange={(e) => handleTranslationChange(e.target.value)}
              >
                {filteredTranslations.map((translation) => (
                  <option key={translation.id} value={translation.id}>
                    {translation.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </header>

      <section className="card border-0 shadow-sm mb-4">
        <div className="card-body">
          <form className="row g-2 align-items-center" onSubmit={handleSubmitSearch}>
            <fieldset className="col-12 mb-0">
              <legend className="visually-hidden">Quick search</legend>
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
            </fieldset>
          </form>
          {quickJumpPreview && (
            <div className="alert alert-info quick-jump-preview d-flex flex-wrap align-items-baseline gap-2 mt-3 mb-0">
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
      </section>

      <div className="row g-4 align-items-start">
        {books.length > 0 && (
          <div className="col-12 col-lg-3">
            <ChapterSelect
              books={books}
              chapters={chapters}
              selectedBook={selectedBook}
              selectedChapter={selectedChapter}
              handleBookChange={handleBookChange}
              handleChapterChange={handleChapterChange}
            />
          </div>
        )}

        {currentBible && (
          <div className={`col-12 ${searchResults ? 'col-lg-6' : 'col-lg-9'}`}>
            <div className="card border-0 shadow-sm">
              <div className="card-body">
                <div className="d-flex flex-wrap align-items-baseline gap-2 mb-3">
                  <h2 className="h4 mb-0">{selectedBook}</h2>
                  {selectedChapter && (
                    <span className="badge bg-secondary-subtle text-secondary-emphasis">
                      {selectedChapter}
                    </span>
                  )}
                </div>
                <p className="text-body-secondary mb-4">{currentBible.translation}</p>
                {currentChapter ? (
                  <VerseDisplay
                    verses={currentChapter.verses}
                    selectedBook={selectedBook}
                    currentChapter={currentChapter}
                    focusVerse={focusVerse}
                    verseDomId={verseDomId}
                  />
                ) : (
                  <p className="text-body-secondary mb-0">Select a chapter to begin.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {searchResults && (
          <div className="col-12 col-lg-3">
            <SearchResults searchResults={searchResults} goToReference={goToReference} />
          </div>
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

      {/* Settings Modal */}
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
