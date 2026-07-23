import { forwardRef, useImperativeHandle, useRef } from 'react';
import SearchActionDropdown from './SearchActionDropdown';
import { useSearchController } from '../hooks/useSearchController';
import type { QuickJumpTarget } from '../models/bible';

interface MiniSearchBarProps {
  starredTranslationIds: string[];
  goToReference: (target: QuickJumpTarget, translationId?: string) => Promise<void>;
  isPanelDetached: boolean;
  focusDetachedPanel: () => void;
  isDesktopLayout: boolean;
  setIsMobilePanelOpen: (open: boolean) => void;
  isVisible: boolean;
  onRequestHide: () => void;
  onSearchComplete: () => void;
}

export interface MiniSearchBarHandle {
  focusInput: () => void;
  triggerPrimaryAction: () => Promise<void>;
}

const MiniSearchBar = forwardRef<MiniSearchBarHandle, MiniSearchBarProps>(({
  starredTranslationIds,
  goToReference,
  isPanelDetached,
  focusDetachedPanel,
  isDesktopLayout,
  setIsMobilePanelOpen,
  isVisible,
  onRequestHide,
  onSearchComplete,
}, ref) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
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
    runSearchByAction,
    handleSelectQuickJump,
    handleSelectHistory,
    closeDropdown,
    handlePrimaryActionOrHide,
  } = useSearchController({
    starredTranslationIds,
    goToReference,
    isPanelDetached,
    focusDetachedPanel,
    isDesktopLayout,
    setIsMobilePanelOpen,
    onEmptyEscape: onRequestHide,
    onSearchComplete,
  });

  useImperativeHandle(ref, () => ({
    focusInput: () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    },
    triggerPrimaryAction: async () => {
      await handlePrimaryActionOrHide(inputRef.current?.value ?? searchTerm);
    },
  }), [handlePrimaryActionOrHide, searchTerm]);

  return (
    <div className={`mini-search-shell ${isVisible ? 'is-visible' : 'is-hidden'}`} aria-hidden={!isVisible}>
      <div className="mini-search-input-wrap">
        <input
          ref={inputRef}
          type="search"
          inputMode="search"
          name="mini-search"
          className="form-control form-control-sm mini-search-input"
          autoComplete="off"
          placeholder="Search or jump"
          value={searchTerm}
          onChange={(e) => handleSearchInput(e.target.value)}
          onKeyDown={handleSearchInputKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
        />
        {searchTerm && (
          <button
            type="button"
            className="mini-search-clear-btn"
            aria-label="Clear mini search"
            onMouseDown={(event) => {
              event.preventDefault();
              handleSearchInput('');
              inputRef.current?.focus();
            }}
          >
            ×
          </button>
        )}

        {isVisible && isSearchFocused && (
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
    </div>
  );
});

MiniSearchBar.displayName = 'MiniSearchBar';

export default MiniSearchBar;
