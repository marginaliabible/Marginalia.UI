import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { closeDocumentViewer, setPdfViewerPage } from '../store/slices/uiSlice';
import { buildMarkupDocumentShellUrl } from '../utils/resourceLibraryConfig';
import { fetchStorageAware } from '../services/storageAuthenticatedFetch';

const MIN_SCALE = 0.6;
const MAX_SCALE = 2.4;
const SCALE_STEP = 0.2;
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
  pages?: Array<{ loaded?: boolean; page?: HTMLElement | null }>;
}

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(value.toFixed(2))));
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
    .replace(/url\((["']?)(\/assets\/[^"')]+)\1\)/gi, (full, quote: string, assetPath: string) => {
      const absolute = `${storageOrigin}${assetPath}`;
      const blob = assetBlobs.get(absolute) || assetBlobs.get(assetPath);
      if (!blob) {
        return `url(${quote}${absolute}${quote})`;
      }
      return `url(${quote}${blob}${quote})`;
    })
    .replace(/(src|href)=(["'])(\/assets\/[^"']+)\2/gi, (full, attr: string, quote: string, assetPath: string) => {
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
    background: color-mix(in srgb, #ff9a3b 62%, transparent);
    z-index: 5;
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
            var page = viewer.pages && viewer.pages[pageIndex];
            if (!page || page.loaded || viewer.pages_loading[pageIndex]) {
              return origLoadPage(pageIndex, preload, callback);
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
            return origLoadPage(pageIndex, preload, callback);
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

function attemptHighlightMatchInPage(pageElement: HTMLElement, rawMatchText: string): HighlightAttemptResult {
  const normalizedNeedle = normalizeMatchText(rawMatchText);
  if (!normalizedNeedle) {
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

  let haystack = '';
  const ranges: Array<{ node: HTMLElement; start: number; end: number }> = [];
  for (const node of textNodes) {
    const text = normalizeMatchText(node.textContent ?? '');
    if (!text) {
      continue;
    }
    const start = haystack.length;
    haystack += `${text} `;
    ranges.push({ node, start, end: haystack.length });
  }

  if (!haystack) {
    return { status: 'not-ready' };
  }

  const matchStart = haystack.indexOf(normalizedNeedle);
  if (matchStart < 0) {
    // Text is present and visible enough to search; needle simply isn't on this page.
    if (pageHasHighlightableText(pageElement)) {
      return { status: 'no-match' };
    }
    return { status: 'not-ready' };
  }
  const matchEnd = matchStart + normalizedNeedle.length;

  let firstHighlight: HTMLElement | null = null;
  for (const range of ranges) {
    if (range.end <= matchStart || range.start >= matchEnd) {
      continue;
    }

    const rect = range.node.getBoundingClientRect();
    const pageRect = pageElement.getBoundingClientRect();
    if (rect.width < 0.5 || rect.height < 0.5 || pageRect.width < 0.5 || pageRect.height < 0.5) {
      pageElement.querySelectorAll('.markup-raw-highlight').forEach((node) => node.remove());
      return { status: 'not-ready' };
    }

    const highlight = pageElement.ownerDocument.createElement('div');
    highlight.className = 'markup-raw-highlight';
    highlight.style.left = `${rect.left - pageRect.left}px`;
    highlight.style.top = `${rect.top - pageRect.top}px`;
    highlight.style.width = `${Math.max(rect.width, 2)}px`;
    highlight.style.height = `${Math.max(rect.height, 2)}px`;
    pageElement.style.position = pageElement.style.position || 'relative';
    pageElement.appendChild(highlight);
    if (!firstHighlight) {
      firstHighlight = highlight;
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

const MarkupDocumentViewer: React.FC = () => {
  const dispatch = useAppDispatch();
  const { pdfViewer } = useAppSelector((state) => state.ui);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const pageBlobUrlsRef = useRef<string[]>([]);
  const pageUrlsRef = useRef<string[]>([]);
  const pageBlobsRef = useRef<Map<string, string>>(new Map());
  const assetBlobsRef = useRef<Map<string, string>>(new Map());
  const storageOriginRef = useRef('');
  const materializingPagesRef = useRef<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1);
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [highlightEpoch, setHighlightEpoch] = useState(0);
  const highlightAttemptedRef = useRef(false);

  const activeSourceUrl = pdfViewer.sourceUrl;
  const activePage = Math.max(1, pdfViewer.page);
  const matchRaw = pdfViewer.matchRaw;
  const focusNonce = pdfViewer.focusNonce || 0;

  const title = useMemo(() => {
    if (pdfViewer.title && pdfViewer.title.trim().length > 0) {
      return pdfViewer.title;
    }
    return 'Document Viewer';
  }, [pdfViewer.title]);

  const goToPage = (pageNumber: number) => {
    const next = Math.max(1, pageCount > 0 ? Math.min(pageCount, pageNumber) : pageNumber);
    dispatch(setPdfViewerPage(next));
  };

  const adjustScale = (direction: -1 | 1) => {
    setScale((current) => clampScale(current + direction * SCALE_STEP));
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
        if (data.pageIndex === Math.max(0, activePage - 1)) {
          highlightAttemptedRef.current = false;
          setHighlightEpoch((value) => value + 1);
        }
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
    if (!matchRaw || isLoading || highlightAttemptedRef.current) {
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

      const result = attemptHighlightMatchInPage(pageElement, matchRaw);
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
  }, [matchRaw, activePage, focusNonce, highlightEpoch, isLoading, srcDoc]);

  if (!pdfViewer.isOpen || pdfViewer.kind !== 'markup') {
    return null;
  }

  const canGoBack = activePage > 1;
  const canGoForward = pageCount > 0 && activePage < pageCount;

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
          <button
            type="button"
            className="btn btn-sm btn-outline-primary"
            disabled={!canGoBack}
            onClick={() => goToPage(activePage - 1)}
          >
            Prev
          </button>

          <span className="small text-body-secondary">
            Page {pageCount > 0 ? activePage : '-'}{pageCount > 0 ? ` / ${pageCount}` : ''}
          </span>

          <button
            type="button"
            className="btn btn-sm btn-outline-primary"
            disabled={!canGoForward}
            onClick={() => goToPage(activePage + 1)}
          >
            Next
          </button>

          <div className="btn-group btn-group-sm" role="group" aria-label="Zoom controls">
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={() => adjustScale(-1)}
              title="zoom out"
              aria-label="zoom out"
              disabled={scale <= MIN_SCALE}
            >
              <i className="fa-solid fa-magnifying-glass-minus" aria-hidden="true"></i>
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={() => setScale(1)}
              title="reset zoom"
              aria-label="reset zoom"
            >
              {Math.round(scale * 100)}%
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={() => adjustScale(1)}
              title="zoom in"
              aria-label="zoom in"
              disabled={scale >= MAX_SCALE}
            >
              <i className="fa-solid fa-magnifying-glass-plus" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      </div>

      <div className="pdf-viewer-stage markup-viewer-stage flex-grow-1 position-relative">
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
