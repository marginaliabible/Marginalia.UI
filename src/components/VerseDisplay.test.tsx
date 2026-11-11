import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import VerseDisplay from './VerseDisplay';
import type { BibleChapter } from '../models/bible';
import { TRANSLATION_NOT_YET_LOADED, VERSE_NOT_AVAILABLE } from '../utils/translationAvailability';

jest.mock('./MiniSearchBar', () => ({
  __esModule: true,
  default: () => null,
}));

const kjvChapter: BibleChapter = {
  chapter: 1,
  verses: [{ verse: 1, text: 'In the beginning God created the heaven and the earth.' }],
};

const noop = () => {};
const asyncNoop = async () => {};

function renderVerseDisplay(
  chaptersByTranslation: Record<string, BibleChapter | null>,
  overrides: Partial<ComponentProps<typeof VerseDisplay>> = {},
) {
  return render(
    <VerseDisplay
      chaptersByTranslation={chaptersByTranslation}
      markupFlagsByTranslation={{}}
      verseMarkupSettings={{ italics: true, paragraphMarks: true }}
      translationOrder={['KJV', 'ASV']}
      translationLabels={{ KJV: 'King James', ASV: 'American Standard' }}
      selectedTranslationId="KJV"
      books={[{ name: 'Genesis', chapters: [kjvChapter] }]}
      availableChapters={[kjvChapter]}
      selectedBook="Genesis"
      selectedChapter={1}
      isMobileLayout={false}
      selectedVerseTranslationId={null}
      selectedVerses={[]}
      selectionAnchorVerse={null}
      onBookChange={noop}
      onChapterChange={noop}
      onCopySelectedVerses={asyncNoop}
      onShareCurrentVerse={asyncNoop}
      shareButtonLabel="Share"
      starredTranslationIds={['KJV', 'ASV']}
      goToReference={asyncNoop}
      isPanelDetached={false}
      miniSearchFocusToken={0}
      onSearchComplete={noop}
      isMiniSearchVisible={false}
      setIsMiniSearchVisible={noop}
      setIsMobilePanelOpen={noop}
      resourceVerseTagsByVerse={new Map()}
      resourceHiddenTags={[]}
      verseDomBook="Genesis"
      verseDomChapter={1}
      {...overrides}
    />
  );
}

describe('VerseDisplay missing translation copy', () => {
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;

  beforeEach(() => {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    window.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
    Element.prototype.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      width: 900,
      height: 600,
      top: 0,
      left: 0,
      bottom: 600,
      right: 900,
      toJSON: () => ({}),
    });
  });

  afterEach(() => {
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  it('says the translation has not yet loaded when the chapter is still missing', () => {
    renderVerseDisplay({ KJV: kjvChapter });

    const pendingCell = document.querySelector('[data-translation-id="ASV"]');
    expect(pendingCell).not.toBeNull();
    expect(pendingCell?.textContent).toBe(TRANSLATION_NOT_YET_LOADED);
    expect(pendingCell?.getAttribute('title')).toBe(TRANSLATION_NOT_YET_LOADED);
    expect(screen.queryByTitle(VERSE_NOT_AVAILABLE)).toBeNull();
  });

  it('says the verse is unavailable after the translation has loaded without that verse', () => {
    renderVerseDisplay({
      KJV: kjvChapter,
      ASV: { chapter: 1, verses: [] },
    });

    const missingCell = document.querySelector('[data-translation-id="ASV"]');
    expect(missingCell).not.toBeNull();
    expect(missingCell?.textContent).toBe('-');
    expect(missingCell?.getAttribute('title')).toBe(VERSE_NOT_AVAILABLE);
    expect(screen.queryByText(TRANSLATION_NOT_YET_LOADED)).toBeNull();
  });
});

const asvChapter: BibleChapter = {
  chapter: 1,
  verses: [{ verse: 1, text: 'ASV opening line.' }],
};

const webChapter: BibleChapter = {
  chapter: 1,
  verses: [{ verse: 1, text: 'WEB opening line.' }],
};

function installPointerEventPolyfill() {
  if (typeof window.PointerEvent === 'function') {
    return;
  }

  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    pointerType: string;
    isPrimary: boolean;

    constructor(type: string, init: MouseEventInit & {
      pointerId?: number;
      pointerType?: string;
      isPrimary?: boolean;
    } = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? '';
      this.isPrimary = init.isPrimary ?? false;
    }
  }

  Object.defineProperty(window, 'PointerEvent', {
    configurable: true,
    writable: true,
    value: PointerEventPolyfill,
  });
}

function verseShell(): HTMLElement {
  const shell = document.querySelector('.verse-grid-shell');
  if (!(shell instanceof HTMLElement)) {
    throw new Error('Verse grid shell was not rendered.');
  }
  return shell;
}

