import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import {
  EventBus,
  PDFLinkService,
  PDFViewer,
  ScrollMode,
} from 'pdfjs-dist/web/pdf_viewer.mjs';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { closePdfViewer, setPdfViewerPage } from '../store/slices/uiSlice';
import { useOpenDocumentScriptureReference } from '../hooks/useDocumentScriptureNavigation';
import { loadPageScriptureReferences } from '../utils/loadPageScriptureReferences';
import { applyScriptureLinkOverlays, clearScriptureLinks } from '../utils/scriptureLinkOverlays';
import FileSyncExclusionButton from './FileSyncExclusionButton';

GlobalWorkerOptions.workerSrc = workerUrl;

const MIN_SCALE = 0.6;
const MAX_SCALE = 2.4;
const SCALE_STEP = 0.2;
const RANGE_CHUNK_SIZE = 1024 * 1024;
const OCR_SPACE_PATTERN = /[\s\u00A0\u1680\u180E\u2000-\u200D\u2028\u2029\u202F\u205F\u2060\u3000\uFEFF\u0000-\u001F]+/g;

const clampScale = (value: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(value.toFixed(2))));

const normalizeMatchText = (value: string | null | undefined): string => {
  if (!value) {
    return '';
  }
  return value.replace(OCR_SPACE_PATTERN, ' ').trim();
};

const getTouchDistance = (event: React.TouchEvent<HTMLElement>): number => {
  if (event.touches.length < 2) {
    return 0;
  }
  const [a, b] = [event.touches[0], event.touches[1]];
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
};

