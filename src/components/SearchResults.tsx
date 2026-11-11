import React, { useEffect, useRef } from 'react';
import type { QuickJumpTarget } from '../models/bible';
import type { PanelTab } from '../models/tab';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { openDocumentViewer } from '../store/slices/uiSlice';
import { routeInteraction } from '../services/windowRouting';
import type { OpenDocumentPayload } from '../models/windowMessages';
import { buildMarkupDocumentShellUrl } from '../utils/resourceLibraryConfig';
import { searchResourceDocumentTitles, type ResourceDocumentTitleSearchResultSet } from '../services/resourceLibrarySearchService';
import { normalizeEnglishTerm } from '../services/searchNormalizer';
import { isNewTestamentBook } from '../utils/book-aliases';
import { useSourcePreferences } from '../hooks/useSourcePreferences';
import { subscriptionItemFromResource } from '../utils/accountSyncTarget';

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
type SearchViewMode = 'scripture' | 'documents';

const SearchResults: React.FC<SearchResultsProps> = ({ tab, goToReference, onBeforeNavigate }) => {
  const dispatch = useAppDispatch();
  const { sourceUrls } = useAppSelector((state) => state.ui);
  const sourcePreferences = useSourcePreferences();
  const searchResults = tab.searchResults;
  const [displayedCount, setDisplayedCount] = React.useState(PAGE_SIZE);
  const [searchView, setSearchView] = React.useState<SearchViewMode>('scripture');
  const [documentResults, setDocumentResults] = React.useState<ResourceDocumentTitleSearchResultSet | null>(null);
  const [isDocumentSearchLoading, setIsDocumentSearchLoading] = React.useState(false);
  const [documentSearchError, setDocumentSearchError] = React.useState<string | null>(null);
  const [showOldTestament, setShowOldTestament] = React.useState(true);
  const [showNewTestament, setShowNewTestament] = React.useState(true);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const searchQuery = searchResults?.query ?? '';
  const { queryRegex, highlightTerms } = React.useMemo(() => {
    const trimmedQuery = searchQuery.trim();
    if (!trimmedQuery) {
      return { queryRegex: null, highlightTerms: new Set<string>() };
    }

    const uniqueTerms = collectHighlightCandidates(trimmedQuery);

    return {
      queryRegex: new RegExp(`(${uniqueTerms.map(escapeRegex).join('|')})`, 'gi'),
      highlightTerms: new Set(uniqueTerms),
    };
  }, [searchQuery]);

  useEffect(() => {
    setDisplayedCount(PAGE_SIZE);
    setSearchView('scripture');
    setDocumentResults(null);
    setDocumentSearchError(null);
    setIsDocumentSearchLoading(false);
    setShowOldTestament(true);
    setShowNewTestament(true);
  }, [tab.updatedAt]);

  useEffect(() => {
    if (!searchResults || searchView !== 'documents') {
      return;
    }

    let cancelled = false;

    const loadDocumentResults = async () => {
      setIsDocumentSearchLoading(true);
      setDocumentSearchError(null);

      try {
        const nextResults = await searchResourceDocumentTitles(searchResults.query, sourceUrls, sourcePreferences);
        if (!cancelled) {
          setDocumentResults(nextResults);
        }
      } catch (error) {
        if (!cancelled) {
          setDocumentResults(null);
          setDocumentSearchError(error instanceof Error ? error.message : 'Failed to search document titles');
        }
      } finally {
        if (!cancelled) {
          setIsDocumentSearchLoading(false);
        }
      }
    };

    void loadDocumentResults();

    return () => {
      cancelled = true;
    };
  }, [searchView, searchResults?.query, sourceUrls, sourcePreferences]);

  useEffect(() => {
    setDisplayedCount(PAGE_SIZE);
  }, [searchView]);

  if (!searchResults) {
    return null;
  }

  const verseMatchList = searchResults.matches.filter((match) => (
    isNewTestamentBook(match.book) ? showNewTestament : showOldTestament
  ));
  const displayedVerseMatches = verseMatchList.slice(0, displayedCount);
  const documentMatchList = documentResults?.matches ?? [];
  const displayedDocumentMatches = documentMatchList.slice(0, displayedCount);
  const activeMatchCount = searchView === 'documents' ? documentMatchList.length : verseMatchList.length;
  const hasMore = displayedCount < activeMatchCount;

  const handleOpenDocument = (match: NonNullable<typeof displayedDocumentMatches>[number]) => {
    onBeforeNavigate?.();
    const kind = match.viewer === 'markup' ? 'markup' : 'pdf';
    const payload: OpenDocumentPayload = {
      sourceUrl: kind === 'markup' ? buildMarkupDocumentShellUrl(match.url) : match.url,
      page: 1,
      title: match.title,
      matchRaws: [],
      kind,
      syncItem: match.cloudProvider ? { provider: match.cloudProvider, itemId: match.documentId } : null,
      subscriptionItem: subscriptionItemFromResource({
        cloudProvider: match.cloudProvider,
        libraryKey: match.libraryKey,
        resourceKey: match.resourceKey,
      }),
    };
    routeInteraction(
      { kind: 'document', type: 'open-document', payload },
      () => dispatch(openDocumentViewer(payload))
    );
  };

  // Auto-load more results when user scrolls near the bottom
  useEffect(() => {
    if (!hasMore || !sentinelRef.current) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setDisplayedCount((count) => Math.min(count + PAGE_SIZE, activeMatchCount));
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
  }, [hasMore, searchView, activeMatchCount]);

  const summaryText = searchView === 'documents'
    ? (isDocumentSearchLoading
      ? `Searching document titles for "${searchResults.query}" in your resource libraries...`
      : `${documentResults?.total ?? 0} document title match${(documentResults?.total ?? 0) === 1 ? '' : 'es'}${documentResults?.limited ? ` (showing first ${documentMatchList.length})` : ''} for "${searchResults.query}" in your resource libraries.`)
    : `${searchResults.total} match${searchResults.total === 1 ? '' : 'es'}${searchResults.limited ? ` (showing first ${searchResults.matches.length})` : ''} for "${searchResults.query}" in your starred translations.`;

  return (
    <div className="card border-0 shadow-sm search-results-card">
      <div className="card-body d-flex flex-column gap-3 search-results-body">
        <div className="search-results-layout">
          <div className="search-results-main">
            <div>
              <h3 className="h6 text-uppercase mb-1">Search Results</h3>
              <div className="d-flex flex-column gap-1">
                <p className="text-body-secondary results-summary mb-0">{summaryText}</p>
                <div className="search-results-actions">
                  <button
                    type="button"
                    className="btn btn-link p-0 small text-decoration-none"
                    data-help="search-document-titles"
                    onClick={() => setSearchView((mode) => (mode === 'scripture' ? 'documents' : 'scripture'))}
                  >
                    {searchView === 'scripture' ? 'Search document titles' : 'Search in scriptures'}
                  </button>
                  <div
                    className="btn-group search-testament-toggle-group"
                    role="group"
                    aria-label="Scripture testament filters"
                    data-help="search-testament-toggles"
                  >
                    <button
                      type="button"
                      className={`btn btn-sm ${showOldTestament ? 'btn-primary' : 'btn-outline-primary'}`}
                      aria-pressed={showOldTestament}
                      title="Toggle Old Testament"
                      aria-label="Toggle Old Testament"
                      data-help="search-ot"
                      onClick={() => {
                        setShowOldTestament((show) => (show && !showNewTestament ? show : !show));
                      }}
                    >
                      OT
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm ${showNewTestament ? 'btn-primary' : 'btn-outline-primary'}`}
                      aria-pressed={showNewTestament}
                      title="Toggle New Testament"
                      aria-label="Toggle New Testament"
                      data-help="search-nt"
                      onClick={() => {
                        setShowNewTestament((show) => (show && !showOldTestament ? show : !show));
                      }}
                    >
                      NT
                    </button>
                  </div>
                </div>
              </div>
            </div>
            {searchView === 'documents' ? (
              <>
                {documentSearchError && (
                  <p className="text-danger small mb-0">{documentSearchError}</p>
                )}
                {isDocumentSearchLoading ? (
                  <p className="text-body-secondary small mb-0">Searching document titles...</p>
                ) : (
                  <>
                    <div className="results-grid flex-grow-1 overflow-auto" role="list">
                      {displayedDocumentMatches.map((match) => (
                        <div key={match.id} className="results-grid-item" role="listitem">
                          <button
                            type="button"
                            className="card border list-group-item-action text-start search-result-card-button h-100 w-100"
                            onClick={() => handleOpenDocument(match)}
                          >
                            <div className="card-body d-flex flex-column gap-2 h-100 p-3">
                              <span className="match-reference d-block">
                                {highlightText(match.title, queryRegex, highlightTerms)}
                              </span>
                              <span className="match-text d-block text-body-secondary">
                                {match.libraryLabel}
                                {match.tags.length > 0 && (
                                  <> · {match.tags.join(', ')}</>
                                )}
                              </span>
                            </div>
                          </button>
                        </div>
                      ))}
                      {!isDocumentSearchLoading && documentMatchList.length === 0 && (
                        <div className="text-body-secondary small py-2">No document titles matched this search.</div>
                      )}
                      {hasMore && (
                        <div
                          ref={sentinelRef}
                          className="results-grid-sentinel text-center text-body-secondary py-2 small"
                        >
                          Loading more...
                        </div>
                      )}
                    </div>
                    {hasMore && (
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-primary w-100"
                        onClick={() => setDisplayedCount((count) => Math.min(count + PAGE_SIZE, documentMatchList.length))}
                      >
                        Load more results ({displayedCount} of {documentMatchList.length})
                      </button>
                    )}
                  </>
                )}
              </>
            ) : (
              <>
                <div className="results-grid flex-grow-1 overflow-auto" role="list">
                  {displayedVerseMatches.map((match) => (
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
                        <div className="card-body d-flex flex-column gap-2 h-100 p-3" data-help="search-results">
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
                      className="results-grid-sentinel text-center text-body-secondary py-2 small"
                    >
                      Loading more...
                    </div>
                  )}
                </div>
                {hasMore && (
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-primary w-100"
                    onClick={() => setDisplayedCount((count) => Math.min(count + PAGE_SIZE, verseMatchList.length))}
                  >
                    Load more results ({displayedCount} of {verseMatchList.length})
                  </button>
                )}
              </>
            )}
          </div>
          <div className="search-results-spacer" aria-hidden="true"></div>
        </div>
      </div>
    </div>
  );
};

export default SearchResults;
