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
      isPanelFloating={false}
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

describe('VerseDisplay mobile translation swipe', () => {
  const originalGetComputedStyle = window.getComputedStyle;
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;

  beforeAll(() => {
    if (typeof window.PointerEvent === 'function') return;
    class PointerEventPolyfill extends MouseEvent {
      pointerId: number;
      pointerType: string;
      isPrimary: boolean;
      constructor(type: string, init: MouseEventInit & { pointerId?: number; pointerType?: string; isPrimary?: boolean } = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
        this.pointerType = init.pointerType ?? '';
        this.isPrimary = init.isPrimary ?? false;
      }
    }
    Object.defineProperty(window, 'PointerEvent', { configurable: true, writable: true, value: PointerEventPolyfill });
  });

  beforeEach(() => {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    Element.prototype.getBoundingClientRect = () => ({
      x: 0, y: 0, width: 360, height: 640, top: 0, left: 0, bottom: 640, right: 360, toJSON: () => ({}),
    });
    window.getComputedStyle = (() => ({
      getPropertyValue: (name: string) => ({
        '--verse-grid-verse-width': '36px',
        '--verse-grid-translation-min-width': '220px',
        '--verse-grid-column-gap': '8px',
        '--verse-grid-inline-padding-end': '8px',
      }[name] ?? ''),
    })) as unknown as typeof window.getComputedStyle;
  });

  afterEach(() => {
    window.getComputedStyle = originalGetComputedStyle;
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  function renderMobile() {
    return renderVerseDisplay({
      KJV: kjvChapter,
      ASV: asvChapter,
      WEB: { chapter: 1, verses: [{ verse: 1, text: 'WEB opening line.' }] },
    }, {
      isMobileLayout: true,
      translationOrder: ['KJV', 'ASV', 'WEB'],
      translationLabels: { KJV: 'King James', ASV: 'American Standard', WEB: 'World English' },
      starredTranslationIds: ['KJV', 'ASV', 'WEB'],
    });
  }

  function shell(): HTMLElement {
    return document.querySelector('.verse-grid-shell') as HTMLElement;
  }

  function offset(): number {
    return Number.parseFloat(shell().style.getPropertyValue('--verse-swipe-offset'));
  }

  function gesture(dx: number, dy = 0, pointerType = 'touch'): PointerEvent {
    const rows = shell().querySelector('.verse-grid-rows') as HTMLElement;
    const point = (type: string, x: number, y: number) => new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, pointerType, isPrimary: true, button: 0, clientX: x, clientY: y,
    });
    let move!: PointerEvent;
    act(() => {
      rows.dispatchEvent(point('pointerdown', 240, 80));
      move = point('pointermove', 240 + dx, 80 + dy);
      rows.dispatchEvent(move);
      rows.dispatchEvent(point('pointerup', 240 + dx, 80 + dy));
    });
    return move;
  }

  it('peeks while dragging, snaps back when short, and commits a longer swipe', () => {
    renderMobile();
    expect(shell()).toHaveClass('is-translation-swipe');
    expect(document.querySelector('[data-translation-id="ASV"]')).toHaveAttribute('aria-hidden', 'true');

    const rows = shell().querySelector('.verse-grid-rows') as HTMLElement;
    let move!: PointerEvent;
    act(() => {
      rows.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 240, clientY: 80,
      }));
      move = new PointerEvent('pointermove', {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 225, clientY: 81,
      });
      rows.dispatchEvent(move);
    });
    expect(move.defaultPrevented).toBe(true);
    expect(offset()).toBeCloseTo(-15);
    expect(shell().getAttribute('data-swipe-dragging')).toBe('true');

    act(() => {
      rows.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 225, clientY: 81,
      }));
    });
    expect(shell().getAttribute('data-translation-window-start')).toBe('0');
    expect(offset()).toBeCloseTo(0);

    const columnWidth = Number(shell().getAttribute('data-swipe-column-width'));
    gesture(-columnWidth * 0.45);
    expect(shell().getAttribute('data-translation-window-start')).toBe('1');
    expect(offset()).toBeCloseTo(-columnWidth);

    fireEvent.click(screen.getByRole('button', { name: 'Show previous translations' }));
    expect(shell().getAttribute('data-translation-window-start')).toBe('0');
    expect(offset()).toBeCloseTo(0);
    expect(shell()).not.toHaveClass('is-sliding-left');
  });

  it('rubber-bands at the ends and ignores vertical or mouse drags', () => {
    renderMobile();
    const columnWidth = Number(shell().getAttribute('data-swipe-column-width'));
    const rows = shell().querySelector('.verse-grid-rows') as HTMLElement;
    act(() => {
      rows.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 200, clientY: 70,
      }));
      rows.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 300, clientY: 72,
      }));
    });
    expect(offset()).toBeGreaterThan(20);
    expect(offset()).toBeLessThan(100);
    act(() => {
      rows.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 300, clientY: 72,
      }));
    });
    expect(shell().getAttribute('data-translation-window-start')).toBe('0');

    gesture(-columnWidth * 0.5);
    gesture(-columnWidth * 0.5);
    expect(shell().getAttribute('data-translation-window-start')).toBe('2');
    const vertical = gesture(6, 90);
    expect(vertical.defaultPrevented).toBe(false);
    expect(shell().getAttribute('data-translation-window-start')).toBe('2');
    gesture(-160, 0, 'mouse');
    expect(shell().getAttribute('data-translation-window-start')).toBe('2');
  });

  it('keeps arrow paging on a narrow desktop layout without swipe', () => {
    renderVerseDisplay({ KJV: kjvChapter, ASV: asvChapter });
    expect(shell().querySelector('.verse-grid-swipe-viewport')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show next translations' }));
    expect(shell()).toHaveClass('is-sliding-right');
    expect(shell().getAttribute('data-translation-window-start')).toBe('1');
    expect(document.querySelector('[data-translation-id="KJV"]')).toBeNull();
  });
});
