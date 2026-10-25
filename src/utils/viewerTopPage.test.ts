import { findTopVisiblePageIndex, findTopVisiblePageIndexInContainer } from './viewerTopPage';

describe('findTopVisiblePageIndex', () => {
  const pages = [
    { top: 0, bottom: 100 },
    { top: 110, bottom: 210 },
    { top: 220, bottom: 320 },
  ];

  it('returns 0 when there are no pages', () => {
    expect(findTopVisiblePageIndex(0, 200, [])).toBe(0);
  });

  it('returns the first page when the viewport starts at the document top', () => {
    expect(findTopVisiblePageIndex(0, 80, pages)).toBe(0);
  });

  it('keeps the upper page until the viewport reaches its trailing band', () => {
    expect(findTopVisiblePageIndex(70, 250, pages)).toBe(0);
    expect(findTopVisiblePageIndex(79, 250, pages)).toBe(0);
  });

  it('yields the bottom of a page to the next page', () => {
    expect(findTopVisiblePageIndex(80, 250, pages)).toBe(1);
    expect(findTopVisiblePageIndex(90, 250, pages)).toBe(1);
  });

  it('does not switch back to the previous page until the trailing band is left', () => {
    expect(findTopVisiblePageIndex(85, 250, pages)).toBe(1);
    expect(findTopVisiblePageIndex(79, 250, pages)).toBe(0);
  });

  it('switches to the next page as soon as that page reaches the top of the viewport', () => {
    expect(findTopVisiblePageIndex(100, 260, pages)).toBe(1);
    expect(findTopVisiblePageIndex(110, 270, pages)).toBe(1);
  });

  it('keeps the last page even in its trailing band', () => {
    expect(findTopVisiblePageIndex(300, 400, pages)).toBe(2);
  });

  it('uses the upcoming page when the viewport top sits in a gap between pages', () => {
    expect(findTopVisiblePageIndex(105, 250, pages)).toBe(1);
  });

  it('returns the last page when scrolled past the end of the document', () => {
    expect(findTopVisiblePageIndex(400, 560, pages)).toBe(2);
  });
});

describe('findTopVisiblePageIndexInContainer', () => {
  const frames = [
    { offsetTop: 0, clientTop: 0, clientHeight: 800 },
    { offsetTop: 820, clientTop: 0, clientHeight: 800 },
  ];

  it('reads page boxes from offset geometry', () => {
    expect(findTopVisiblePageIndexInContainer({ scrollTop: 0, clientHeight: 600 }, frames)).toBe(0);
    expect(findTopVisiblePageIndexInContainer({ scrollTop: 500, clientHeight: 600 }, frames)).toBe(0);
    expect(findTopVisiblePageIndexInContainer({ scrollTop: 640, clientHeight: 600 }, frames)).toBe(1);
    expect(findTopVisiblePageIndexInContainer({ scrollTop: 800, clientHeight: 600 }, frames)).toBe(1);
  });
});
