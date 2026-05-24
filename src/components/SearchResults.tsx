import React, { useEffect, useRef } from 'react';
import type { QuickJumpTarget } from '../models/bible';
import type { PanelTab } from '../models/tab';

const highlightText = (text: string, query: string): React.ReactNode => {
  if (!query) return text;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} className="search-highlight">{part}</mark>
      : part
  );
};

interface SearchResultsProps {
  tab: PanelTab;
  goToReference: (target: QuickJumpTarget, translationId?: string) => void;
  onBeforeNavigate?: () => void;
}

const PAGE_SIZE = 50;

const SearchResults: React.FC<SearchResultsProps> = ({ tab, goToReference, onBeforeNavigate }) => {
  const searchResults = tab.searchResults;
  const [displayedCount, setDisplayedCount] = React.useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDisplayedCount(PAGE_SIZE);
  }, [tab.id]);

  if (!searchResults) {
    return null;
  }

  const displayedMatches = searchResults.matches.slice(0, displayedCount);
  const hasMore = displayedCount < searchResults.matches.length;

  // Auto-load more results when user scrolls near the bottom
  useEffect(() => {
    if (!hasMore || !sentinelRef.current) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setDisplayedCount((count) => Math.min(count + PAGE_SIZE, searchResults.matches.length));
          }
        });
      },
      { threshold: 0.01 }
    );

    observer.observe(sentinelRef.current);
    return () => {
      if (sentinelRef.current) {
        observer.unobserve(sentinelRef.current);
      }
    };
  }, [hasMore, searchResults.matches.length]);

  return (
    <div className="card border-0 shadow-sm search-results-card">
      <div className="card-body d-flex flex-column gap-3 search-results-body">
        <div>
          <h3 className="h6 text-uppercase mb-1">Search Results</h3>
          <p className="text-body-secondary results-summary mb-0">
            {searchResults.total} match{searchResults.total === 1 ? '' : 'es'}
            {searchResults.limited && (
              <> (showing first {searchResults.matches.length})</>
            )}
            {' '}for "{searchResults.query}"
          </p>
        </div>
        <div className="list-group results-list flex-grow-1 overflow-auto">
          {displayedMatches.map((match: any) => (
            <button
              key={match.id}
              type="button"
              className="list-group-item list-group-item-action text-start"
              onClick={() => {
                onBeforeNavigate?.();
                goToReference({
                  book: match.book,
                  chapter: match.chapter,
                  verse: match.verse
                }, match.translationId);
              }}
            >
              <span className="match-reference d-block">
                {match.book} {match.chapter}:{match.verse}
                {match.translationId && (
                  <span
                    className="badge text-bg-primary-subtle text-primary-emphasis ms-2"
                    title={match.translationLabel || match.translationId}
                  >
                    {match.translationId}
                  </span>
                )}
              </span>
              <span className="match-text d-block text-body-secondary">
                {highlightText(match.text, searchResults.query)}
              </span>
            </button>
          ))}
          {hasMore && (
            <div
              ref={sentinelRef}
              className="list-group-item text-center text-body-secondary py-2"
              style={{ fontSize: '0.75rem' }}
            >
              Loading more...
            </div>
          )}
        </div>
        {hasMore && (
          <button
            type="button"
            className="btn btn-sm btn-outline-primary w-100"
            onClick={() => setDisplayedCount((count) => Math.min(count + PAGE_SIZE, searchResults.matches.length))}
          >
            Load more results ({displayedCount} of {searchResults.matches.length})
          </button>
        )}
      </div>
    </div>
  );
};

export default SearchResults;
