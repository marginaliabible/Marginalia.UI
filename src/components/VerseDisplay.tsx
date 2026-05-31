import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { BibleBook, BibleChapter } from '../models/bible';

interface VerseDisplayProps {
  chaptersByTranslation: Record<string, BibleChapter | null>;
  translationOrder: string[];
  translationLabels: Record<string, string>;
  selectedTranslationId: string;
  books: BibleBook[];
  availableChapters: BibleChapter[];
  selectedBook: string | null;
  selectedChapter: number;
  focusVerse: number | null;
  onBookChange: (bookName: string) => void;
  onChapterChange: (chapter: number) => void;
  showPanelToggle?: boolean;
  onOpenPanel?: () => void;
  onVerseClick?: (verse: number) => void;
  verseDomId: (book: string, chapter: number, verse: number) => string;
}

const VerseDisplay: React.FC<VerseDisplayProps> = ({
  chaptersByTranslation,
  translationOrder,
  translationLabels,
  selectedTranslationId,
  books,
  availableChapters,
  selectedBook,
  selectedChapter,
  focusVerse,
  onBookChange,
  onChapterChange,
  showPanelToggle = false,
  onOpenPanel,
  onVerseClick,
  verseDomId,
}) => {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [translationWindowStart, setTranslationWindowStart] = useState(0);
  const [layoutWidth, setLayoutWidth] = useState(0);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right' | null>(null);

  const resolveCssLength = (value: string): number => {
    const trimmed = value.trim();
    if (!trimmed) {
      return 0;
    }

    if (trimmed.endsWith('rem')) {
      const rootFontSize = typeof window !== 'undefined'
        ? Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize)
        : 16;
      return Number.parseFloat(trimmed) * rootFontSize;
    }

    if (trimmed.endsWith('px')) {
      return Number.parseFloat(trimmed);
    }

    return Number.parseFloat(trimmed) || 0;
  };

  useLayoutEffect(() => {
    const measureLayout = () => {
      const shell = shellRef.current;
      if (!shell) {
        return;
      }

      const styles = window.getComputedStyle(shell);
      const width = shell.getBoundingClientRect().width;
      const endPadding = resolveCssLength(styles.getPropertyValue('--verse-grid-inline-padding-end'));
      setLayoutWidth(Math.max(0, width - endPadding));
    };

    measureLayout();

    const shell = shellRef.current;
    if (!shell || typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measureLayout);
      return () => window.removeEventListener('resize', measureLayout);
    }

    const observer = new ResizeObserver(() => {
      measureLayout();
    });
    observer.observe(shell);

    const rafId = window.requestAnimationFrame(() => {
      measureLayout();
    });

    const timeoutId = window.setTimeout(() => {
      measureLayout();
    }, 180);

    const fontsReady = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready;
    if (fontsReady) {
      void fontsReady.then(() => {
        measureLayout();
      });
    }

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timeoutId);
    };
  }, [chaptersByTranslation]);

  const visibleTranslationCount = useMemo(() => {
    const styles = shellRef.current ? window.getComputedStyle(shellRef.current) : null;
    const verseWidth = resolveCssLength(styles?.getPropertyValue('--verse-grid-verse-width') ?? '2.25rem');
    const translationWidth = resolveCssLength(styles?.getPropertyValue('--verse-grid-translation-min-width') ?? '15.6rem');
    const columnGap = resolveCssLength(styles?.getPropertyValue('--verse-grid-column-gap') ?? '0.85rem');

    if (translationOrder.length === 0) {
      return 0;
    }

    const availableWidth = Math.max(0, layoutWidth - verseWidth);
    const fitCount = Math.floor((availableWidth + columnGap) / (translationWidth + columnGap));
    return Math.max(1, Math.min(translationOrder.length, fitCount > 0 ? fitCount : 1));
  }, [layoutWidth, translationOrder.length]);

  useEffect(() => {
    if (translationOrder.length === 0) {
      setTranslationWindowStart(0);
      return;
    }

    setTranslationWindowStart((currentStart) => {
      const maxStart = Math.max(0, translationOrder.length - visibleTranslationCount);
      const selectedIndex = Math.max(0, translationOrder.indexOf(selectedTranslationId));

      let nextStart = currentStart;
      const currentEnd = currentStart + visibleTranslationCount - 1;

      if (selectedIndex < currentStart) {
        nextStart = selectedIndex;
      } else if (selectedIndex > currentEnd) {
        nextStart = selectedIndex - visibleTranslationCount + 1;
      }

      return Math.max(0, Math.min(nextStart, maxStart));
    });
  }, [selectedTranslationId, translationOrder, visibleTranslationCount]);

  const visibleTranslationIds = useMemo(() => {
    return translationOrder.slice(
      translationWindowStart,
      translationWindowStart + visibleTranslationCount
    );
  }, [translationOrder, translationWindowStart, visibleTranslationCount]);

  const gridStyle = {
    ['--translation-count' as '--translation-count']: String(Math.max(visibleTranslationIds.length, 1))
  } as React.CSSProperties;

  const hiddenLeftCount = translationWindowStart;
  const hiddenRightCount = Math.max(0, translationOrder.length - (translationWindowStart + visibleTranslationIds.length));

  const shiftWindow = (direction: 'left' | 'right') => {
    setTranslationWindowStart((start) => {
      const maxStart = Math.max(0, translationOrder.length - visibleTranslationCount);
      const nextStart = direction === 'left'
        ? Math.max(0, start - 1)
        : Math.min(maxStart, start + 1);

      if (nextStart !== start) {
        setSlideDirection(direction);
      }

      return nextStart;
    });
  };

  useEffect(() => {
    if (!slideDirection) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setSlideDirection(null);
    }, 180);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [slideDirection]);

  const verseNumbers = Array.from(new Set(
    visibleTranslationIds.flatMap((translationId) =>
      (chaptersByTranslation[translationId]?.verses ?? []).map((verse) => verse.verse)
    )
  )).sort((a, b) => a - b);

  if (verseNumbers.length === 0) {
    return <p className="text-body-secondary mb-0">Select a chapter to begin.</p>;
  }

  return (
    <div
      className={`verse-grid-shell ${slideDirection ? `is-sliding-${slideDirection}` : ''}`}
      ref={shellRef}
      style={gridStyle}
    >
      <div className="verse-grid-header">
        <div className="verse-grid-chapter-heading">
          <div className="verse-grid-heading-control verse-grid-heading-control-book">
            <label className="verse-grid-heading-label" htmlFor="verse-grid-book-select">
              Book
            </label>
            <select
              id="verse-grid-book-select"
              className="form-select form-select-sm verse-grid-heading-select w-auto"
              value={selectedBook ?? ''}
              onChange={(event) => onBookChange(event.target.value)}
            >
              {books.map((book) => (
                <option key={book.name} value={book.name}>
                  {book.name}
                </option>
              ))}
            </select>
          </div>
          <div className="verse-grid-heading-control verse-grid-heading-control-chapter">
            <label className="verse-grid-heading-label" htmlFor="verse-grid-chapter-select">
              Chapter
            </label>
            <select
              id="verse-grid-chapter-select"
              className="form-select form-select-sm verse-grid-heading-select w-auto"
              value={selectedChapter}
              onChange={(event) => onChapterChange(Number.parseInt(event.target.value, 10))}
            >
              {availableChapters.map((chapter) => (
                <option key={chapter.chapter} value={chapter.chapter}>
                  {chapter.chapter}
                </option>
              ))}
            </select>
          </div>
          {showPanelToggle && (
            <div className="verse-grid-panel-toggle-wrap">
              <button
                type="button"
                className="verse-grid-panel-toggle"
                aria-label="Open side panel"
                aria-controls="workspace-side-panel"
                onClick={() => onOpenPanel?.()}
              >
                <i className="bi bi-list" aria-hidden="true"></i>
              </button>
            </div>
          )}
        </div>
        <div className="verse-grid-column-headers-row">
          {hiddenLeftCount > 0 && (
            <button
              type="button"
              className="verse-grid-column-shift verse-grid-column-shift-left"
              aria-label="Show previous translations"
              onClick={() => shiftWindow('left')}
            >
              <i className="bi bi-chevron-left" aria-hidden="true"></i>
            </button>
          )}
          <span className="verse-grid-verse-label" aria-hidden="true"></span>
          {visibleTranslationIds.map((translationId) => {
            const label = translationLabels[translationId] ?? translationId;

            return (
              <span
                key={translationId}
                className="verse-grid-column-label"
                title={label}
              >
                <span className="verse-grid-column-label-text">{label}</span>
              </span>
            );
          })}
          {hiddenRightCount > 0 && (
            <button
              type="button"
              className="verse-grid-column-shift verse-grid-column-shift-right"
              aria-label="Show next translations"
              onClick={() => shiftWindow('right')}
            >
              <i className="bi bi-chevron-right" aria-hidden="true"></i>
            </button>
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
            <a
              href="#"
              className="verse-number"
              onClick={(event) => {
                event.preventDefault();
                onVerseClick?.(verseNumber);
              }}
              aria-label={`Verse ${verseNumber}`}
              title={`Verse ${verseNumber}`}
            >
              {verseNumber}
            </a>
            {visibleTranslationIds.map((translationId) => {
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
