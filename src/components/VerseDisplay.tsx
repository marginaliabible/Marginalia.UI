import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVerseTranslationSwipe } from '../hooks/useVerseTranslationSwipe';
import type { BibleBook, BibleChapter } from '../models/bible';
import MiniSearchBar, { type MiniSearchBarHandle } from './MiniSearchBar';
import type { QuickJumpTarget } from '../models/bible';
import { useResourceTagColors } from '../hooks/useResourceTagColors';
import {
  markupFlagsFromBible,
  renderVerseMarkers,
  stripVerseMarkers,
  type VerseMarkupFlags,
  type VerseMarkupSettings,
} from '../utils/verseMarkup';
import { verseElementId } from '../App';
import {
  isTranslationChapterLoaded,
  missingVerseNotice,
} from '../utils/translationAvailability';

type VerseSelectionMode = 'single' | 'toggle' | 'range' | 'mobile-range' | 'mobile-anchor';

interface VerseDisplayProps {
  chaptersByTranslation: Record<string, BibleChapter | null>;
  markupFlagsByTranslation: Record<string, VerseMarkupFlags>;
  verseMarkupSettings: VerseMarkupSettings;
  translationOrder: string[];
  translationLabels: Record<string, string>;
  selectedTranslationId: string;
  books: BibleBook[];
  availableChapters: BibleChapter[];
  selectedBook: string | null;
  selectedChapter: number;
  isMobileLayout: boolean;
  selectedVerseTranslationId: string | null;
  selectedVerses: number[];
  selectionAnchorVerse: number | null;
  onBookChange: (bookName: string) => void;
  onChapterChange: (chapter: number) => void;
  showPanelToggle?: boolean;
  onOpenPanel?: () => void;
  onVerseNumberClick?: (verse: number) => void;
  onVerseCellSelect?: (verse: number, translationId: string, mode: VerseSelectionMode) => void;
  onCopySelectedVerses: () => Promise<void> | void;
  onShareCurrentVerse: () => Promise<void> | void;
  shareButtonLabel: string;
  starredTranslationIds: string[];
  goToReference: (target: QuickJumpTarget, translationId?: string) => Promise<void>;
  isPanelDetached: boolean;
  miniSearchFocusToken: number;
  onSearchComplete: () => void;
  isMiniSearchVisible: boolean;
  setIsMiniSearchVisible: (open: boolean) => void;
  setIsMobilePanelOpen: (open: boolean) => void;
  resourceVerseTagsByVerse: Map<number, string[]>;
  resourceHiddenTags: string[];
  verseDomBook?: string;
  verseDomChapter?: number;
}
const MAX_INNER_TAGS = 5;

