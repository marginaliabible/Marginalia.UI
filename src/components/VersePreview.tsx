import React from 'react';
import type { VerseContext } from '../models/tab';
import { formatVerseReference } from '../utils/selectedVerseContext';
import { MAX_PANEL_VISIBLE_VERSES } from '../utils/documentTextMatch';
import {
  renderVerseMarkers,
  type VerseMarkupFlags,
  type VerseMarkupSettings,
} from '../utils/verseMarkup';

interface VerseReferenceLabelProps {
  verseContext: VerseContext;
  className?: string;
  /** Makes the reference a link, e.g. to show the verse in the Bible window. */
  onClick?: () => void;
}

export const VerseReferenceLabel: React.FC<VerseReferenceLabelProps> = ({
  verseContext,
  className,
  onClick,
}) => {
  const reference = formatVerseReference(verseContext);
  if (!onClick) {
    return <span className={className}>{reference}</span>;
  }

  return (
    <a
      href="#"
      role="button"
      className={className}
      onClick={(event) => {
        event.preventDefault();
        onClick();
      }}
      title={`Show ${reference} in the Bible window`}
    >
      {reference}
    </a>
  );
};

interface VerseTextListProps {
  verses: Array<{ verse: number; text: string }>;
  emptyText?: string;
  markupFlags?: VerseMarkupFlags;
  verseMarkupSettings?: VerseMarkupSettings;
  /** Total verses in the selection (may exceed `verses.length` when truncated for display). */
  totalVerseCount?: number;
  maxVisibleVerses?: number;
  onOverflowClick?: () => void;
}

const DEFAULT_MARKUP_SETTINGS: VerseMarkupSettings = {
  italics: true,
  paragraphMarks: true,
};

export const VerseTextList: React.FC<VerseTextListProps> = ({
  verses,
  emptyText,
  markupFlags = {},
  verseMarkupSettings = DEFAULT_MARKUP_SETTINGS,
  totalVerseCount,
  maxVisibleVerses = MAX_PANEL_VISIBLE_VERSES,
  onOverflowClick,
}) => {
  const available = verses.filter((entry) => entry.text.length > 0);
  if (available.length === 0 && verses.length === 0) {
    return (
      <span className="text-muted">
        {emptyText ?? 'Verse text unavailable in current translation.'}
      </span>
    );
  }

  const totalCount = totalVerseCount ?? verses.length;
  const showOverflow = totalCount > maxVisibleVerses;
  const visibleVerses = showOverflow ? verses.slice(0, maxVisibleVerses) : verses;

  if (visibleVerses.length === 1 && !showOverflow) {
    return <>{renderVerseMarkers(visibleVerses[0].text, markupFlags, verseMarkupSettings)}</>;
  }

  return (
    <div className="verse-text-list">
      {visibleVerses.map((entry) => (
        <div key={entry.verse} className="verse-text-list-item">
          <span className="verse-text-list-number">{entry.verse}</span>
          {' '}
          {entry.text
            ? renderVerseMarkers(entry.text, markupFlags, verseMarkupSettings)
            : (
              <span className="text-muted">Not available in this translation</span>
            )}
        </div>
      ))}
      {showOverflow && (
        <div className="verse-text-list-overflow">
          {onOverflowClick ? (
            <button
              type="button"
              className="btn btn-link btn-sm p-0 verse-text-list-overflow-button"
              onClick={onOverflowClick}
              title="Open the first verse in the Bible panel"
            >
              ...
            </button>
          ) : (
            <span className="verse-text-list-overflow-static">...</span>
          )}
        </div>
      )}
    </div>
  );
};
