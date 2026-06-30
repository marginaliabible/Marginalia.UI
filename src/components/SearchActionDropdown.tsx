import React from 'react';

export interface SearchHistoryEntry {
  query: string;
  kind: 'search' | 'quick-jump';
  referenceLabel?: string;
}

interface SearchActionDropdownProps {
  isOpen: boolean;
  activeTabTitle: string | null;
  quickJumpPreview: {
    book: string;
    chapter: number;
    verse?: number;
    text?: string;
  } | null;
  historyEntries: SearchHistoryEntry[];
  selectedIndex: number;
  onSelectAction: (action: 'replace' | 'new') => void;
  onSelectHistory: (entry: SearchHistoryEntry) => void;
  onClose: () => void;
}

const SearchActionDropdown: React.FC<SearchActionDropdownProps> = ({
  isOpen,
  activeTabTitle,
  quickJumpPreview,
  historyEntries,
  selectedIndex,
  onSelectAction,
  onSelectHistory,
  onClose,
}) => {
  if (!isOpen) {
    return null;
  }

  const hasSearchActions = Boolean(activeTabTitle) && !quickJumpPreview;
  const historyStartIndex = hasSearchActions ? 2 : 0;

  return (
    <div className="quick-jump-preview quick-jump-pulldown is-visible search-action-dropdown" role="listbox" aria-label="Search and jump options">
      <button
        type="button"
        className="search-action-close"
        aria-label="Close quick jump options"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClose}
      >
        <i className="fa-solid fa-xmark" aria-hidden="true"></i>
      </button>

      {quickJumpPreview && (
        <div className="search-action-quick-jump">
          <span className="text-uppercase fw-semibold small text-primary">Jump to</span>
          <span className="reference">
            {quickJumpPreview.book} {quickJumpPreview.chapter}
            {quickJumpPreview.verse && <>:{quickJumpPreview.verse}</>}
          </span>
          {quickJumpPreview.text && (
            <span className="preview-text text-body-secondary">"{quickJumpPreview.text}"</span>
          )}
        </div>
      )}

      {hasSearchActions && (
        <>
          <button
            type="button"
            className={`search-action-item ${selectedIndex === 0 ? 'is-selected' : ''}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelectAction('replace')}
          >
            Replace "{activeTabTitle}" results [Enter]
          </button>
          <button
            type="button"
            className={`search-action-item ${selectedIndex === 1 ? 'is-selected' : ''}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelectAction('new')}
          >
            Open in new tab [Ctrl+Enter]
          </button>
        </>
      )}

      {historyEntries.length > 0 && (
        <>
          <div className="search-action-history-label">Recent</div>
          <div className="search-action-history-list" role="group" aria-label="Quick jump history">
            {historyEntries.map((entry, index) => {
              const absoluteIndex = historyStartIndex + index;
              const subtitle = entry.kind === 'quick-jump' && entry.referenceLabel
                ? entry.referenceLabel
                : entry.kind === 'quick-jump'
                  ? 'Quick jump'
                  : 'Search';

              return (
                <button
                  key={`${entry.query}-${index}`}
                  type="button"
                  className={`search-action-item search-action-history-item ${selectedIndex === absoluteIndex ? 'is-selected' : ''}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onSelectHistory(entry)}
                >
                  <i className="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>
                  <span className="search-action-history-content">
                    <span className="search-action-history-query">{entry.query}</span>
                    <span className="search-action-history-meta">{subtitle}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

export default SearchActionDropdown;
