import React, { useState, useMemo, useEffect, FormEvent } from 'react';
import SearchActionDropdown, { type SearchHistoryEntry } from './SearchActionDropdown';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import {
  loadTranslations,
  runSearchInNewTab,
  runSearchInTab,
  clearSearch,
} from '../store/slices/bibleSlice';
import { setSearchTerm, clearVerseSelection } from '../store/slices/uiSlice';
import { parseQuickJump } from '../utils/reference-parser';
import type { QuickJumpTarget } from '../models/bible';

interface SearchBarProps {
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  starredTranslationIds: string[];
  goToReference: (target: QuickJumpTarget, translationId?: string) => Promise<void>;
  isPanelDetached: boolean;
  focusDetachedPanel: () => void;
  isDesktopLayout: boolean;
  setIsMobilePanelOpen: (open: boolean) => void;
}

const SEARCH_HISTORY_KEY = 'gitbible:search-jump-history';
const MAX_SEARCH_HISTORY = 50;

const SearchBar: React.FC<SearchBarProps> = ({
  searchInputRef,
  starredTranslationIds,
  goToReference,
  isPanelDetached,
  focusDetachedPanel,
  isDesktopLayout,
  setIsMobilePanelOpen,
}) => {
  const dispatch = useAppDispatch();
  const { tabs, activeTabId, currentBible } = useAppSelector((state) => state.bible);
  const { searchTerm, ready } = useAppSelector((state) => state.ui);

  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [isSearchActionDropdownOpen, setIsSearchActionDropdownOpen] = useState(false);
  const [searchActionIndex, setSearchActionIndex] = useState(0);
  const [historyEntries, setHistoryEntries] = useState<SearchHistoryEntry[]>([]);

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const normalizedSearchTerm = searchTerm.trim();

  const activeTab = useMemo(() => {
    if (!activeTabId) return null;
    return tabs.find((tab) => tab.id === activeTabId) ?? null;
  }, [tabs, activeTabId]);

  const quickJumpTarget = useMemo<QuickJumpTarget | null>(() => {
    if (!ready || !currentBible || !searchTerm) return null;
    return parseQuickJump(searchTerm, currentBible.books);
  }, [ready, currentBible, searchTerm]);

  const quickJumpPreview = useMemo(() => {
    if (!currentBible || !quickJumpTarget) return null;

    const book = currentBible.books.find((b) => b.name === quickJumpTarget.book);
    const chapter = book?.chapters.find((c) => c.chapter === quickJumpTarget.chapter);
    const verseText = quickJumpTarget.verse
      ? chapter?.verses.find((v) => v.verse === quickJumpTarget.verse)?.text
      : undefined;

    return { ...quickJumpTarget, text: verseText };
  }, [currentBible, quickJumpTarget]);

  const canShowSearchActionDropdown =
    activeTab?.type === 'search' &&
    Boolean(activeTabId) &&
    tabs.length > 0 &&
    !quickJumpTarget &&
    normalizedSearchTerm.length > 0;

  const actionCount = canShowSearchActionDropdown ? 2 : 0;
  const selectableCount = actionCount + historyEntries.length;

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const raw = window.localStorage.getItem(SEARCH_HISTORY_KEY);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return;
      }

      const normalized = parsed
        .filter((entry): entry is SearchHistoryEntry => {
          return Boolean(entry) && typeof entry.query === 'string' && (entry.kind === 'search' || entry.kind === 'quick-jump');
        })
        .map((entry) => ({
          query: entry.query.trim(),
          kind: entry.kind,
          referenceLabel: typeof entry.referenceLabel === 'string' ? entry.referenceLabel : undefined,
        }))
        .filter((entry) => entry.query.length > 0)
        .slice(0, MAX_SEARCH_HISTORY);

      setHistoryEntries(normalized);
    } catch {
      setHistoryEntries([]);
    }
  }, []);

  useEffect(() => {
    if (searchActionIndex < selectableCount) {
      return;
    }

    setSearchActionIndex(Math.max(0, selectableCount - 1));
  }, [searchActionIndex, selectableCount]);

  const updateSearchHistory = (query: string, jumpTarget: QuickJumpTarget | null) => {
    const normalized = query.trim();
    if (!normalized) {
      return;
    }

    const nextEntry: SearchHistoryEntry = jumpTarget
      ? {
        query: normalized,
        kind: 'quick-jump',
        referenceLabel: `${jumpTarget.book} ${jumpTarget.chapter}${jumpTarget.verse ? `:${jumpTarget.verse}` : ''}`,
      }
      : {
        query: normalized,
        kind: 'search',
      };

    const nextHistory = [
      nextEntry,
      ...historyEntries.filter((entry) => entry.query.toLowerCase() !== normalized.toLowerCase()),
    ].slice(0, MAX_SEARCH_HISTORY);

    setHistoryEntries(nextHistory);

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(nextHistory));
    }
  };

  const runSearchByAction = async (query: string, action: 'replace' | 'new') => {
    const normalized = query.trim();
    if (!normalized) return;

    updateSearchHistory(normalized, null);

    await dispatch(loadTranslations(starredTranslationIds));

    if (action === 'new') {
      dispatch(runSearchInNewTab({ query: normalized, translationIds: starredTranslationIds }));
    } else if (activeTabId && activeTab?.type === 'search') {
      dispatch(runSearchInTab({ tabId: activeTabId, query: normalized, translationIds: starredTranslationIds }));
    } else {
      dispatch(runSearchInNewTab({ query: normalized, translationIds: starredTranslationIds }));
    }

    setIsSearchActionDropdownOpen(false);
    setSearchActionIndex(0);

    if (!isDesktopLayout && !isPanelDetached) {
      setIsMobilePanelOpen(true);
    }

    if (isPanelDetached) {
      focusDetachedPanel();
    }
  };

  const handleSearchInput = (value: string) => {
    setIsSearchActionDropdownOpen(true);
    setSearchActionIndex(0);
    dispatch(setSearchTerm(value));
  };

  const handleSearchInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const query = normalizedSearchTerm;
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      void runSearchByAction(query, 'new');
      return;
    }

    if (!isSearchActionDropdownOpen) return;

    if (event.key === 'ArrowDown' && selectableCount > 0) {
      event.preventDefault();
      setSearchActionIndex((index) => Math.min(selectableCount - 1, index + 1));
      return;
    }

    if (event.key === 'ArrowUp' && selectableCount > 0) {
      event.preventDefault();
      setSearchActionIndex((index) => Math.max(0, index - 1));
      return;
    }

    if (event.key === 'Enter' && selectableCount > 0) {
      event.preventDefault();
      if (searchActionIndex < actionCount) {
        void runSearchByAction(query, searchActionIndex === 0 ? 'replace' : 'new');
        return;
      }

      const historyEntry = historyEntries[searchActionIndex - actionCount];
      if (historyEntry) {
        void handleSelectHistory(historyEntry);
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setIsSearchActionDropdownOpen(false);
      setSearchActionIndex(0);
    }
  };

  const handleSelectHistory = async (entry: SearchHistoryEntry) => {
    const normalized = entry.query.trim();
    if (!normalized) {
      return;
    }

    dispatch(setSearchTerm(normalized));

    if (entry.kind === 'quick-jump' && currentBible) {
      const target = parseQuickJump(normalized, currentBible.books);
      if (target) {
        await goToReference(target);
        updateSearchHistory(normalized, target);
        setIsSearchActionDropdownOpen(false);
        return;
      }
    }

    await runSearchByAction(
      normalized,
      activeTabId && activeTab?.type === 'search' ? 'replace' : 'new'
    );
  };

  const handleSubmitSearch = async (e: FormEvent) => {
    e.preventDefault();
    const query = normalizedSearchTerm;
    dispatch(setSearchTerm(query));

    if (!query) {
      dispatch(clearSearch());
      dispatch(clearVerseSelection());
      return;
    }

    const quickJump = quickJumpTarget;
    if (quickJump) {
      await goToReference(quickJump);
      updateSearchHistory(query, quickJump);
      setIsSearchActionDropdownOpen(false);
      return;
    }

    void runSearchByAction(query, activeTabId && activeTab?.type === 'search' ? 'replace' : 'new');
  };

  return (
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
                    onFocus={() => {
                      setIsSearchFocused(true);
                      setIsSearchActionDropdownOpen(true);
                    }}
                    onBlur={() => {
                      setIsSearchFocused(false);
                      setIsSearchActionDropdownOpen(false);
                    }}
                  />
                  {!isSearchFocused && !searchTerm && (
                    <span className="search-kbd-hint" aria-hidden="true">
                      <kbd>{isMac ? '⌘' : 'Ctrl'}+K</kbd>
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
              {isSearchFocused && (
                <SearchActionDropdown
                  isOpen={isSearchActionDropdownOpen}
                  activeTabTitle={canShowSearchActionDropdown ? activeTab?.title ?? null : null}
                  quickJumpPreview={quickJumpPreview}
                  historyEntries={historyEntries}
                  selectedIndex={searchActionIndex}
                  onSelectAction={(action) => runSearchByAction(normalizedSearchTerm, action)}
                  onSelectHistory={handleSelectHistory}
                  onClose={() => {
                    setIsSearchActionDropdownOpen(false);
                    setSearchActionIndex(0);
                  }}
                />
              )}
            </div>
          </fieldset>
        </form>
      </div>
    </section>
  );
};

export default SearchBar;