function swipeOffset(shell: HTMLElement = verseShell()): number {
  return Number.parseFloat(shell.style.getPropertyValue('--verse-swipe-offset'));
}

function dispatchPointer(
  type: string,
  x: number,
  y: number,
  pointerType = 'touch',
): PointerEvent {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType,
    isPrimary: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
  const rows = verseShell().querySelector('.verse-grid-rows');
  if (!(rows instanceof HTMLElement)) {
    throw new Error('Verse rows were not rendered.');
  }
  rows.dispatchEvent(event);
  return event;
}

describe('VerseDisplay mobile translation swipe', () => {
  const originalGetComputedStyle = window.getComputedStyle;
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
  const mobileChapters = {
    KJV: kjvChapter,
    ASV: asvChapter,
    WEB: webChapter,
  };

  beforeEach(() => {
    installPointerEventPolyfill();
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    window.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
    Element.prototype.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      width: 360,
      height: 640,
      top: 0,
      left: 0,
      bottom: 640,
      right: 360,
      toJSON: () => ({}),
    });
    window.getComputedStyle = () => ({
      getPropertyValue: (name: string) => {
        const values: Record<string, string> = {
          '--verse-grid-verse-width': '36px',
          '--verse-grid-translation-min-width': '220px',
          '--verse-grid-column-gap': '8px',
          '--verse-grid-inline-padding-end': '8px',
        };
        return values[name] ?? '';
      },
    }) as unknown as CSSStyleDeclaration;
  });

  afterEach(() => {
    window.getComputedStyle = originalGetComputedStyle;
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    jest.useRealTimers();
  });

  function renderMobile() {
    return renderVerseDisplay(mobileChapters, {
      isMobileLayout: true,
      translationOrder: ['KJV', 'ASV', 'WEB'],
      translationLabels: {
        KJV: 'King James',
        ASV: 'American Standard',
        WEB: 'World English',
      },
      starredTranslationIds: ['KJV', 'ASV', 'WEB'],
    });
  }

  it('follows a short horizontal drag, peeks the next translation, and snaps back', () => {
    renderMobile();
    const shell = verseShell();

    expect(shell).toHaveClass('is-translation-swipe');
    expect(shell.querySelector('.verse-grid-swipe-viewport')).not.toBeNull();
    expect(shell.getAttribute('data-translation-window-start')).toBe('0');
    expect(document.querySelector('[data-translation-id="ASV"]')).toHaveAttribute('aria-hidden', 'true');
    expect(swipeOffset(shell)).toBeCloseTo(0);

    let move: PointerEvent | null = null;
    act(() => {
      dispatchPointer('pointerdown', 220, 80);
      // Far enough to lock horizontally, short of both the distance and flick thresholds.
      move = dispatchPointer('pointermove', 205, 81);
    });

    expect(move!.defaultPrevented).toBe(true);
    expect(swipeOffset(shell)).toBeCloseTo(-15);
    expect(shell.getAttribute('data-swipe-dragging')).toBe('true');
    expect(document.querySelector('[data-translation-id="ASV"]')?.textContent).toContain('ASV opening line.');

    act(() => {
      dispatchPointer('pointerup', 205, 81);
    });

    expect(shell.getAttribute('data-translation-window-start')).toBe('0');
    expect(swipeOffset(shell)).toBeCloseTo(0);
    expect(shell.style.getPropertyValue('--verse-swipe-duration')).toBe('300ms');
    expect(shell.hasAttribute('data-swipe-dragging')).toBe(false);
  });

  it('swipes to the next translation and still honors the arrows', () => {
    renderMobile();
    const shell = verseShell();
    const columnWidth = Number(shell.getAttribute('data-swipe-column-width'));
    expect(columnWidth).toBeGreaterThan(100);

    act(() => {
      dispatchPointer('pointerdown', 240, 90);
      dispatchPointer('pointermove', 240 - (columnWidth * 0.45), 92);
      dispatchPointer('pointerup', 240 - (columnWidth * 0.45), 92);
    });

    expect(shell.getAttribute('data-translation-window-start')).toBe('1');
    expect(swipeOffset(shell)).toBeCloseTo(-columnWidth);
    expect(shell).not.toHaveClass('is-sliding-right');

    fireEvent.click(screen.getByRole('button', { name: 'Show previous translations' }));

    expect(shell.getAttribute('data-translation-window-start')).toBe('0');
    expect(swipeOffset(shell)).toBeCloseTo(0);
    expect(shell).not.toHaveClass('is-sliding-left');

    fireEvent.click(screen.getByRole('button', { name: 'Show next translations' }));

    expect(shell.getAttribute('data-translation-window-start')).toBe('1');
    expect(swipeOffset(shell)).toBeCloseTo(-columnWidth);
  });

  it('rubber-bands at the first and last translation instead of wrapping', () => {
    renderMobile();
    const shell = verseShell();
    const columnWidth = Number(shell.getAttribute('data-swipe-column-width'));

    act(() => {
      dispatchPointer('pointerdown', 200, 70);
      dispatchPointer('pointermove', 300, 72);
    });

    const resisted = swipeOffset(shell);
    expect(resisted).toBeGreaterThan(20);
    expect(resisted).toBeLessThan(100);

    act(() => {
      dispatchPointer('pointerup', 300, 72);
    });

    expect(shell.getAttribute('data-translation-window-start')).toBe('0');
    expect(swipeOffset(shell)).toBeCloseTo(0);

    const pageNext = () => {
      act(() => {
        dispatchPointer('pointerdown', 240, 90);
        dispatchPointer('pointermove', 240 - (columnWidth * 0.5), 90);
        dispatchPointer('pointerup', 240 - (columnWidth * 0.5), 90);
      });
    };

    pageNext();
    pageNext();
    expect(shell.getAttribute('data-translation-window-start')).toBe('2');
    expect(swipeOffset(shell)).toBeCloseTo(-2 * columnWidth);

    act(() => {
      dispatchPointer('pointerdown', 240, 90);
      dispatchPointer('pointermove', 140, 90);
    });

    const endOffset = swipeOffset(shell);
    expect(endOffset).toBeLessThan(-2 * columnWidth);
    expect(endOffset).toBeGreaterThan((-2 * columnWidth) - 100);

    act(() => {
      dispatchPointer('pointerup', 140, 90);
    });

    expect(shell.getAttribute('data-translation-window-start')).toBe('2');
    expect(swipeOffset(shell)).toBeCloseTo(-2 * columnWidth);
  });

  it('leaves vertical drags to scrolling', () => {
    renderMobile();
    const shell = verseShell();
    let move: PointerEvent | null = null;

    act(() => {
      dispatchPointer('pointerdown', 180, 40);
      move = dispatchPointer('pointermove', 186, 130);
      dispatchPointer('pointerup', 186, 160);
    });

    expect(move!.defaultPrevented).toBe(false);
    expect(shell.getAttribute('data-translation-window-start')).toBe('0');
    expect(swipeOffset(shell)).toBeCloseTo(0);
    expect(shell.hasAttribute('data-swipe-dragging')).toBe(false);
  });

  it('ignores mouse drags on the mobile layout', () => {
    renderMobile();
    const shell = verseShell();

    act(() => {
      dispatchPointer('pointerdown', 220, 80, 'mouse');
      dispatchPointer('pointermove', 40, 80, 'mouse');
      dispatchPointer('pointerup', 40, 80, 'mouse');
    });

    expect(shell.getAttribute('data-translation-window-start')).toBe('0');
    expect(swipeOffset(shell)).toBeCloseTo(0);
  });

  it('does not swipe after a verse long-press', () => {
    jest.useFakeTimers();
    renderMobile();
    const shell = verseShell();
    const cell = document.querySelector('[data-translation-id="KJV"]');
    if (!(cell instanceof HTMLElement)) {
      throw new Error('Visible verse cell was not rendered.');
    }

    fireEvent.touchStart(cell, {
      touches: [{ clientX: 30, clientY: 40, identifier: 1 }],
    });
    act(() => {
      jest.advanceTimersByTime(500);
    });

    act(() => {
      dispatchPointer('pointerdown', 220, 80);
      dispatchPointer('pointermove', 40, 82);
      dispatchPointer('pointerup', 40, 82);
    });

    expect(shell.getAttribute('data-translation-window-start')).toBe('0');
    expect(swipeOffset(shell)).toBeCloseTo(0);
  });

  it('keeps arrow paging on a narrow desktop layout without swipe', () => {
    renderVerseDisplay({
      KJV: kjvChapter,
      ASV: asvChapter,
    });
    const shell = verseShell();

    expect(shell.querySelector('.verse-grid-swipe-viewport')).toBeNull();
    expect(shell).not.toHaveClass('is-translation-swipe');
    fireEvent.click(screen.getByRole('button', { name: 'Show next translations' }));

    expect(shell).toHaveClass('is-sliding-right');
    expect(shell.getAttribute('data-translation-window-start')).toBe('1');
    expect(document.querySelector('[data-translation-id="KJV"]')).toBeNull();
    expect(document.querySelector('[data-translation-id="ASV"]')?.textContent).toContain('ASV opening line.');
  });
});
