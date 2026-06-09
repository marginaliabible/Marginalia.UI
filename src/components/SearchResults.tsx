import React, { useEffect, useRef } from 'react';
import type { QuickJumpTarget } from '../models/bible';
import type { PanelTab } from '../models/tab';
import { normalizeEnglishTerm } from '../services/searchNormalizer';

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const EN_HIGHLIGHT_STOPWORDS = new Set([
  'a', 'an', 'the',
  'and', 'or', 'but', 'nor',
  'in', 'on', 'at', 'to', 'of', 'for', 'by', 'as', 'up',
  'is', 'it', 'be', 'so', 'if', 'no',
]);

const splitQueryTerms = (query: string): string[] => (
  query
    .toLowerCase()
    .split(/[^\p{L}\p{N}']+/u)
    .filter(Boolean)
);

const shouldHighlightTerm = (term: string): boolean => {
  if (!term) {
    return false;
  }

  if (/^\d+$/u.test(term)) {
    return true;
  }

  return !EN_HIGHLIGHT_STOPWORDS.has(term);
};

const collectHighlightCandidates = (query: string): string[] => {
  const phrase = query.toLowerCase();
  const terms = splitQueryTerms(query).filter(shouldHighlightTerm);
  const candidates = new Set<string>(terms.length > 0 ? [phrase, ...terms] : [phrase]);

  // Add normalized English roots so stemmed matches are visually highlighted
  // (e.g. "converse" query highlights "convers" in "conversation").
  for (const term of terms) {
    const normalized = normalizeEnglishTerm(term);
    if (normalized && normalized.length >= 4) {
      candidates.add(normalized);
    }
  }

  return Array.from(candidates).sort((a, b) => b.length - a.length);
};

const highlightText = (
  text: string,
  queryRegex: RegExp | null,
  highlightTerms: Set<string>
): React.ReactNode => {
  if (!queryRegex || highlightTerms.size === 0) return text;
  const parts = text.split(queryRegex);
  return parts.map((part, i) =>
    highlightTerms.has(part.toLowerCase())
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
  }, [tab.updatedAt]);

  if (!searchResults) {
    return null;
  }

  const displayedMatches = searchResults.matches.slice(0, displayedCount);
  const hasMore = displayedCount < searchResults.matches.length;
  const { queryRegex, highlightTerms } = React.useMemo(() => {
    const trimmedQuery = searchResults.query.trim();
    if (!trimmedQuery) {
      return { queryRegex: null, highlightTerms: new Set<string>() };
    }

    const uniqueTerms = collectHighlightCandidates(trimmedQuery);

    return {
      queryRegex: new RegExp(`(${uniqueTerms.map(escapeRegex).join('|')})`, 'gi'),
      highlightTerms: new Set(uniqueTerms),
    };
  }, [searchResults.query]);

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
        <div className="search-results-layout">
          <div className="search-results-main">
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
            <div className="results-grid flex-grow-1 overflow-auto" role="list">
              {displayedMatches.map((match: any) => (
                <div key={match.id} className="results-grid-item" role="listitem">
                  <button
                    type="button"
                    className="card border list-group-item-action text-start search-result-card-button h-100 w-100"
                    onClick={() => {
                      onBeforeNavigate?.();
                      goToReference({
                        book: match.book,
                        chapter: match.chapter,
                        verse: match.verse
                      }, match.translationId);
                    }}
                  >
                    <div className="card-body d-flex flex-column gap-2 h-100 p-3">
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
                        {highlightText(match.text, queryRegex, highlightTerms)}
                      </span>
                    </div>
                  </button>
                </div>
              ))}
              {hasMore && (
                <div
                  ref={sentinelRef}
                  className="results-grid-sentinel text-center text-body-secondary py-2"
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
          <div className="search-results-spacer" aria-hidden="true"></div>
        </div>
      </div>
    </div>
  );
};

export default SearchResults;