const VerseDisplay: React.FC<VerseDisplayProps> = ({
  chaptersByTranslation,
  markupFlagsByTranslation,
  verseMarkupSettings,
  translationOrder,
  translationLabels,
  selectedTranslationId,
  books,
  availableChapters,
  selectedBook,
  selectedChapter,
  isMobileLayout,
  selectedVerseTranslationId,
  selectedVerses,
  selectionAnchorVerse,
  onBookChange,
  onChapterChange,
  showPanelToggle = false,
  onOpenPanel,
  onVerseNumberClick,
  onVerseCellSelect,
  onCopySelectedVerses,
  onShareCurrentVerse,
  shareButtonLabel,
  starredTranslationIds,
  goToReference,
  isPanelDetached,
  miniSearchFocusToken,
  onSearchComplete,
  isMiniSearchVisible,
  setIsMiniSearchVisible,
  setIsMobilePanelOpen,
  resourceVerseTagsByVerse,
  resourceHiddenTags,
  verseDomBook,
  verseDomChapter,
}) => {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const swipeViewportRef = useRef<HTMLDivElement | null>(null);
  const longPressTimeoutRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const touchMovedRef = useRef(false);
  const touchStartPointRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickUntilRef = useRef(0);
  const [translationWindowStart, setTranslationWindowStart] = useState(0);
  const [layoutWidth, setLayoutWidth] = useState(0);
  const [swipeViewportWidth, setSwipeViewportWidth] = useState(0);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right' | null>(null);
  const [hoveredCell, setHoveredCell] = useState<{ translationId: string; verse: number } | null>(null);
  const [isCtrlLikeDown, setIsCtrlLikeDown] = useState(false);
  const [isShiftDown, setIsShiftDown] = useState(false);
  const [mobileMultiSelectMode, setMobileMultiSelectMode] = useState<{
    translationId: string;
    anchorVerse: number;
  } | null>(null);
  const miniSearchRef = useRef<MiniSearchBarHandle | null>(null);

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

  const swipeEnabled = isMobileLayout
    && visibleTranslationCount > 0
    && translationOrder.length > visibleTranslationCount;
  const swipeColumnWidth = swipeEnabled && visibleTranslationCount > 0 && swipeViewportWidth > 0
    ? swipeViewportWidth / visibleTranslationCount
    : 0;

  const gridStyle = {
    ['--translation-count' as '--translation-count']: String(Math.max(visibleTranslationIds.length, 1)),
    ...(swipeColumnWidth > 0
      ? { ['--verse-swipe-column-width' as '--verse-swipe-column-width']: `${swipeColumnWidth}px` }
      : {}),
  } as React.CSSProperties;

  const hiddenLeftCount = translationWindowStart;
  const hiddenRightCount = Math.max(0, translationOrder.length - (translationWindowStart + visibleTranslationIds.length));

  const shiftWindow = (direction: 'left' | 'right') => {
    setTranslationWindowStart((start) => {
      const maxStart = Math.max(0, translationOrder.length - visibleTranslationCount);
      const nextStart = direction === 'left'
        ? Math.max(0, start - 1)
        : Math.min(maxStart, start + 1);

      if (nextStart !== start && !swipeEnabled) {
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

  useLayoutEffect(() => {
    const viewport = swipeViewportRef.current;
    if (!swipeEnabled || !viewport) {
      setSwipeViewportWidth(0);
      return;
    }

    const measure = () => {
      const next = viewport.getBoundingClientRect().width;
      setSwipeViewportWidth((current) => (Math.abs(current - next) < 0.5 ? current : next));
    };

    measure();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(viewport);

    return () => {
      observer.disconnect();
    };
  }, [swipeEnabled, visibleTranslationCount, layoutWidth]);

  const verseSourceIds = swipeEnabled ? translationOrder : visibleTranslationIds;
  const verseNumbers = Array.from(new Set(
    verseSourceIds.flatMap((translationId) =>
      (chaptersByTranslation[translationId]?.verses ?? []).map((verse) => verse.verse)
    )
  )).sort((a, b) => a - b);

  const hiddenTagSet = useMemo(() => new Set(resourceHiddenTags), [resourceHiddenTags]);

  const resourceTags = useMemo(
    () => Array.from(new Set(Array.from(resourceVerseTagsByVerse.values()).flat())),
    [resourceVerseTagsByVerse]
  );
  const resourceTagColors = useResourceTagColors(resourceTags);

  const selectedVerseSet = useMemo(() => new Set(selectedVerses), [selectedVerses]);

  const shiftPreviewSet = useMemo(() => {
    if (!isShiftDown || !hoveredCell || !selectedVerseTranslationId || selectedVerses.length === 0) {
      return new Set<number>();
    }

    if (hoveredCell.translationId !== selectedVerseTranslationId) {
      return new Set<number>();
    }

    const anchorVerse = selectionAnchorVerse ?? selectedVerses[0] ?? hoveredCell.verse;
    const min = Math.min(anchorVerse, hoveredCell.verse);
    const max = Math.max(anchorVerse, hoveredCell.verse);
    return new Set(Array.from({ length: max - min + 1 }, (_, index) => min + index));
  }, [hoveredCell, isShiftDown, selectedVerseTranslationId, selectedVerses, selectionAnchorVerse]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey) {
        setIsCtrlLikeDown(true);
      }
      if (event.shiftKey) {
        setIsShiftDown(true);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      setIsCtrlLikeDown(event.ctrlKey || event.metaKey);
      setIsShiftDown(event.shiftKey);
    };

    const handleWindowBlur = () => {
      setIsCtrlLikeDown(false);
      setIsShiftDown(false);
      setHoveredCell(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, []);

  useEffect(() => {
    setMobileMultiSelectMode(null);
    if (longPressTimeoutRef.current) {
      window.clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
  }, [selectedBook, selectedChapter]);

  useEffect(() => {
    if (miniSearchFocusToken <= 0) {
      return;
    }

    setIsMiniSearchVisible(true);
    const rafId = window.requestAnimationFrame(() => {
      miniSearchRef.current?.focusInput();
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [miniSearchFocusToken]);

  const handleSearchButtonClick = async () => {
    if (!isMiniSearchVisible) {
      setIsMiniSearchVisible(true);
      window.requestAnimationFrame(() => {
        miniSearchRef.current?.focusInput();
      });
      return;
    }

    await miniSearchRef.current?.triggerPrimaryAction();
  };

  const clearPendingLongPress = () => {
    if (longPressTimeoutRef.current) {
      window.clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
    }
  };

  useVerseTranslationSwipe({
    enabled: swipeEnabled,
    hasVerseGrid: verseNumbers.length > 0,
    shellRef,
    translationWindowStart,
    stride: swipeColumnWidth,
    canGoPrevious: hiddenLeftCount > 0,
    canGoNext: hiddenRightCount > 0,
    onShift: shiftWindow,
    onHorizontalLock: () => {
      touchMovedRef.current = true;
      suppressClickUntilRef.current = Date.now() + 700;
      clearPendingLongPress();
    },
    isBlocked: () => longPressTriggeredRef.current || mobileMultiSelectMode !== null,
  });

  const handleVerseCellClick = (
    event: React.MouseEvent<HTMLSpanElement>,
    translationId: string,
    verse: number
  ) => {
    if (Date.now() < suppressClickUntilRef.current) {
      event.preventDefault();
      return;
    }

    if (mobileMultiSelectMode) {
      event.preventDefault();
      return;
    }

    const mode: VerseSelectionMode = (event.ctrlKey || event.metaKey)
      ? 'toggle'
      : (event.shiftKey ? 'range' : 'single');

    onVerseCellSelect?.(verse, translationId, mode);
  };

  const handleVerseTouchStart = (translationId: string, verse: number) => {
    if (!isMobileLayout) {
      return;
    }

    longPressTriggeredRef.current = false;
    touchMovedRef.current = false;
    clearPendingLongPress();
    longPressTimeoutRef.current = window.setTimeout(() => {
      if (touchMovedRef.current) {
        return;
      }

      longPressTriggeredRef.current = true;
      suppressClickUntilRef.current = Date.now() + 700;
      setMobileMultiSelectMode({ translationId, anchorVerse: verse });
      onVerseCellSelect?.(verse, translationId, 'mobile-anchor');

      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(20);
      }
    }, 450);
  };

  const handleVerseTouchMove = (event: React.TouchEvent<HTMLSpanElement>) => {
    if (!isMobileLayout) {
      return;
    }

    const firstTouch = event.touches[0];
    if (!firstTouch || !touchStartPointRef.current) {
      return;
    }

    const deltaX = firstTouch.clientX - touchStartPointRef.current.x;
    const deltaY = firstTouch.clientY - touchStartPointRef.current.y;
    const moveThreshold = 10;
    if ((deltaX * deltaX) + (deltaY * deltaY) >= moveThreshold * moveThreshold) {
      touchMovedRef.current = true;
      clearPendingLongPress();
    }
  };

  const handleVerseTouchEnd = (
    event: React.TouchEvent<HTMLSpanElement>,
    translationId: string,
    verse: number
  ) => {
    if (!isMobileLayout) {
      return;
    }

    clearPendingLongPress();
    touchStartPointRef.current = null;

    if (touchMovedRef.current) {
      touchMovedRef.current = false;
      return;
    }

    if (longPressTriggeredRef.current) {
      event.preventDefault();
      return;
    }

    if (mobileMultiSelectMode) {
      event.preventDefault();
      if (mobileMultiSelectMode.translationId === translationId) {
        onVerseCellSelect?.(verse, translationId, 'mobile-range');
        setMobileMultiSelectMode(null);
        suppressClickUntilRef.current = Date.now() + 400;
      }
      return;
    }

    onVerseCellSelect?.(verse, translationId, 'single');
    suppressClickUntilRef.current = Date.now() + 400;
    event.preventDefault();
  };

  if (verseNumbers.length === 0) {
    return <p className="text-body-secondary mb-0">Select a chapter to begin.</p>;
  }

  const renderedTranslationIds = swipeEnabled ? translationOrder : visibleTranslationIds;
  const isTranslationColumnVisible = (translationId: string) => {
    const index = translationOrder.indexOf(translationId);
    return index >= translationWindowStart && index < translationWindowStart + visibleTranslationCount;
  };

  const renderColumnLabel = (translationId: string) => {
    const label = translationLabels[translationId] ?? translationId;
    const hiddenFromAssistiveTech = swipeEnabled && !isTranslationColumnVisible(translationId);

    return (
      <span
        key={translationId}
        className="verse-grid-column-label"
        title={label}
        aria-hidden={hiddenFromAssistiveTech ? true : undefined}
      >
        <span className="verse-grid-column-label-text">{label}</span>
      </span>
    );
  };

  const renderVerseCell = (translationId: string, verseNumber: number) => {
    const isTranslationLoaded = isTranslationChapterLoaded(chaptersByTranslation, translationId);
    const verseText =
      chaptersByTranslation[translationId]?.verses.find((verse) => verse.verse === verseNumber)?.text ?? '';
    const markupFlags = markupFlagsByTranslation[translationId] ?? markupFlagsFromBible(null);
    const plainVerseText = verseText ? stripVerseMarkers(verseText, markupFlags) : '';
    const missingNotice = missingVerseNotice(isTranslationLoaded);
    const isMobileAnchor =
      mobileMultiSelectMode?.translationId === translationId
      && mobileMultiSelectMode.anchorVerse === verseNumber;
    const isSelected = !isMobileAnchor && selectedVerseTranslationId === translationId && selectedVerseSet.has(verseNumber);
    const isTranslationEligible =
      selectedVerses.length === 0
      || !selectedVerseTranslationId
      || selectedVerseTranslationId === translationId;
    const isHoverTarget = hoveredCell?.translationId === translationId && hoveredCell?.verse === verseNumber;
    const isCtrlEligible = isHoverTarget && isCtrlLikeDown && isTranslationEligible;
    const isRangePreview = selectedVerseTranslationId === translationId && shiftPreviewSet.has(verseNumber);
    const hiddenFromAssistiveTech = swipeEnabled && !isTranslationColumnVisible(translationId);

    return (
      <span
        key={`${translationId}-${verseNumber}`}
        className={[
          'verse-text',
          isSelected ? 'is-selected' : '',
          isCtrlEligible ? 'is-ctrl-eligible' : '',
          isRangePreview ? 'is-range-preview' : '',
          isMobileAnchor ? 'is-mobile-anchor' : '',
          !plainVerseText && !isTranslationLoaded ? 'is-unloaded' : '',
        ].filter(Boolean).join(' ')}
        data-translation-id={translationId}
        data-verse={verseNumber}
        title={plainVerseText ? undefined : missingNotice}
        aria-hidden={hiddenFromAssistiveTech ? true : undefined}
        onMouseDown={(event) => {
          if (event.shiftKey) {
            event.preventDefault();
          }
        }}
        onClick={(event) => handleVerseCellClick(event, translationId, verseNumber)}
        onMouseEnter={() => setHoveredCell({ translationId, verse: verseNumber })}
        onMouseLeave={() => setHoveredCell((current) => {
          if (!current || current.translationId !== translationId || current.verse !== verseNumber) {
            return current;
          }
          return null;
        })}
        onTouchStart={(event) => {
          const touch = event.touches[0];
          touchStartPointRef.current = touch
            ? { x: touch.clientX, y: touch.clientY }
            : null;
          handleVerseTouchStart(translationId, verseNumber);
        }}
        onTouchMove={handleVerseTouchMove}
        onTouchEnd={(event) => handleVerseTouchEnd(event, translationId, verseNumber)}
      >
        {verseText
          ? renderVerseMarkers(verseText, markupFlags, verseMarkupSettings)
          : (isTranslationLoaded ? '-' : missingNotice)}
      </span>
    );
  };

  const shellClassName = [
    'verse-grid-shell',
    !swipeEnabled && slideDirection ? `is-sliding-${slideDirection}` : '',
    swipeEnabled ? 'is-translation-swipe' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={shellClassName}
      ref={shellRef}
      style={gridStyle}
      data-translation-window-start={translationWindowStart}
      data-swipe-column-width={swipeEnabled && swipeColumnWidth > 0 ? String(swipeColumnWidth) : undefined}
    >
      <div className="verse-grid-header">
        <div className="verse-grid-chapter-heading">
          <div className="verse-grid-search-stage">
            <div className={`verse-grid-search-stage-default ${isMiniSearchVisible ? 'is-hidden' : 'is-visible'}`}>
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
                <div className="verse-grid-heading-control-inline">
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
              </div>
            </div>

            <MiniSearchBar
              ref={miniSearchRef}
              starredTranslationIds={starredTranslationIds}
              goToReference={goToReference}
              isPanelDetached={isPanelDetached}
              isDesktopLayout={!isMobileLayout}
              setIsMobilePanelOpen={setIsMobilePanelOpen}
              isVisible={isMiniSearchVisible}
              onRequestHide={() => setIsMiniSearchVisible(false)}
              onSearchComplete={onSearchComplete}
            />
          </div>

          <div className="verse-grid-heading-actions">
              <button
                type="button"
                className="verse-grid-copy-button"
                aria-label="Search"
                title="Search"
                onClick={() => void handleSearchButtonClick()}
              >
                <i className="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
              </button>
              <button
                type="button"
                className="verse-grid-copy-button"
                aria-label="Copy selected verses (Ctrl+C)"
                title="Copy selected verses (Ctrl+C)"
                onClick={() => void onCopySelectedVerses()}
              >
                <i className="fa-regular fa-copy" aria-hidden="true"></i>
              </button>
              <button
                type="button"
                className="verse-grid-copy-button"
                aria-label={shareButtonLabel}
                title={shareButtonLabel}
                onClick={() => void onShareCurrentVerse()}
              >
                <i className="fa-solid fa-share-from-square" aria-hidden="true"></i>
              </button>
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
          {swipeEnabled ? (
            <div className="verse-grid-swipe-viewport" ref={swipeViewportRef}>
              <div className="verse-grid-swipe-track">
                {renderedTranslationIds.map((translationId) => renderColumnLabel(translationId))}
              </div>
            </div>
          ) : (
            renderedTranslationIds.map((translationId) => renderColumnLabel(translationId))
          )}
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
            id={verseElementId(verseDomBook, verseDomChapter, verseNumber)}
            className="verse-grid-row"
            role="listitem"
          >
            <span className="verse-number-wrap">
              <VerseResourceDonut
                verseNumber={verseNumber}
                tags={(resourceVerseTagsByVerse.get(verseNumber) ?? []).filter((tag) => !hiddenTagSet.has(tag))}
                colors={(resourceVerseTagsByVerse.get(verseNumber) ?? [])
                  .filter((tag) => !hiddenTagSet.has(tag))
                  .map((tag) => resourceTagColors.get(tag) ?? '#6c757d')}
                onVerseNumberClick={() => onVerseNumberClick?.(verseNumber)}
              />
            </span>
            {swipeEnabled ? (
              <div className="verse-grid-swipe-viewport">
                <div className="verse-grid-swipe-track">
                  {renderedTranslationIds.map((translationId) => renderVerseCell(translationId, verseNumber))}
                </div>
              </div>
            ) : (
              renderedTranslationIds.map((translationId) => renderVerseCell(translationId, verseNumber))
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

const VerseResourceDonut: React.FC<{
  verseNumber: number;
  tags: string[];
  colors: string[];
  onVerseNumberClick: () => void;
}> = ({ verseNumber, tags, colors, onVerseNumberClick }) => {
  const visibleTags = tags.slice(0, MAX_INNER_TAGS);
  const extraCount = Math.max(0, tags.length - MAX_INNER_TAGS);
  const title = tags.length > 0
    ? `Resources tagged: ${tags.join(', ')}${extraCount > 0 ? ` (+${extraCount} more)` : ''}`
    : `Verse ${verseNumber}`;

  const donutStyle = tags.length > 0
    ? {
        ["--resource-donut-gradient" as "--resource-donut-gradient"]: buildEqualSliceGradient(
          visibleTags.map((tag) => colors[tags.indexOf(tag)] ?? '#6c757d')
        ),
      } as React.CSSProperties
    : undefined;

  return (
    <span className="verse-resource-donut-wrap" title={title} aria-label={title}>
      <span
        className={`verse-resource-donut${tags.length === 0 ? ' is-empty' : ''}`}
        style={donutStyle}
        aria-hidden="true"
      ></span>
      <a
        href="#"
        className="verse-resource-verse-number"
        onClick={(event) => {
          event.preventDefault();
          onVerseNumberClick();
        }}
        aria-label={`Verse ${verseNumber}`}
        title={title}
      >
        {verseNumber}
      </a>
      {extraCount > 0 && (
        <span className="verse-resource-more" aria-hidden="true" title={`${extraCount} additional tags`}>
          +
        </span>
      )}
    </span>
  );
};

function buildEqualSliceGradient(colors: string[]): string {
  const segmentCount = Math.max(1, colors.length);
  const segmentSize = 100 / segmentCount;

  return `conic-gradient(${colors
    .map((color, index) => {
      const start = index * segmentSize;
      const end = (index + 1) * segmentSize;
      return `${color} ${start}%, ${color} ${end}%`;
    })
    .join(', ')})`;
}

export default VerseDisplay;