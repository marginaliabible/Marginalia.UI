import React from 'react';
import SearchActionDropdown from './SearchActionDropdown';
import { useSearchController } from '../hooks/useSearchController';
import type { QuickJumpTarget } from '../models/bible';

interface SearchBarProps {
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  starredTranslationIds: string[];
  goToReference: (target: QuickJumpTarget, translationId?: string) => Promise<void>;
  isPanelDetached: boolean;
  isDesktopLayout: boolean;
  setIsMobilePanelOpen: (open: boolean) => void;
  onSearchComplete: () => void;
}

const SearchBar: React.FC<SearchBarProps> = ({
  searchInputRef,
  starredTranslationIds,
  goToReference,
  isPanelDetached,
  isDesktopLayout,
  setIsMobilePanelOpen,
  onSearchComplete,
}) => {
  const {
    searchTerm,
    normalizedSearchTerm,
    isSearchFocused,
    isSearchActionDropdownOpen,
    searchActionIndex,
    historyEntries,
    activeTabTitle,
    quickJumpPreview,
    handleSearchInput,
    handleSearchInputKeyDown,
    handleFocus,
    handleBlur,
    handleSubmitSearch,
    runSearchByAction,
    handleSelectQuickJump,
    handleSelectHistory,
    closeDropdown,
  } = useSearchController({
    starredTranslationIds,
    goToReference,
    isPanelDetached,
    isDesktopLayout,
    setIsMobilePanelOpen,
    onSearchComplete,
  });

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

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
                    data-help="search-input"
                    value={searchTerm}
                    onChange={(e) => handleSearchInput(e.target.value)}
                    onKeyDown={handleSearchInputKeyDown}
                    onFocus={handleFocus}
                    onBlur={handleBlur}
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
                  activeTabTitle={activeTabTitle}
                  quickJumpPreview={quickJumpPreview}
                  historyEntries={historyEntries}
                  selectedIndex={searchActionIndex}
                  onSelectAction={(action) => runSearchByAction(normalizedSearchTerm, action)}
                  onSelectQuickJump={handleSelectQuickJump}
                  onSelectHistory={handleSelectHistory}
                  onClose={closeDropdown}
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
