import React from 'react';

interface SearchResultsProps {
  searchResults: any;
  goToReference: (target: any) => void;
}

const SearchResults: React.FC<SearchResultsProps> = ({ searchResults, goToReference }) => (
  <div className="card border-0 shadow-sm h-100">
    <div className="card-body d-flex flex-column gap-3">
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
      <div className="list-group results-list">
        {searchResults.matches.map((match: any) => (
          <button
            key={match.id}
            type="button"
            className="list-group-item list-group-item-action text-start"
            onClick={() =>
              goToReference({
                book: match.book,
                chapter: match.chapter,
                verse: match.verse
              })
            }
          >
            <span className="match-reference d-block">
              {match.book} {match.chapter}:{match.verse}
            </span>
            <span className="match-text d-block text-body-secondary">
              {match.text}
            </span>
          </button>
        ))}
      </div>
    </div>
  </div>
);

export default SearchResults;
