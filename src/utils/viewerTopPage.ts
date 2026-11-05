/** Vertical extent of a page in the viewer's scroll container. */
export interface PageVerticalBox {
  top: number;
  bottom: number;
}

/** Scrollport used to decide which page sits at the top of a viewer. */
export interface ViewerScrollport {
  scrollTop: number;
  clientHeight: number;
}

/** Page frame geometry relative to the scrollport. */
export interface ViewerPageFrame {
  offsetTop: number;
  clientTop: number;
  clientHeight: number;
}

/**
 * Trailing fraction of a page that yields to the next page for the toolbar
 * page number (and fit-to-width). The bottom ~20% of page N counts as page N+1,
 * so scrolling back onto N does not switch until you leave that trailing band.
 */
export const TOP_PAGE_TRAILING_FRACTION = 0.2;

/**
 * Index of the page occupying the top of the viewport.
 * `pages` must be in document order. Empty input yields 0.
 */
export function findTopVisiblePageIndex(
  viewportTop: number,
  viewportBottom: number,
  pages: readonly PageVerticalBox[]
): number {
  if (pages.length === 0) {
    return 0;
  }

  let index = 0;
  let found = false;
  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i];
    if (page.bottom > viewportTop && page.top < viewportBottom) {
      index = i;
      found = true;
      break;
    }
  }

  if (!found) {
    if (pages[pages.length - 1].bottom <= viewportTop) {
      return pages.length - 1;
    }
    return 0;
  }

  const page = pages[index];
  const height = page.bottom - page.top;
  if (height > 0 && index < pages.length - 1) {
    const progress = (viewportTop - page.top) / height;
    if (progress >= 1 - TOP_PAGE_TRAILING_FRACTION) {
      return index + 1;
    }
  }
  return index;
}

function pageBoxFromFrame(page: ViewerPageFrame): PageVerticalBox {
  const top = page.offsetTop + page.clientTop;
  return { top, bottom: top + page.clientHeight };
}

/** Index of the page at the top of `container`, using each frame's offset box. */
export function findTopVisiblePageIndexInContainer(
  container: ViewerScrollport,
  pageFrames: readonly ViewerPageFrame[]
): number {
  const viewportTop = container.scrollTop;
  return findTopVisiblePageIndex(
    viewportTop,
    viewportTop + container.clientHeight,
    pageFrames.map(pageBoxFromFrame)
  );
}
