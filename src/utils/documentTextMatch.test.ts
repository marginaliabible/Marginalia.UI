import {
  buildTextLayerHaystack,
  findNeedleInHaystack,
  getMatchClientRects,
  placeOverlayOnPage,
} from './documentTextMatch';

const CHAR_WIDTH = 10;

/** Global character offset of a DOM position within `root`, so each char maps to a 10px column. */
function offsetWithin(root: Node, container: Node, offset: number): number {
  let total = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node === container) {
      return total + offset;
    }
    total += (node as Text).data.length;
  }
  return total;
}

describe('getMatchClientRects', () => {
  const originalGetClientRects = Range.prototype.getClientRects;

  beforeEach(() => {
    Range.prototype.getClientRects = function getClientRects(this: Range) {
      const root = (this.startContainer.parentElement?.closest('.t') ?? document.body) as Node;
      const start = offsetWithin(root, this.startContainer, this.startOffset);
      const end = offsetWithin(root, this.endContainer, this.endOffset);
      return [new DOMRect(start * CHAR_WIDTH, 0, (end - start) * CHAR_WIDTH, 12)] as unknown as DOMRectList;
    };
  });

  afterEach(() => {
    Range.prototype.getClientRects = originalGetClientRects;
    document.body.innerHTML = '';
  });

  function buildLine(html: string): HTMLElement {
    document.body.innerHTML = `<div class="t">${html}</div>`;
    return document.body.querySelector<HTMLElement>('.t')!;
  }

  it('covers only the matched characters within a line', () => {
    const line = buildLine('See John 3:16 for more');
    const { haystack, ranges } = buildTextLayerHaystack([line]);
    const hit = findNeedleInHaystack(haystack, ranges, 'John 3:16')!;

    const rects = getMatchClientRects(hit.ranges[0]!, hit.start, hit.end);

    expect(rects).toEqual([{ left: 4 * CHAR_WIDTH, top: 0, width: 9 * CHAR_WIDTH, height: 12 }]);
  });

  it('maps through collapsed whitespace and nested spacing spans', () => {
    const line = buildLine('See  <span class="_"> </span>JOHN 3:16 now');
    const { haystack, ranges } = buildTextLayerHaystack([line]);
    const hit = findNeedleInHaystack(haystack, ranges, 'john 3:16')!;

    const rects = getMatchClientRects(hit.ranges[0]!, hit.start, hit.end);

    expect(rects).toEqual([{ left: 6 * CHAR_WIDTH, top: 0, width: 9 * CHAR_WIDTH, height: 12 }]);
  });

  it('falls back to the whole node when the text cannot be mapped', () => {
    const line = buildLine('See John 3:16 for more');
    line.getBoundingClientRect = () => new DOMRect(1, 2, 300, 12);
    const { haystack, ranges } = buildTextLayerHaystack([line]);
    const hit = findNeedleInHaystack(haystack, ranges, 'John 3:16')!;
    const staleRange = { ...hit.ranges[0]!, text: 'different text entirely' };

    const rects = getMatchClientRects(staleRange, hit.start, hit.end);

    expect(rects).toEqual([{ left: 1, top: 2, width: 300, height: 12 }]);
  });
});

describe('placeOverlayOnPage', () => {
  function buildPage(size: { width: number; height: number }, rect: DOMRect): HTMLElement {
    const page = document.createElement('div');
    document.body.appendChild(page);
    Object.defineProperties(page, {
      offsetWidth: { value: size.width },
      offsetHeight: { value: size.height },
      clientWidth: { value: size.width },
      clientHeight: { value: size.height },
    });
    page.getBoundingClientRect = () => rect;
    return page;
  }

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('positions the padded overlay as percentages of the page box', () => {
    const page = buildPage({ width: 400, height: 800 }, new DOMRect(100, 50, 400, 800));
    const overlay = document.createElement('div');

    // 20px-tall text pads by 3px on each side -> 40x26 box at (200, 250).
    const placed = placeOverlayOnPage(overlay, page, { left: 203, top: 253, width: 34, height: 20 });

    expect(placed).toBe(true);
    expect(overlay.parentElement).toBe(page);
    expect(overlay.style.left).toBe('25%');
    expect(overlay.style.top).toBe('25%');
    expect(overlay.style.width).toBe('10%');
    expect(overlay.style.height).toBe('3.25%');
  });

  it('accounts for an ancestor transform scaling the page', () => {
    const page = buildPage({ width: 400, height: 800 }, new DOMRect(0, 0, 800, 1600));
    const overlay = document.createElement('div');

    // 40px-tall text pads by 6px on each side -> 80x52 box at (400, 800).
    placeOverlayOnPage(overlay, page, { left: 406, top: 806, width: 68, height: 40 });

    expect(overlay.style.left).toBe('50%');
    expect(overlay.style.top).toBe('50%');
    expect(overlay.style.width).toBe('10%');
    expect(overlay.style.height).toBe('3.25%');
  });

  it('refuses to place on an unmeasured page', () => {
    const page = buildPage({ width: 0, height: 0 }, new DOMRect(0, 0, 0, 0));
    const overlay = document.createElement('div');

    expect(placeOverlayOnPage(overlay, page, { left: 0, top: 0, width: 10, height: 10 })).toBe(false);
    expect(overlay.parentElement).toBeNull();
  });
});
