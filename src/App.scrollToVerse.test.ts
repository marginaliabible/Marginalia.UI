import {
  cancelActiveVerseScroll,
  isElementFullyInView,
  scrollToVerse,
  verseDomId,
  verseElementId,
} from './App';

type RectPatch = {
  top: number;
  height?: number;
  width?: number;
};

const innerHeight = 800;

const asRect = ({ top, height = 80, width = 120 }: RectPatch): DOMRect => {
  const bottom = top + height;
  return {
    x: 0,
    y: top,
    width,
    height,
    top,
    left: 0,
    right: width,
    bottom,
    toJSON: () => ({ top, bottom, width, height }),
  };
};

const mountVerse = (id: string, initialTop: number) => {
  const element = document.createElement('div');
  element.id = id;
  element.className = 'verse-grid-row';
  let top = initialTop;

  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => asRect({ top }),
  });

  const scrollIntoView = jest.fn(() => {
    top = 240;
  });
  element.scrollIntoView = scrollIntoView;
  document.body.appendChild(element);

  return {
    element,
    scrollIntoView,
    setTop: (nextTop: number) => {
      top = nextTop;
    },
    getTop: () => top,
  };
};

const flushFrames = async (count = 1) => {
  for (let index = 0; index < count; index += 1) {
    await jest.advanceTimersByTimeAsync(16);
  }
};

describe('verseElementId', () => {
  it('omits ids until loaded book/chapter identity is known', () => {
    expect(verseElementId(undefined, 50, 26)).toBeUndefined();
    expect(verseElementId('Genesis', 0, 26)).toBeUndefined();
    expect(verseElementId('Genesis', 50, 26)).toBe('Genesis-50-26');
    expect(verseElementId('John', 3, 16)).toBe(verseDomId('John', 3, 16));
  });
});

describe('isElementFullyInView', () => {
  it('rejects zero-sized and below-the-fold elements, and accounts for the sticky header', () => {
    const unset = document.createElement('div');
    expect(isElementFullyInView(unset)).toBe(false);

    const below = document.createElement('div');
    below.getBoundingClientRect = () => asRect({ top: 900 });
    expect(isElementFullyInView(below)).toBe(false);

    const header = document.createElement('div');
    header.className = 'verse-grid-header';
    header.getBoundingClientRect = () => asRect({ top: 0, height: 120 });
    document.body.appendChild(header);

    const covered = document.createElement('div');
    covered.getBoundingClientRect = () => asRect({ top: 40, height: 80 });
    expect(isElementFullyInView(covered)).toBe(false);

    const visible = document.createElement('div');
    visible.getBoundingClientRect = () => asRect({ top: 128, height: 80 });
    expect(isElementFullyInView(visible)).toBe(true);
    document.body.innerHTML = '';
  });
});

describe('scrollToVerse', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = '';
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: innerHeight });
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      return window.setTimeout(() => callback(performance.now()), 16) as unknown as number;
    });
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation((handle) => {
      window.clearTimeout(handle);
    });
  });

  afterEach(() => {
    cancelActiveVerseScroll();
    document.body.innerHTML = '';
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('waits for the target verse to mount before scrolling', async () => {
    const pending = scrollToVerse({ book: 'John', chapter: 3, verse: 16 });

    await flushFrames(3);
    expect(document.getElementById('John-3-16')).toBeNull();

    const verse = mountVerse('John-3-16', 1400);
    await flushFrames(8);
    await pending;

    expect(verse.scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'auto', block: 'nearest' })
    );
    expect(verse.getTop()).toBe(240);
    expect(isElementFullyInView(verse.element)).toBe(true);
  });

  it('re-scrolls if layout later pushes the verse out of view', async () => {
    const verse = mountVerse('Genesis-50-26', 1800);
    const pending = scrollToVerse(
      { book: 'Genesis', chapter: 50, verse: 26 },
      { block: 'nearest', followLayout: true }
    );

    await Promise.resolve();
    expect(verse.scrollIntoView).toHaveBeenCalled();
    const callsAfterFirstVisible = verse.scrollIntoView.mock.calls.length;

    verse.setTop(1600);
    await flushFrames(6);
    await pending;

    expect(verse.scrollIntoView.mock.calls.length).toBeGreaterThan(callsAfterFirstVisible);
    expect(verse.getTop()).toBe(240);
  });

  it('cancels an in-flight jump when a newer destination is requested', async () => {
    const stale = scrollToVerse({ book: 'Luke', chapter: 1, verse: 80 });
    const next = scrollToVerse({ book: 'John', chapter: 3, verse: 16 });

    const luke = mountVerse('Luke-1-80', 1700);
    const john = mountVerse('John-3-16', 1700);

    await flushFrames(10);
    await Promise.all([stale, next]);

    expect(john.scrollIntoView).toHaveBeenCalled();
    expect(luke.scrollIntoView).not.toHaveBeenCalled();
  });

  it('stops following layout after the user scrolls', async () => {
    const verse = mountVerse('Jeremiah-29-11', 1500);
    const pending = scrollToVerse({ book: 'Jeremiah', chapter: 29, verse: 11 });

    await Promise.resolve();
    expect(verse.scrollIntoView).toHaveBeenCalled();
    const callsAfterJump = verse.scrollIntoView.mock.calls.length;

    window.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
    verse.setTop(1700);
    await flushFrames(8);
    await pending;

    expect(verse.scrollIntoView.mock.calls.length).toBe(callsAfterJump);
    expect(verse.getTop()).toBe(1700);
  });

  it('still scrolls a delayed late-verse mount after a hash-change scroll event', async () => {
    const pending = scrollToVerse(
      { book: 'Genesis', chapter: 50, verse: 26 },
      { block: 'nearest', followLayout: true }
    );

    await flushFrames(2);
    window.dispatchEvent(new Event('scroll'));
    expect(document.getElementById('Genesis-50-26')).toBeNull();

    const verse = mountVerse('Genesis-50-26', 2200);
    await flushFrames(8);
    await pending;

    expect(verse.scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'auto', block: 'nearest' })
    );
    expect(isElementFullyInView(verse.element)).toBe(true);
  });
});
