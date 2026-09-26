import React from 'react';
import type { VerseContext } from '../models/tab';
import { formatVerseReference } from '../utils/selectedVerseContext';

interface VerseReferenceLabelProps {
  verseContext: VerseContext;
  className?: string;
}

export const VerseReferenceLabel: React.FC<VerseReferenceLabelProps> = ({
  verseContext,
  className,
}) => (
  <span className={className}>{formatVerseReference(verseContext)}</span>
);

interface VerseTextListProps {
  verses: Array<{ verse: number; text: string }>;
  emptyText?: string;
}

export const VerseTextList: React.FC<VerseTextListProps> = ({ verses, emptyText }) => {
  const available = verses.filter((entry) => entry.text.length > 0);
  if (available.length === 0) {
    return (
      <span className="text-muted">
        {emptyText ?? 'Verse text unavailable in current translation.'}
      </span>
    );
  }

  if (verses.length === 1) {
    return <>{verses[0].text}</>;
  }

  return (
    <div className="verse-text-list">
      {verses.map((entry) => (
        <div key={entry.verse} className="verse-text-list-item">
          <span className="verse-text-list-number">{entry.verse}</span>
          {' '}
          {entry.text || (
            <span className="text-muted">Not available in this translation</span>
          )}
        </div>
      ))}
    </div>
  );
};
