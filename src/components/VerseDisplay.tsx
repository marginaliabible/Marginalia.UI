import React from 'react';
import type { BibleChapter } from '../models/bible';

interface VerseDisplayProps {
  chaptersByTranslation: Record<string, BibleChapter | null>;
  translationOrder: string[];
  translationLabels: Record<string, string>;
  selectedBook: string | null;
  selectedChapter: number;
  focusVerse: number | null;
  showTranslationTags: boolean;
  onCloseTranslation: (translationId: string) => void;
  onOpenTranslationSelector?: () => void;
  verseDomId: (book: string, chapter: number, verse: number) => string;
  chapterName?: string;
}

const VerseDisplay: React.FC<VerseDisplayProps> = ({
  chaptersByTranslation,
  translationOrder,
  translationLabels,
  selectedBook,
  selectedChapter,
  focusVerse,
  showTranslationTags,
  onCloseTranslation,
  onOpenTranslationSelector,
  verseDomId,
  chapterName,
}) => {
  const gridStyle = {
    ['--translation-count' as '--translation-count']: String(Math.max(translationOrder.length, 1))
  } as React.CSSProperties;

  const verseNumbers = Array.from(new Set(
    translationOrder.flatMap((translationId) =>
      (chaptersByTranslation[translationId]?.verses ?? []).map((verse) => verse.verse)
    )
  )).sort((a, b) => a - b);

  if (verseNumbers.length === 0) {
    return <p className="text-body-secondary mb-0">Select a chapter to begin.</p>;
  }

  return (
    <div
      className="verse-grid-shell"
      style={gridStyle}
    >
      <div className="verse-grid-header">
        {chapterName && (
          <div className="verse-grid-chapter-heading" aria-hidden="true">
            {chapterName}
          </div>
        )}
        <div
          className="verse-grid-column-headers-row"
          aria-hidden="true"
        >
          <span className="verse-grid-verse-label"></span>
          {showTranslationTags ? (
            translationOrder.map((translationId, index) => {
              const label = translationLabels[translationId] ?? translationId;
              const chipText = `${translationId}: ${label}`;
              const showAddButton = Boolean(onOpenTranslationSelector) && index === translationOrder.length - 1;
              return (
                <span
                  key={translationId}
                  className={`verse-grid-column-label verse-grid-column-tag ${showAddButton ? 'has-add-button' : ''}`}
                  role="listitem"
                >
                  <span className="translation-chip" title={chipText}>
                    <span className="translation-chip-label" aria-label={chipText}>
                      {chipText}
                    </span>
                    <button
                      type="button"
                      className="translation-chip-close"
                      onClick={() => onCloseTranslation(translationId)}
                      aria-label={`Close ${translationId}`}
                      tabIndex={0}
                    >
                      x
                    </button>
                  </span>
                  {showAddButton && (
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-primary verse-grid-add-translation"
                      onClick={onOpenTranslationSelector}
                      aria-label="Add or remove translations"
                      title="Add or remove translations"
                    >
                      +
                    </button>
                  )}
                </span>
              );
            })
          ) : (
            translationOrder.map((translationId, index) => {
              const label = translationLabels[translationId] ?? translationId;
              const showAddButton = Boolean(onOpenTranslationSelector) && index === translationOrder.length - 1;

              return (
                <span
                  key={translationId}
                  className={`verse-grid-column-label ${showAddButton ? 'has-add-button' : ''}`}
                  title={label}
                >
                  <span className="verse-grid-column-label-text">{label}</span>
                  {showAddButton && (
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-primary verse-grid-add-translation"
                      onClick={onOpenTranslationSelector}
                      aria-label="Add or remove translations"
                      title="Add or remove translations"
                    >
                      +
                    </button>
                  )}
                </span>
              );
            })
          )}
        </div>
      </div>
      <div className="verse-grid-rows" role="list">
        {verseNumbers.map((verseNumber) => (
          <div
            key={verseNumber}
            id={verseDomId(selectedBook ?? '', selectedChapter, verseNumber)}
            className={`verse-grid-row ${focusVerse === verseNumber ? 'is-focused' : ''}`}
            role="listitem"
          >
            <span className="verse-number">{verseNumber}</span>
            {translationOrder.map((translationId) => {
              const verseText =
                chaptersByTranslation[translationId]?.verses.find((verse) => verse.verse === verseNumber)?.text ?? '';

              return (
                <span key={`${translationId}-${verseNumber}`} className="verse-text">
                  {verseText || '-'}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

export default VerseDisplay;
