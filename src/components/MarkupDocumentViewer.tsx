import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { closeDocumentViewer } from '../store/slices/uiSlice';
import { buildMarkupDocumentShellUrl } from '../utils/resourceLibraryConfig';
import { fetchStorageAware } from '../services/storageAuthenticatedFetch';
import { useOpenDocumentScriptureReference } from '../hooks/useDocumentScriptureNavigation';
import { useViewerZoomInputs } from '../hooks/useViewerZoomInputs';
import { loadPageScriptureReferences } from '../utils/loadPageScriptureReferences';
import { applyScriptureLinkOverlays, clearScriptureLinks } from '../utils/scriptureLinkOverlays';
import { buildTextLayerHaystack, findAllMatchRanges, getMatchClientRects, placeOverlayOnPage } from '../utils/documentTextMatch';
import { clampScale, FIT_WIDTH_GUTTER_PX, stepScale } from '../utils/viewerZoom';
import FileSyncExclusionButton from './FileSyncExclusionButton';
import ViewerZoomControls from './ViewerZoomControls';

/** Pages to keep materialized around the active page (matches pdf2htmlEX preload_pages ≈ 3). */
const PAGE_WINDOW_RADIUS = 2;

/** App-origin absolute URL — srcdoc uses <base href=storage>, so /vendor/... would hit R2. */
function appVendorUrl(fileName: string): string {
  const basePath = `${String(import.meta.env.BASE_URL || '/').replace(/\/?$/, '/') }vendor/pdf2htmlEX/${fileName}`;
  if (typeof window === 'undefined') {
    return basePath;
  }
  return new URL(basePath, window.location.origin).toString();
}

declare global {
  interface Window {
    pdf2htmlEX?: {
      Viewer: new (config?: Record<string, unknown>) => Pdf2HtmlExViewer;
      defaultViewer?: Pdf2HtmlExViewer;
    };
  }
}

interface Pdf2HtmlExViewer {
  scroll_to: (pageIndex: number, position?: [number | null, number | null] | null) => void;
  navigate_to_dest?: (detail: string) => void;
  rescale?: (scale: number) => void;
  scale?: number;
  cur_page_idx?: number;
  pages?: Array<{ loaded?: boolean; page?: HTMLElement | null }>;
}

/** Scale at which the current page fills the iframe's page container width, or null if not measurable yet. */
function computeMarkupFitWidthScale(frame: HTMLIFrameElement | null): number | null {
  const viewer = frame?.contentWindow?.pdf2htmlEX?.defaultViewer;
  const container = frame?.contentDocument?.getElementById('page-container');
  if (!viewer || !container) {
    return null;
  }
  const pages = viewer.pages ?? [];
  const page = pages[viewer.cur_page_idx ?? 0]?.page ?? pages[0]?.page;
  const currentScale = viewer.scale || 1;
  if (!page || page.offsetWidth === 0) {
    return null;
  }
  const available = container.clientWidth - FIT_WIDTH_GUTTER_PX;
  if (available <= 0) {
    return null;
  }
  return available / (page.offsetWidth / currentScale);
}

function normalizeMatchText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function resolvePagesBaseUrl(sourceUrl: string): string {
  try {
    const url = new URL(sourceUrl, window.location.href);
    if (/\/index\.html$/i.test(url.pathname)) {
      url.pathname = url.pathname.replace(/\/index\.html$/i, '/');
    } else if (!url.pathname.endsWith('/')) {
      url.pathname = `${url.pathname}/`;
    }
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    const trimmed = sourceUrl.trim();
    if (/\/index\.html$/i.test(trimmed)) {
      return trimmed.replace(/\/index\.html$/i, '/');
    }
    return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
  }
}

