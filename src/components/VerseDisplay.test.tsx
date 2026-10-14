import { render, screen } from '@testing-library/react';
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

function renderVerseDisplay(chaptersByTranslation: Record<string, BibleChapter | null>) {
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
