import React from 'react';

interface SearchActionDropdownProps {
  isOpen: boolean;
  activeTabTitle: string;
  selectedIndex: number;
  onSelectAction: (action: 'replace' | 'new') => void;
}

const SearchActionDropdown: React.FC<SearchActionDropdownProps> = ({
  isOpen,
  activeTabTitle,
  selectedIndex,
  onSelectAction
}) => {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="quick-jump-preview quick-jump-pulldown is-visible search-action-dropdown" role="listbox" aria-label="Search destination">
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
    </div>
  );
};

export default SearchActionDropdown;