function extractShellBody(html: string, pagesBaseUrl: string): {
  documentCssUrl: string | null;
  bodyHtml: string;
} {
  const headMatch = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const head = headMatch?.[1] ?? '';
  const body = bodyMatch?.[1] ?? html;

  let documentCssUrl: string | null = null;
  for (const match of head.matchAll(/<link\b[^>]*document\.css[^>]*>/gi)) {
    const hrefMatch = match[0].match(/\bhref=(["'])([^"']+)\1/i);
    if (!hrefMatch) {
      continue;
    }
    try {
      documentCssUrl = new URL(hrefMatch[2], pagesBaseUrl).toString();
    } catch {
      documentCssUrl = hrefMatch[2];
    }
    break;
  }

  return {
    documentCssUrl,
    bodyHtml: body
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<div\b([^>]*\bloading-indicator\b[^>]*)>[\s\S]*?<\/div>/i, '<div class="loading-indicator"></div>'),
  };
}

function countPagePlaceholders(bodyHtml: string): number {
  const matches = bodyHtml.match(/\bdata-page-url=/gi);
  return matches?.length ?? 0;
}

/** Make data-page-url absolute against the storage pages base (srcdoc relative resolution is unreliable). */
function absolutizeDataPageUrls(bodyHtml: string, pagesBaseUrl: string): string {
  return bodyHtml.replace(/\bdata-page-url=(["'])([^"']+)\1/gi, (full, quote: string, rawUrl: string) => {
    try {
      const absolute = new URL(rawUrl, pagesBaseUrl).toString();
      return `data-page-url=${quote}${absolute}${quote}`;
    } catch {
      return full;
    }
  });
}

function collectDataPageUrls(bodyHtml: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const match of bodyHtml.matchAll(/\bdata-page-url=(["'])([^"']+)\1/gi)) {
    const url = match[2];
    if (!url || seen.has(url)) {
      continue;
    }
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

function collectRootAssetUrls(content: string, storageOrigin: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const add = (assetPath: string) => {
    const absolute = `${storageOrigin}${assetPath}`;
    if (seen.has(absolute)) {
      return;
    }
    seen.add(absolute);
    urls.push(absolute);
  };

  for (const match of content.matchAll(/url\((["']?)(\/assets\/[^"')]+)\1\)/gi)) {
    add(match[2]);
  }
  for (const match of content.matchAll(/(?:src|href)=(["'])(\/assets\/[^"']+)\1/gi)) {
    add(match[2]);
  }
  return urls;
}

async function materializeStorageAssetBlobs(
  assetUrls: string[],
  blobUrls: string[]
): Promise<Map<string, string>> {
  const replacements = new Map<string, string>();
  await Promise.all(assetUrls.map(async (assetUrl) => {
    const response = await fetchStorageAware(assetUrl);
    if (!response.ok) {
      return;
    }
    const bytes = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: contentType }));
    blobUrls.push(blobUrl);
    replacements.set(assetUrl, blobUrl);
    try {
      const path = new URL(assetUrl).pathname;
      replacements.set(path, blobUrl);
    } catch {
      // ignore
    }
  }));
  return replacements;
}

function rewriteStorageAssetReferences(content: string, storageOrigin: string, assetBlobs: Map<string, string>): string {
  return content
    .replace(/url\((["']?)(\/assets\/[^"')]+)\1\)/gi, (_full, quote: string, assetPath: string) => {
      const absolute = `${storageOrigin}${assetPath}`;
      const blob = assetBlobs.get(absolute) || assetBlobs.get(assetPath);
      if (!blob) {
        return `url(${quote}${absolute}${quote})`;
      }
      return `url(${quote}${blob}${quote})`;
    })
    .replace(/(src|href)=(["'])(\/assets\/[^"']+)\2/gi, (_full, attr: string, quote: string, assetPath: string) => {
      const absolute = `${storageOrigin}${assetPath}`;
      const blob = assetBlobs.get(absolute) || assetBlobs.get(assetPath);
      if (!blob) {
        return `${attr}=${quote}${absolute}${quote}`;
      }
      return `${attr}=${quote}${blob}${quote}`;
    });
}

function pageWindowIndices(centerIndex: number, pageCount: number, radius = PAGE_WINDOW_RADIUS): number[] {
  if (pageCount <= 0) {
    return [];
  }
  const start = Math.max(0, centerIndex - radius);
  const end = Math.min(pageCount - 1, centerIndex + radius);
  const indices: number[] = [];
  for (let i = start; i <= end; i += 1) {
    indices.push(i);
  }
  return indices;
}

/**
 * Fetch selected pages via the parent (credentials work here), rewrite shared /assets/
 * refs to blobs, and return pageUrl → blobUrl for same-origin XHR in the iframe.
 */
async function materializePages(
  pageUrls: string[],
  storageOrigin: string,
  assetBlobs: Map<string, string>,
  blobUrls: string[]
): Promise<Map<string, string>> {
  const uniqueUrls = Array.from(new Set(pageUrls.filter(Boolean)));
  if (uniqueUrls.length === 0) {
    return new Map();
  }

  const pageHtmlByUrl = new Map<string, string>();
  await Promise.all(uniqueUrls.map(async (pageUrl) => {
    const response = await fetchStorageAware(pageUrl);
    if (!response.ok) {
      throw new Error(`Failed to load page (${response.status}): ${pageUrl}`);
    }
    pageHtmlByUrl.set(pageUrl, await response.text());
  }));

  const missingAssets = Array.from(new Set(
    Array.from(pageHtmlByUrl.values()).flatMap((html) => collectRootAssetUrls(html, storageOrigin))
  )).filter((assetUrl) => !assetBlobs.has(assetUrl));

  if (missingAssets.length > 0) {
    const newBlobs = await materializeStorageAssetBlobs(missingAssets, blobUrls);
    for (const [assetUrl, blobUrl] of newBlobs) {
      assetBlobs.set(assetUrl, blobUrl);
    }
  }

  const pageReplacements = new Map<string, string>();
  for (const [pageUrl, rawHtml] of pageHtmlByUrl) {
    const rewrittenPage = rewriteStorageAssetReferences(rawHtml, storageOrigin, assetBlobs);
    const blobUrl = URL.createObjectURL(new Blob([rewrittenPage], { type: 'text/html' }));
    blobUrls.push(blobUrl);
    pageReplacements.set(pageUrl, blobUrl);
  }
  return pageReplacements;
}

/**
 * Fetch document.css + a window of pages around the initial page. Remaining pages keep
 * data-storage-page-url and are materialized on demand when the viewer requests them.
 */
async function materializeMarkupDocument(
  bodyHtml: string,
  pagesBaseUrl: string,
  documentCssUrl: string | null,
  initialPageIndex: number
): Promise<{
  bodyHtml: string;
  documentCssText: string;
  blobUrls: string[];
  pageUrls: string[];
  pageBlobs: Map<string, string>;
  assetBlobs: Map<string, string>;
  storageOrigin: string;
}> {
  const storageOrigin = new URL(pagesBaseUrl).origin;
  const blobUrls: string[] = [];
  const withAbsoluteUrls = absolutizeDataPageUrls(bodyHtml, pagesBaseUrl);
  const pageUrls = collectDataPageUrls(withAbsoluteUrls);

  let documentCssText = '';
  if (documentCssUrl) {
    const cssResponse = await fetchStorageAware(documentCssUrl);
    if (!cssResponse.ok) {
      throw new Error(`Failed to load document.css (${cssResponse.status})`);
    }
    documentCssText = await cssResponse.text();
  }

  const assetBlobs = new Map<string, string>();
  const cssAssetUrls = collectRootAssetUrls(documentCssText, storageOrigin);
  if (cssAssetUrls.length > 0) {
    const cssBlobs = await materializeStorageAssetBlobs(cssAssetUrls, blobUrls);
    for (const [assetUrl, blobUrl] of cssBlobs) {
      assetBlobs.set(assetUrl, blobUrl);
    }
  }

  if (documentCssText) {
    documentCssText = rewriteStorageAssetReferences(documentCssText, storageOrigin, assetBlobs);
  }

  const windowUrls = pageWindowIndices(initialPageIndex, pageUrls.length)
    .map((index) => pageUrls[index])
    .filter((url): url is string => Boolean(url));
  const pageBlobs = await materializePages(windowUrls, storageOrigin, assetBlobs, blobUrls);

  // Always keep the storage URL; only attach a blob data-page-url for pages we fetched.
  const rewrittenBody = withAbsoluteUrls.replace(/\bdata-page-url=(["'])([^"']+)\1/gi, (_full, quote: string, rawUrl: string) => {
    const blobUrl = pageBlobs.get(rawUrl);
    if (blobUrl) {
      return `data-storage-page-url=${quote}${rawUrl}${quote} data-page-url=${quote}${blobUrl}${quote}`;
    }
    return `data-storage-page-url=${quote}${rawUrl}${quote}`;
  });

  return {
    bodyHtml: rewrittenBody,
    documentCssText,
    blobUrls,
    pageUrls,
    pageBlobs,
    assetBlobs,
    storageOrigin,
  };
}

function buildViewerSrcDoc(options: {
  pagesBaseUrl: string;
  documentCssText: string;
  bodyHtml: string;
  initialPage: number;
  initialScale: number;
}): string {
  const pageIndex = Math.max(0, options.initialPage - 1);
  const compatibilityJsUrl = appVendorUrl('compatibility.min.js');
  const pdf2htmlExJsUrl = appVendorUrl('pdf2htmlEX.min.js');
  const baseCssUrl = appVendorUrl('base.min.css');
  const fancyCssUrl = appVendorUrl('fancy.min.css');
  const safeDocumentCss = options.documentCssText.replace(/<\/style/gi, '<\\/style');
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<base href="${options.pagesBaseUrl}"/>
<link rel="stylesheet" href="${baseCssUrl}"/>
<link rel="stylesheet" href="${fancyCssUrl}"/>
<style>${safeDocumentCss}</style>
<style>
  html, body { margin: 0; height: 100%; background: transparent; }
  .loading-indicator, .loading-indicator.active { display: none !important; }
  .markup-raw-highlight {
    position: absolute;
    pointer-events: none;
    border-radius: 0.15rem;
    background: color-mix(in srgb, #ff9a3b 45%, transparent);
    z-index: 5;
  }
  .document-scripture-link {
    position: absolute;
    margin: 0;
    padding: 0;
    border: 0;
    border-bottom: 1.5px dashed #0d6efd;
    background: transparent;
    cursor: pointer;
    z-index: 6;
    appearance: none;
  }
  .document-scripture-link:hover,
  .document-scripture-link:focus-visible {
    background: color-mix(in srgb, #0d6efd 14%, transparent);
    outline: none;
  }
  #sidebar { display: none !important; }
</style>
</head>
<body>
${options.bodyHtml}
<script src="${compatibilityJsUrl}"><\/script>
<script src="${pdf2htmlExJsUrl}"><\/script>
<script>
(function () {
  function reportError(error) {
    window.parent.postMessage({ type: 'markup-viewer-error', message: String(error && error.message ? error.message : error) }, '*');
  }
  try {
    // Stub chrome pdf2htmlEX expects; extractShellBody may omit empty outline nodes.
    if (!document.getElementById('sidebar')) {
      var sidebar = document.createElement('div');
      sidebar.id = 'sidebar';
      document.body.insertBefore(sidebar, document.body.firstChild);
    }
    if (!document.getElementById('outline')) {
      var outline = document.createElement('div');
      outline.id = 'outline';
      document.getElementById('sidebar').appendChild(outline);
    }
    if (!document.getElementsByClassName('loading-indicator')[0]) {
      var indicator = document.createElement('div');
      indicator.className = 'loading-indicator';
      document.body.appendChild(indicator);
    }

    window.pdf2htmlEX.defaultViewer = new window.pdf2htmlEX.Viewer({
      key_handler: false,
      hashchange_handler: false,
      view_history_handler: false
    });
    var viewer = window.pdf2htmlEX.defaultViewer;
    var pendingPageLoads = {};
    var pendingScrollPageIndex = null;
    var scrollRetryTimer = null;

    function scrollToPageWhenReady(pageIndex) {
      pendingScrollPageIndex = pageIndex;
      if (scrollRetryTimer) {
        clearTimeout(scrollRetryTimer);
        scrollRetryTimer = null;
      }

      function doScroll() {
        if (pendingScrollPageIndex !== pageIndex) {
          return;
        }
        if (viewer && typeof viewer.scroll_to === 'function') {
          viewer.scroll_to(pageIndex);
        }
      }

      function attempt(remaining) {
        if (pendingScrollPageIndex !== pageIndex) {
          return;
        }
        var page = viewer.pages && viewer.pages[pageIndex];
        if (!page) {
          if (remaining > 0) {
            scrollRetryTimer = setTimeout(function () { attempt(remaining - 1); }, 100);
          }
          return;
        }

        if (page.loaded) {
          doScroll();
          // Neighbors may still be replacing placeholders — nudge after layout.
          requestAnimationFrame(function () {
            doScroll();
            requestAnimationFrame(function () {
              doScroll();
              try {
                var settled = viewer.pages && viewer.pages[pageIndex];
                if (settled && settled.loaded && typeof settled.show === 'function') {
                  settled.show();
                }
              } catch (showError) { /* ignore */ }
              window.parent.postMessage({
                type: 'markup-page-settled',
                pageIndex: pageIndex
              }, '*');
            });
          });
          return;
        }

        // load_page may ask the parent for a blob first; callback fires once content is in.
        viewer.load_page(pageIndex, undefined, function () {
          doScroll();
          requestAnimationFrame(function () {
            doScroll();
            requestAnimationFrame(function () {
              doScroll();
              try {
                var loaded = viewer.pages && viewer.pages[pageIndex];
                if (loaded && typeof loaded.show === 'function') {
                  loaded.show();
                }
              } catch (showError) { /* ignore */ }
              window.parent.postMessage({
                type: 'markup-page-settled',
                pageIndex: pageIndex
              }, '*');
            });
          });
        });
        // Best-effort with placeholder geometry while content loads.
        doScroll();
        if (remaining > 0) {
          scrollRetryTimer = setTimeout(function () { attempt(remaining - 1); }, 120);
        }
      }

      attempt(25);
    }

    function finish() {
      try {
        // Viewer registers DOMContentLoaded in the constructor. If that event already
        // fired (common with srcdoc), pages never get initialized — do it here.
        if (!viewer.pages && typeof viewer.init_after_loading_content === 'function') {
          viewer.init_after_loading_content();
        }

        // Parent only materializes a page window up front (auth cookies don't reach
        // iframe XHR). Intercept load_page so missing pages are fetched via postMessage.
        if (viewer && typeof viewer.load_page === 'function') {
          var origLoadPage = viewer.load_page.bind(viewer);
          viewer.load_page = function (pageIndex, preload, callback) {
            var wrappedCallback = function (loadedPage) {
              window.parent.postMessage({
                type: 'markup-page-settled',
                pageIndex: pageIndex
              }, '*');
              if (typeof callback === 'function') {
                try { callback(loadedPage); } catch (cbError) { /* ignore */ }
              }
            };
            var page = viewer.pages && viewer.pages[pageIndex];
            if (!page || page.loaded || viewer.pages_loading[pageIndex]) {
              return origLoadPage(pageIndex, preload, wrappedCallback);
            }
            var el = page.page;
            var blobUrl = el && el.getAttribute('data-page-url');
            var storageUrl = el && el.getAttribute('data-storage-page-url');
            if (!blobUrl && storageUrl) {
              if (!pendingPageLoads[pageIndex]) {
                pendingPageLoads[pageIndex] = [];
                window.parent.postMessage({
                  type: 'markup-need-page',
                  pageIndex: pageIndex,
                  pageUrl: storageUrl
                }, '*');
              }
              if (typeof callback === 'function') {
                pendingPageLoads[pageIndex].push(callback);
              }
              // Still walk the preload chain so neighbors get requested too.
              var remaining = typeof preload === 'undefined' ? viewer.config.preload_pages : preload;
              if (remaining > 1) {
                setTimeout(function () {
                  viewer.load_page(pageIndex + 1, remaining - 1);
                }, 0);
              }
              return;
            }
            return origLoadPage(pageIndex, preload, wrappedCallback);
          };

          window.addEventListener('message', function (event) {
            var data = event.data;
            if (!data || typeof data !== 'object') {
              return;
            }
            if (data.type === 'markup-scroll-to' && typeof data.pageIndex === 'number') {
              scrollToPageWhenReady(data.pageIndex);
              return;
            }
            if (data.type !== 'markup-page-ready') {
              return;
            }
            var idx = data.pageIndex;
            var page = viewer.pages && viewer.pages[idx];
            if (page && page.page && data.blobUrl) {
              page.page.setAttribute('data-page-url', data.blobUrl);
            }
            var callbacks = pendingPageLoads[idx] || [];
            delete pendingPageLoads[idx];
            origLoadPage(idx, 1, function (loadedPage) {
              for (var i = 0; i < callbacks.length; i += 1) {
                try { callbacks[i](loadedPage); } catch (cbError) { /* ignore */ }
              }
              window.parent.postMessage({
                type: 'markup-page-settled',
                pageIndex: idx
              }, '*');
              // Loading a page at/before the target can change cumulative offsets.
              if (
                typeof pendingScrollPageIndex === 'number'
                && idx <= pendingScrollPageIndex
                && viewer
                && typeof viewer.scroll_to === 'function'
              ) {
                viewer.scroll_to(pendingScrollPageIndex);
              }
            });
          });
        }

        // Free-scrolling shows pages without going through toolbar prev/next. Notify the
        // parent when the viewport moves or pdf2htmlEX marks a page .opened so scripture
        // links can attach to newly visible pages.
        var viewportNotifyTimer = null;
        function notifyViewportChanged() {
          if (viewportNotifyTimer) {
            clearTimeout(viewportNotifyTimer);
          }
          viewportNotifyTimer = setTimeout(function () {
            window.parent.postMessage({ type: 'markup-viewport-changed' }, '*');
          }, 100);
        }
        var pageContainer = document.getElementById('page-container');
        if (pageContainer) {
          pageContainer.addEventListener('scroll', notifyViewportChanged, { passive: true });
          try {
            var openedObserver = new MutationObserver(function (mutations) {
              for (var m = 0; m < mutations.length; m += 1) {
                var target = mutations[m].target;
                if (
                  target
                  && target.classList
                  && (target.classList.contains('pc') || target.classList.contains('opened'))
                ) {
                  notifyViewportChanged();
                  return;
                }
              }
            });
            openedObserver.observe(pageContainer, {
              subtree: true,
              attributes: true,
              attributeFilter: ['class']
            });
          } catch (observerError) { /* ignore */ }
        }

        // Rescale before scroll so page offset geometry matches the active zoom.
        if (viewer && typeof viewer.rescale === 'function') {
          viewer.rescale(${options.initialScale});
        }
        scrollToPageWhenReady(${pageIndex});
        window.parent.postMessage({
          type: 'markup-viewer-ready',
          pageCount: document.querySelectorAll('#page-container .pf').length
        }, '*');
      } catch (error) {
        reportError(error);
      }
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', finish);
    } else {
      finish();
    }
  } catch (error) {
    reportError(error);
  }
})();
<\/script>
</body>
</html>`;
}

type HighlightAttemptResult =
  | { status: 'highlighted'; element: HTMLElement }
  | { status: 'no-match' }
  | { status: 'not-ready' };

/** Highlights every occurrence of every raw on the page; `element` is the first overlay in page order. */
function attemptHighlightMatchesInPage(pageElement: HTMLElement, rawMatchTexts: readonly string[]): HighlightAttemptResult {
  const normalizedNeedles = rawMatchTexts.map(normalizeMatchText).filter(Boolean);
  if (normalizedNeedles.length === 0) {
    return { status: 'no-match' };
  }

  // pdf2htmlEX keeps .pc at display:none until shown; rects are zero then — caller should retry.
  const contentBox = pageElement.querySelector<HTMLElement>('.pc');
  if (contentBox && !contentBox.classList.contains('opened')) {
    return { status: 'not-ready' };
  }

  pageElement.querySelectorAll('.markup-raw-highlight').forEach((node) => node.remove());

  const textNodes = Array.from(pageElement.querySelectorAll<HTMLElement>('.t'));
  if (textNodes.length === 0) {
    return { status: 'not-ready' };
  }

  const { haystack, ranges } = buildTextLayerHaystack(textNodes, normalizeMatchText);

  if (!haystack) {
    return { status: 'not-ready' };
  }

  const matches = findAllMatchRanges(haystack, normalizedNeedles);
  if (matches.length === 0) {
    // Text is present and visible enough to search; needles simply aren't on this page.
    if (pageHasHighlightableText(pageElement)) {
      return { status: 'no-match' };
    }
    return { status: 'not-ready' };
  }

  let firstHighlight: HTMLElement | null = null;
  for (const { start: matchStart, end: matchEnd } of matches) {
    for (const range of ranges) {
      if (range.end <= matchStart || range.start >= matchEnd) {
        continue;
      }

      for (const rect of getMatchClientRects(range, matchStart, matchEnd)) {
        const highlight = pageElement.ownerDocument.createElement('div');
        highlight.className = 'markup-raw-highlight';
        if (rect.width < 0.5 || rect.height < 0.5 || !placeOverlayOnPage(highlight, pageElement, rect)) {
          pageElement.querySelectorAll('.markup-raw-highlight').forEach((node) => node.remove());
          return { status: 'not-ready' };
        }
        if (!firstHighlight) {
          firstHighlight = highlight;
        }
      }
    }
  }

  if (!firstHighlight) {
    return { status: 'not-ready' };
  }
  return { status: 'highlighted', element: firstHighlight };
}

function pageHasHighlightableText(pageElement: HTMLElement): boolean {
  const contentBox = pageElement.querySelector<HTMLElement>('.pc');
  if (contentBox && !contentBox.classList.contains('opened')) {
    return false;
  }
  const textNodes = pageElement.querySelectorAll<HTMLElement>('.t');
  if (textNodes.length === 0) {
    return false;
  }
  for (const node of textNodes) {
    const rect = node.getBoundingClientRect();
    if (rect.width >= 0.5 && rect.height >= 0.5) {
      return true;
    }
  }
  return false;
}

function resolveMarkupPageNumber(pageElement: HTMLElement, fallbackIndex: number): number {
  const idMatch = pageElement.id.match(/^pf(\d+)$/i);
  if (idMatch) {
    const fromId = Number.parseInt(idMatch[1] ?? '', 10);
    if (Number.isInteger(fromId) && fromId > 0) {
      return fromId;
    }
  }

  const dataPageNo = pageElement.getAttribute('data-page-no');
  if (dataPageNo) {
    const asDecimal = Number.parseInt(dataPageNo, 10);
    if (Number.isInteger(asDecimal) && asDecimal > 0 && String(asDecimal) === dataPageNo) {
      return asDecimal;
    }
    const asHex = Number.parseInt(dataPageNo, 16);
    if (Number.isInteger(asHex) && asHex > 0) {
      return asHex;
    }
  }

  return fallbackIndex + 1;
}

function listMarkupPageElements(doc: Document): Array<{ pageNumber: number; element: HTMLElement }> {
  const frames = Array.from(doc.querySelectorAll<HTMLElement>('#page-container .pf'));
  return frames.map((element, index) => ({
    pageNumber: resolveMarkupPageNumber(element, index),
    element,
  }));
}

const MarkupDocumentViewer: React.FC = () => {
  const dispatch = useAppDispatch();
  const { pdfViewer } = useAppSelector((state) => state.ui);
  const currentBible = useAppSelector((state) => state.bible.currentBible);
  const openScriptureReference = useOpenDocumentScriptureReference();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const pageBlobUrlsRef = useRef<string[]>([]);
  const pageUrlsRef = useRef<string[]>([]);
  const pageBlobsRef = useRef<Map<string, string>>(new Map());
  const assetBlobsRef = useRef<Map<string, string>>(new Map());
  const storageOriginRef = useRef('');
  const pagesBaseUrlRef = useRef('');
  const materializingPagesRef = useRef<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1);
  const [fitWidth, setFitWidth] = useState(true);
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [highlightEpoch, setHighlightEpoch] = useState(0);
  const [scriptureLinkEpoch, setScriptureLinkEpoch] = useState(0);
  const highlightAttemptedRef = useRef(false);
  const scriptureLinkedPagesRef = useRef<Set<number>>(new Set());
  const openScriptureReferenceRef = useRef(openScriptureReference);
  openScriptureReferenceRef.current = openScriptureReference;

  const activeSourceUrl = pdfViewer.sourceUrl;
  const activePage = Math.max(1, pdfViewer.page);
  const matchRaws = pdfViewer.matchRaws;
  const focusNonce = pdfViewer.focusNonce || 0;

  const title = useMemo(() => {
    if (pdfViewer.title && pdfViewer.title.trim().length > 0) {
      return pdfViewer.title;
    }
    return 'Document Viewer';
  }, [pdfViewer.title]);

  const adjustScale = (direction: -1 | 1) => {
    setFitWidth(false);
    setScale((current) => stepScale(current, direction));
  };

  const zoomTo = (next: number) => {
    setFitWidth(false);
    setScale(clampScale(next));
  };

  const applyPageBlobsToIframe = (pageBlobs: Map<string, string>) => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) {
      return;
    }
    const frames = Array.from(doc.querySelectorAll<HTMLElement>('#page-container .pf'));
    const pageUrls = pageUrlsRef.current;
    for (let index = 0; index < pageUrls.length; index += 1) {
      const pageUrl = pageUrls[index];
      const blobUrl = pageBlobs.get(pageUrl);
      const frame = frames[index];
      if (!blobUrl || !frame) {
        continue;
      }
      frame.setAttribute('data-page-url', blobUrl);
      iframeRef.current?.contentWindow?.postMessage({
        type: 'markup-page-ready',
        pageIndex: index,
        blobUrl,
      }, '*');
    }
  };

  const ensurePagesMaterialized = async (centerIndex: number): Promise<void> => {
    const pageUrls = pageUrlsRef.current;
    const storageOrigin = storageOriginRef.current;
    if (!storageOrigin || pageUrls.length === 0) {
      return;
    }

    const neededUrls = pageWindowIndices(centerIndex, pageUrls.length)
      .map((index) => pageUrls[index])
      .filter((url): url is string => Boolean(url) && !pageBlobsRef.current.has(url) && !materializingPagesRef.current.has(url));

    if (neededUrls.length === 0) {
      return;
    }

    for (const url of neededUrls) {
      materializingPagesRef.current.add(url);
    }

    try {
      const newBlobs = await materializePages(
        neededUrls,
        storageOrigin,
        assetBlobsRef.current,
        pageBlobUrlsRef.current
      );
      for (const [pageUrl, blobUrl] of newBlobs) {
        pageBlobsRef.current.set(pageUrl, blobUrl);
      }
      applyPageBlobsToIframe(newBlobs);
    } finally {
      for (const url of neededUrls) {
        materializingPagesRef.current.delete(url);
      }
    }
  };

  useEffect(() => {
    if (!pdfViewer.isOpen || pdfViewer.kind !== 'markup' || !activeSourceUrl) {
      return;
    }

    let cancelled = false;
    const shellUrl = buildMarkupDocumentShellUrl(activeSourceUrl);
    const pagesBaseUrl = resolvePagesBaseUrl(shellUrl);
    pagesBaseUrlRef.current = pagesBaseUrl;
    const initialPageIndex = Math.max(0, activePage - 1);

    setIsLoading(true);
    setError(null);
    setSrcDoc(null);
    setPageCount(0);
    highlightAttemptedRef.current = false;
    for (const url of pageBlobUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    pageBlobUrlsRef.current = [];
    pageUrlsRef.current = [];
    pageBlobsRef.current = new Map();
    assetBlobsRef.current = new Map();
    storageOriginRef.current = '';
    materializingPagesRef.current.clear();

    void (async () => {
      try {
        const response = await fetchStorageAware(shellUrl);
        if (!response.ok) {
          throw new Error(`Failed to load document shell (${response.status})`);
        }
        const html = await response.text();
        if (cancelled) {
          return;
        }
        const { documentCssUrl, bodyHtml } = extractShellBody(html, pagesBaseUrl);
        const counted = countPagePlaceholders(bodyHtml);
        setPageCount(counted);
        const materialized = await materializeMarkupDocument(
          bodyHtml,
          pagesBaseUrl,
          documentCssUrl,
          initialPageIndex
        );
        if (cancelled) {
          for (const url of materialized.blobUrls) {
            URL.revokeObjectURL(url);
          }
          return;
        }
        pageBlobUrlsRef.current = materialized.blobUrls;
        pageUrlsRef.current = materialized.pageUrls;
        pageBlobsRef.current = materialized.pageBlobs;
        assetBlobsRef.current = materialized.assetBlobs;
        storageOriginRef.current = materialized.storageOrigin;
        setSrcDoc(buildViewerSrcDoc({
          pagesBaseUrl,
          documentCssText: materialized.documentCssText,
          bodyHtml: materialized.bodyHtml,
          initialPage: activePage,
          initialScale: scale,
        }));
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      for (const url of pageBlobUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      pageBlobUrlsRef.current = [];
      pageUrlsRef.current = [];
      pageBlobsRef.current = new Map();
      assetBlobsRef.current = new Map();
      storageOriginRef.current = '';
      materializingPagesRef.current.clear();
    };
    // Re-fetch shell when source changes; page/scale applied via viewer API afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfViewer.isOpen, pdfViewer.kind, activeSourceUrl]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as {
        type?: string;
        pageCount?: number;
        message?: string;
        pageIndex?: number;
        pageUrl?: string;
      } | null;
      if (!data || typeof data !== 'object') {
        return;
      }
      if (data.type === 'markup-viewer-ready') {
        if (typeof data.pageCount === 'number' && data.pageCount > 0) {
          setPageCount(data.pageCount);
        }
        setIsLoading(false);
        setError(null);
        return;
      }
      if (data.type === 'markup-viewer-error') {
        setIsLoading(false);
        setError(data.message || 'Failed to initialize markup viewer');
        return;
      }
      if (data.type === 'markup-page-settled' && typeof data.pageIndex === 'number') {
        // Page DOM may have been freshly materialized; allow re-linking.
        scriptureLinkedPagesRef.current.delete(data.pageIndex + 1);
        setScriptureLinkEpoch((value) => value + 1);
        if (data.pageIndex === Math.max(0, activePage - 1)) {
          highlightAttemptedRef.current = false;
          setHighlightEpoch((value) => value + 1);
        }
        return;
      }
      if (data.type === 'markup-viewport-changed') {
        // Free-scroll showed additional .opened pages; scan without clearing linked ones.
        setScriptureLinkEpoch((value) => value + 1);
        return;
      }
      if (data.type === 'markup-need-page' && typeof data.pageIndex === 'number') {
        void ensurePagesMaterialized(data.pageIndex).catch((loadError) => {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        });
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [activePage]);

  // Prefetch around the toolbar page when the user navigates.
  useEffect(() => {
    if (isLoading || !srcDoc) {
      return;
    }
    void ensurePagesMaterialized(Math.max(0, activePage - 1)).catch(() => {
      // Errors surface via markup-need-page / load path.
    });
  }, [activePage, focusNonce, isLoading, srcDoc]);

  // Scroll after pages in the window are materialized; focusNonce re-fires on same-page re-clicks.
  useEffect(() => {
    if (isLoading || !srcDoc) {
      return;
    }

    let cancelled = false;
    const pageIndex = Math.max(0, activePage - 1);

    void (async () => {
      try {
        await ensurePagesMaterialized(pageIndex);
      } catch {
        // Scroll may still succeed with placeholder geometry.
      }
      if (cancelled) {
        return;
      }
      iframeRef.current?.contentWindow?.postMessage({
        type: 'markup-scroll-to',
        pageIndex,
      }, '*');
      highlightAttemptedRef.current = false;
    })();

    return () => {
      cancelled = true;
    };
  }, [activePage, focusNonce, isLoading, srcDoc]);

  useEffect(() => {
    const viewer = iframeRef.current?.contentWindow?.pdf2htmlEX?.defaultViewer;
    if (!viewer || typeof viewer.rescale !== 'function') {
      return;
    }
    viewer.rescale(scale);
  }, [scale, srcDoc, isLoading]);

  useEffect(() => {
    if (!fitWidth || isLoading || !srcDoc) {
      return;
    }

    let retryTimer: number | undefined;
    let attempts = 0;
    const applyFit = () => {
      window.clearTimeout(retryTimer);
      const next = computeMarkupFitWidthScale(iframeRef.current);
      if (next !== null) {
        setScale(next);
      } else if (attempts < 20) {
        attempts += 1;
        retryTimer = window.setTimeout(applyFit, 100);
      }
    };

    applyFit();
    const stage = stageRef.current;
    const observer = stage && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(applyFit) : null;
    observer?.observe(stage!);
    return () => {
      window.clearTimeout(retryTimer);
      observer?.disconnect();
    };
  }, [fitWidth, isLoading, srcDoc]);

  useEffect(() => {
    if (matchRaws.length === 0 || isLoading || highlightAttemptedRef.current) {
      return;
    }

    const doc = iframeRef.current?.contentDocument;
    if (!doc) {
      return;
    }

    let cancelled = false;
    let attempts = 0;

    const tryHighlight = () => {
      if (cancelled) {
        return;
      }
      attempts += 1;
      const pageElement = doc.querySelector<HTMLElement>(`#pf${activePage}, [data-page-no="${activePage.toString(16)}"], [data-page-no="${activePage}"]`);
      if (!pageElement) {
        if (attempts < 50) {
          window.setTimeout(tryHighlight, 120);
        }
        return;
      }

      const result = attemptHighlightMatchesInPage(pageElement, matchRaws);
      if (result.status === 'not-ready') {
        if (attempts < 50) {
          window.setTimeout(tryHighlight, 120);
        }
        return;
      }

      highlightAttemptedRef.current = true;
      if (result.status === 'highlighted') {
        result.element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      }
    };

    tryHighlight();
    return () => {
      cancelled = true;
    };
  }, [matchRaws, activePage, focusNonce, highlightEpoch, isLoading, srcDoc]);

  useEffect(() => {
    // Overlays are page-relative, so only a document change invalidates them.
    scriptureLinkedPagesRef.current.clear();
    setScriptureLinkEpoch((value) => value + 1);
  }, [srcDoc, activeSourceUrl]);

  useEffect(() => {
    if (isLoading || !srcDoc || !currentBible?.books?.length) {
      return;
    }

    const doc = iframeRef.current?.contentDocument;
    if (!doc) {
      return;
    }

    let cancelled = false;
    const books = currentBible.books;
    const pagesBaseUrl = pagesBaseUrlRef.current || null;

    const applyLinksToReadyPages = async () => {
      if (cancelled) {
        return;
      }

      const pages = listMarkupPageElements(doc);
      for (const { pageNumber, element } of pages) {
        if (cancelled) {
          return;
        }
        if (scriptureLinkedPagesRef.current.has(pageNumber)) {
          continue;
        }
        if (!pageHasHighlightableText(element)) {
          continue;
        }

        const textNodes = Array.from(element.querySelectorAll<HTMLElement>('.t'));
        const pageText = textNodes.map((node) => node.textContent ?? '').join(' ');
        const references = await loadPageScriptureReferences({
          pageNumber,
          books,
          pagesBaseUrl,
          pageText,
        });

        if (cancelled) {
          return;
        }

        // Mark linked even when empty so we don't keep refetching empty pages.
        scriptureLinkedPagesRef.current.add(pageNumber);
        if (references.length === 0) {
          clearScriptureLinks(element);
          continue;
        }

        applyScriptureLinkOverlays(element, textNodes, references, (reference) => {
          void openScriptureReferenceRef.current(reference);
        });
      }
    };

    void applyLinksToReadyPages();
    const retryTimer = window.setTimeout(() => {
      void applyLinksToReadyPages();
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
    };
  }, [isLoading, srcDoc, currentBible, scriptureLinkEpoch]);

  useViewerZoomInputs({
    enabled: pdfViewer.isOpen && pdfViewer.kind === 'markup',
    stageRef,
    frameRef: iframeRef,
    frameKey: srcDoc && !error ? srcDoc : null,
    scale,
    onZoomStep: adjustScale,
    onZoomReset: () => setFitWidth(true),
    onZoomTo: zoomTo,
  });

  if (!pdfViewer.isOpen || pdfViewer.kind !== 'markup') {
    return null;
  }

  return (
    <div className="pdf-viewer-shell markup-viewer-shell d-flex flex-column h-100">
      <div className="pdf-viewer-toolbar d-flex flex-wrap align-items-center gap-2 border-bottom pb-2 mb-3">
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          onClick={() => dispatch(closeDocumentViewer())}
        >
          <i className="fa-solid fa-arrow-left me-1" aria-hidden="true"></i>
          Back To Verses
        </button>

        <div className="pdf-viewer-title fw-semibold text-truncate" title={title}>{title}</div>

        <div className="ms-auto d-flex align-items-center gap-2">
          <FileSyncExclusionButton syncItem={pdfViewer.syncItem} documentLabel={title} />

          <span className="small text-body-secondary">
            Page {pageCount > 0 ? activePage : '-'}{pageCount > 0 ? ` / ${pageCount}` : ''}
          </span>

          <ViewerZoomControls
            scale={scale}
            fitWidth={fitWidth}
            onZoomStep={adjustScale}
            onFitWidth={() => setFitWidth(true)}
          />
        </div>
      </div>

      <div ref={stageRef} className="pdf-viewer-stage markup-viewer-stage flex-grow-1 position-relative">
        {error && (
          <div className="alert alert-danger m-3" role="alert">{error}</div>
        )}
        {srcDoc && !error && (
          <iframe
            ref={iframeRef}
            className="markup-viewer-frame"
            title={title}
            srcDoc={srcDoc}
            sandbox="allow-scripts allow-same-origin"
            onLoad={() => {
              // Fallback if postMessage ready is missed (srcdoc + sandbox can be flaky).
              setIsLoading((current) => (current ? false : current));
            }}
          />
        )}
        {isLoading && !error && (
          <div className="pdf-loading-overlay" role="status" aria-live="polite" aria-label="Loading document">
            <div className="spinner-border text-secondary" role="presentation"></div>
            <span>Loading document...</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default MarkupDocumentViewer;