const sanitizeFileName = (value: string): string => {
  const next = value.replace(/[<>:"/\\|?*]+/g, '').trim();
  return next.length > 0 ? next : 'document';
};

function clearRawHighlights(root: ParentNode | null | undefined): void {
  root?.querySelectorAll('.pdf-raw-highlight').forEach((node) => node.remove());
}

function resolvePagesBaseUrlForPdf(sourceUrl: string | null | undefined): string | null {
  if (!sourceUrl) {
    return null;
  }
  try {
    const url = new URL(sourceUrl, window.location.href);
    if (/\/pages(?:\/|$)/i.test(url.pathname)) {
      if (/\/index\.html$/i.test(url.pathname)) {
        url.pathname = url.pathname.replace(/\/index\.html$/i, '/');
      } else if (!url.pathname.endsWith('/')) {
        const pagesIndex = url.pathname.toLowerCase().lastIndexOf('/pages');
        url.pathname = `${url.pathname.slice(0, pagesIndex + '/pages'.length)}/`;
      }
      url.search = '';
      url.hash = '';
      return url.toString();
    }
  } catch {
    return null;
  }
  return null;
}

function highlightMatchOnPageView(pageViewRoot: HTMLElement, rawMatchText: string): HTMLElement | null {
  const normalizedNeedle = normalizeMatchText(rawMatchText).toLowerCase();
  if (!normalizedNeedle) {
    return null;
  }

  clearRawHighlights(pageViewRoot);

  const textLayer = pageViewRoot.querySelector('.textLayer');
  if (!textLayer) {
    return null;
  }

  const spans = Array.from(textLayer.querySelectorAll<HTMLElement>('span'));
  if (spans.length === 0) {
    return null;
  }

  let haystack = '';
  const ranges: Array<{ node: HTMLElement; start: number; end: number }> = [];
  for (const span of spans) {
    const text = normalizeMatchText(span.textContent ?? '').toLowerCase();
    if (!text) {
      continue;
    }
    const start = haystack.length;
    haystack += `${text} `;
    ranges.push({ node: span, start, end: haystack.length });
  }

  const matchStart = haystack.indexOf(normalizedNeedle);
  if (matchStart < 0) {
    return null;
  }
  const matchEnd = matchStart + normalizedNeedle.length;

  let firstHighlight: HTMLElement | null = null;
  const pageRect = pageViewRoot.getBoundingClientRect();

  for (const range of ranges) {
    if (range.end <= matchStart || range.start >= matchEnd) {
      continue;
    }

    const rect = range.node.getBoundingClientRect();
    const highlight = pageViewRoot.ownerDocument.createElement('div');
    highlight.className = 'pdf-raw-highlight';
    highlight.style.left = `${rect.left - pageRect.left}px`;
    highlight.style.top = `${rect.top - pageRect.top}px`;
    highlight.style.width = `${Math.max(rect.width, 2)}px`;
    highlight.style.height = `${Math.max(rect.height, 2)}px`;
    pageViewRoot.appendChild(highlight);
    if (!firstHighlight) {
      firstHighlight = highlight;
    }
  }

  return firstHighlight;
}

const PdfViewerPane: React.FC = () => {
  const dispatch = useAppDispatch();
  const { pdfViewer } = useAppSelector((state) => state.ui);
  const currentBible = useAppSelector((state) => state.bible.currentBible);
  const openScriptureReference = useOpenDocumentScriptureReference();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<PDFViewer | null>(null);
  const eventBusRef = useRef<EventBus | null>(null);
  const linkServiceRef = useRef<PDFLinkService | null>(null);
  const loadingTaskRef = useRef<{ destroy: () => void } | null>(null);
  const documentProxyRef = useRef<PDFDocumentProxy | null>(null);
  const pinchStartDistanceRef = useRef(0);
  const pinchStartScaleRef = useRef(1);
  const highlightAttemptedRef = useRef(false);
  const syncingPageFromViewerRef = useRef(false);
  const scriptureLinkedPagesRef = useRef<Set<number>>(new Set());
  const openScriptureReferenceRef = useRef(openScriptureReference);
  openScriptureReferenceRef.current = openScriptureReference;
  const currentBibleRef = useRef(currentBible);
  currentBibleRef.current = currentBible;
  const activeSourceUrlRef = useRef(pdfViewer.sourceUrl);
  activeSourceUrlRef.current = pdfViewer.sourceUrl;

  const [pageCount, setPageCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [viewerReady, setViewerReady] = useState(false);

  const activeSourceUrl = pdfViewer.sourceUrl;
  const activePage = Math.max(1, pdfViewer.page);
  const matchRaw = normalizeMatchText(pdfViewer.matchRaw);
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

  // Create viewer once container mounts.
  useEffect(() => {
    if (!pdfViewer.isOpen || pdfViewer.kind === 'markup') {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });
    const pdfViewerInstance = new PDFViewer({
      container,
      eventBus,
      linkService,
      textLayerMode: 1,
      annotationMode: 2,
      removePageBorders: false,
    });
    linkService.setViewer(pdfViewerInstance);
    pdfViewerInstance.scrollMode = ScrollMode.VERTICAL;

    eventBusRef.current = eventBus;
    linkServiceRef.current = linkService;
    viewerRef.current = pdfViewerInstance;
    setViewerReady(true);

    const onPageChanging = (evt: { pageNumber?: number }) => {
      if (typeof evt.pageNumber !== 'number') {
        return;
      }
      syncingPageFromViewerRef.current = true;
      dispatch(setPdfViewerPage(evt.pageNumber));
      queueMicrotask(() => {
        syncingPageFromViewerRef.current = false;
      });
      // Scroll may bring already-cached pages into view without a fresh textlayerrendered.
      void scanRenderedPagesForLinks();
    };
    eventBus.on('pagechanging', onPageChanging);

    const applyLinksForPage = async (pageNumber: number) => {
      const books = currentBibleRef.current?.books;
      if (!books?.length) {
        return;
      }
      if (scriptureLinkedPagesRef.current.has(pageNumber)) {
        return;
      }

      const pageView = pdfViewerInstance.getPageView(pageNumber - 1) as { div?: HTMLElement } | undefined;
      const pageRoot = pageView?.div;
      const spans = pageRoot
        ? Array.from(pageRoot.querySelectorAll<HTMLElement>('.textLayer span'))
        : [];
      if (!pageRoot || spans.length === 0) {
        return;
      }

      const pageText = spans.map((span) => span.textContent ?? '').join(' ');
      const references = await loadPageScriptureReferences({
        pageNumber,
        books,
        pagesBaseUrl: resolvePagesBaseUrlForPdf(activeSourceUrlRef.current),
        pageText,
      });

      // Page may have been torn down or re-rendered while we fetched.
      if (!pageRoot.isConnected || scriptureLinkedPagesRef.current.has(pageNumber)) {
        return;
      }

      scriptureLinkedPagesRef.current.add(pageNumber);
      if (references.length === 0) {
        clearScriptureLinks(pageRoot);
        return;
      }

      applyScriptureLinkOverlays(pageRoot, spans, references, (reference) => {
        void openScriptureReferenceRef.current(reference);
      });
    };

    const scanRenderedPagesForLinks = async () => {
      const total = pdfViewerInstance.pagesCount || 0;
      for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
        if (scriptureLinkedPagesRef.current.has(pageNumber)) {
          continue;
        }
        await applyLinksForPage(pageNumber);
      }
    };

    const onTextLayerRendered = (evt: { pageNumber?: number }) => {
      if (typeof evt.pageNumber !== 'number' || evt.pageNumber < 1) {
        return;
      }
      // Text layers re-render on zoom / virtualization; allow a fresh link pass.
      scriptureLinkedPagesRef.current.delete(evt.pageNumber);
      void applyLinksForPage(evt.pageNumber);
    };
    eventBus.on('textlayerrendered', onTextLayerRendered);

    const onPageRendered = (evt: { pageNumber?: number }) => {
      if (typeof evt.pageNumber !== 'number' || evt.pageNumber < 1) {
        return;
      }
      void applyLinksForPage(evt.pageNumber);
    };
    eventBus.on('pagerendered', onPageRendered);

    return () => {
      eventBus.off('pagechanging', onPageChanging);
      eventBus.off('textlayerrendered', onTextLayerRendered);
      eventBus.off('pagerendered', onPageRendered);
      try {
        // pdf.js cleanup path accepts null at runtime.
        (pdfViewerInstance as { setDocument: (doc: PDFDocumentProxy | null) => void }).setDocument(null);
      } catch {
        // ignore
      }
      viewerRef.current = null;
      eventBusRef.current = null;
      linkServiceRef.current = null;
      setViewerReady(false);
      container.replaceChildren();
    };
  }, [pdfViewer.isOpen, pdfViewer.kind, dispatch]);

  // Load document when source changes.
  useEffect(() => {
    if (!pdfViewer.isOpen || pdfViewer.kind === 'markup' || !viewerReady || !activeSourceUrl) {
      return;
    }

    const viewer = viewerRef.current;
    const linkService = linkServiceRef.current;
    if (!viewer || !linkService) {
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setPageCount(0);
    highlightAttemptedRef.current = false;
    scriptureLinkedPagesRef.current.clear();

    const previousTask = loadingTaskRef.current;
    loadingTaskRef.current = null;
    previousTask?.destroy();
    documentProxyRef.current?.destroy().catch(() => undefined);
    documentProxyRef.current = null;

    const loadingTask = getDocument({
      url: activeSourceUrl,
      rangeChunkSize: RANGE_CHUNK_SIZE,
      disableAutoFetch: true,
      disableStream: false,
    });
    loadingTaskRef.current = loadingTask;

    void (async () => {
      try {
        const pdfDocument = await loadingTask.promise;
        if (cancelled) {
          await pdfDocument.destroy();
          return;
        }
        documentProxyRef.current = pdfDocument;
        setPageCount(pdfDocument.numPages);
        viewer.setDocument(pdfDocument);
        linkService.setDocument(pdfDocument, null);
        viewer.currentScale = scale;
        viewer.currentPageNumber = activePage;
        setIsLoading(false);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      loadingTask.destroy();
      if (loadingTaskRef.current === loadingTask) {
        loadingTaskRef.current = null;
      }
    };
    // intentionally omit activePage/scale — applied in dedicated effects after load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfViewer.isOpen, pdfViewer.kind, viewerReady, activeSourceUrl]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !viewer.pdfDocument || syncingPageFromViewerRef.current) {
      return;
    }
    // Always apply on focusNonce so re-clicking the same Resources page scrolls back.
    viewer.currentPageNumber = activePage;
    highlightAttemptedRef.current = false;
  }, [activePage, focusNonce, viewerReady, activeSourceUrl]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !viewer.pdfDocument) {
      return;
    }
    if (Math.abs(viewer.currentScale - scale) > 0.001) {
      viewer.currentScale = scale;
    }
  }, [scale, viewerReady, activeSourceUrl]);

  useEffect(() => {
    if (!matchRaw || isLoading || !viewerReady) {
      return;
    }

    const viewer = viewerRef.current;
    const container = containerRef.current;
    if (!viewer || !container) {
      return;
    }

    let cancelled = false;
    let attempts = 0;

    const tryHighlight = () => {
      if (cancelled) {
        return;
      }
      attempts += 1;
      const pageView = viewer.getPageView(activePage - 1) as { div?: HTMLElement } | undefined;
      const pageRoot = pageView?.div;
      if (!pageRoot || !pageRoot.querySelector('.textLayer span')) {
        if (attempts < 40) {
          window.setTimeout(tryHighlight, 150);
        }
        return;
      }

      const highlight = highlightMatchOnPageView(pageRoot, matchRaw);
      highlightAttemptedRef.current = true;
      if (highlight) {
        highlight.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      } else {
        pageRoot.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
      }
    };

    tryHighlight();
    return () => {
      cancelled = true;
    };
  }, [matchRaw, activePage, isLoading, viewerReady, activeSourceUrl]);

  useEffect(() => {
    // Zoom / document changes invalidate absolute overlay positions.
    scriptureLinkedPagesRef.current.clear();
  }, [scale, activeSourceUrl]);

  useEffect(() => {
    if (isLoading || !viewerReady || !currentBible?.books?.length) {
      return;
    }

    const viewer = viewerRef.current;
    if (!viewer || !viewer.pdfDocument) {
      return;
    }

    let cancelled = false;
    const books = currentBible.books;
    const pagesBaseUrl = resolvePagesBaseUrlForPdf(activeSourceUrl);

    const applyLinksToRenderedPages = async () => {
      if (cancelled) {
        return;
      }

      const total = viewer.pagesCount || pageCount || 0;
      for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
        if (cancelled) {
          return;
        }
        if (scriptureLinkedPagesRef.current.has(pageNumber)) {
          continue;
        }

        const pageView = viewer.getPageView(pageNumber - 1) as { div?: HTMLElement } | undefined;
        const pageRoot = pageView?.div;
        const spans = pageRoot
          ? Array.from(pageRoot.querySelectorAll<HTMLElement>('.textLayer span'))
          : [];
        if (!pageRoot || spans.length === 0) {
          continue;
        }

        const pageText = spans.map((span) => span.textContent ?? '').join(' ');
        const references = await loadPageScriptureReferences({
          pageNumber,
          books,
          pagesBaseUrl,
          pageText,
        });

        if (cancelled || !pageRoot.isConnected) {
          return;
        }

        scriptureLinkedPagesRef.current.add(pageNumber);
        if (references.length === 0) {
          clearScriptureLinks(pageRoot);
          continue;
        }

        applyScriptureLinkOverlays(pageRoot, spans, references, (reference) => {
          void openScriptureReferenceRef.current(reference);
        });
      }
    };

    void applyLinksToRenderedPages();
    return () => {
      cancelled = true;
    };
  }, [
    activeSourceUrl,
    currentBible,
    focusNonce,
    isLoading,
    pageCount,
    scale,
    viewerReady,
  ]);

  useEffect(() => {
    if (!pdfViewer.isOpen || pdfViewer.kind === 'markup') {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      const meta = event.ctrlKey || event.metaKey;
      if (meta && (event.key === '=' || event.key === '+')) {
        event.preventDefault();
        adjustScale(1);
        return;
      }
      if (meta && event.key === '-') {
        event.preventDefault();
        adjustScale(-1);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pdfViewer.isOpen, pdfViewer.kind]);

  if (!pdfViewer.isOpen || pdfViewer.kind === 'markup') {
    return null;
  }

  const canGoBack = activePage > 1;
  const canGoForward = pageCount > 0 && activePage < pageCount;

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length < 2) {
      return;
    }
    pinchStartDistanceRef.current = getTouchDistance(event);
    pinchStartScaleRef.current = scale;
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length < 2 || pinchStartDistanceRef.current <= 0) {
      return;
    }
    const currentDistance = getTouchDistance(event);
    if (currentDistance <= 0) {
      return;
    }
    const distanceRatio = currentDistance / pinchStartDistanceRef.current;
    if (!Number.isFinite(distanceRatio) || Math.abs(distanceRatio - 1) < 0.02) {
      return;
    }
    event.preventDefault();
    setScale(clampScale(pinchStartScaleRef.current * distanceRatio));
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length < 2) {
      pinchStartDistanceRef.current = 0;
    }
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!(event.ctrlKey || event.metaKey)) {
      return;
    }
    event.preventDefault();
    adjustScale(event.deltaY < 0 ? 1 : -1);
  };

  return (
    <div className="pdf-viewer-shell d-flex flex-column h-100">
      <div className="pdf-viewer-toolbar d-flex flex-wrap align-items-center gap-2 border-bottom pb-2 mb-3">
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          onClick={() => dispatch(closePdfViewer())}
        >
          <i className="fa-solid fa-arrow-left me-1" aria-hidden="true"></i>
          Back To Verses
        </button>

        <div className="pdf-viewer-title fw-semibold text-truncate" title={title}>{title}</div>

        <div className="ms-auto d-flex align-items-center gap-2">
          <FileSyncExclusionButton syncItem={pdfViewer.syncItem} documentLabel={title} />

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

          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={() => {
              if (!activeSourceUrl) {
                return;
              }
              const anchor = document.createElement('a');
              anchor.href = activeSourceUrl;
              anchor.download = `${sanitizeFileName(title)}.pdf`;
              anchor.rel = 'noopener';
              anchor.target = '_blank';
              anchor.click();
            }}
            disabled={!activeSourceUrl}
            title="Download PDF"
          >
            <i className="fa-solid fa-download" aria-hidden="true"></i>
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

      {error && (
        <div className="alert alert-danger" role="alert">{error}</div>
      )}

      <div
        className="pdf-viewer-stage pdf-viewer-continuous flex-grow-1"
        tabIndex={0}
        aria-label="PDF viewer"
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div ref={containerRef} className="pdf-viewer-container">
          <div className="pdfViewer" />
        </div>

        {isLoading && (
          <div className="pdf-loading-overlay" role="status" aria-live="polite" aria-label="Loading PDF document">
            <div className="spinner-border text-secondary" role="presentation"></div>
            <span>Loading document...</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default PdfViewerPane;
