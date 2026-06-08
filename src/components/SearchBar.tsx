import React, { useState, useMemo, useEffect, FormEvent } from 'react';
import SearchActionDropdown from './SearchActionDropdown';
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
  const [isQuickJumpPreviewHidden, setIsQuickJumpPreviewHidden] = useState(true);
  const [isSearchActionDropdownOpen, setIsSearchActionDropdownOpen] = useState(false);
  const [isSearchActionDropdownSuppressed, setIsSearchActionDropdownSuppressed] = useState(false);
  const [searchActionIndex, setSearchActionIndex] = useState(0);

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

  const runSearchByAction = async (query: string, action: 'replace' | 'new') => {
    const normalized = query.trim();
    if (!normalized) return;

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

    if (!isDesktopLayout && !isPanelDetached) {
      setIsMobilePanelOpen(true);
    }

    if (isPanelDetached) {
      focusDetachedPanel();
    }
  };

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
    if (!canShowSearchActionDropdown) return;

    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      void runSearchByAction(query, 'new');
      return;
    }

    if (!isSearchActionDropdownOpen) return;

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
      dispatch(clearVerseSelection());
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

  // Auto-show search action dropdown after typing
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
    isSearchActionDropdownOpen,
  ]);

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
                    onFocus={() => setIsSearchFocused(true)}
                    onBlur={() => setIsSearchFocused(false)}
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
  );
};

export default SearchBar;
