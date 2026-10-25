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
import { setPdfViewerPage } from '../store/slices/uiSlice';
import { useOpenDocumentScriptureReference } from '../hooks/useDocumentScriptureNavigation';
import { useBackToVerses } from '../hooks/useDocumentPopout';
import { useViewerZoomInputs } from '../hooks/useViewerZoomInputs';
import { loadPageScriptureReferences } from '../utils/loadPageScriptureReferences';
import { applyScriptureLinkOverlays, clearScriptureLinks } from '../utils/scriptureLinkOverlays';
import {
  buildTextLayerHaystack,
  findAllMatchRanges,
  getMatchClientRects,
  placeOverlayOnPage,
  type MatchTextFolding,
} from '../utils/documentTextMatch';
import { findTopVisiblePageIndexInContainer } from '../utils/viewerTopPage';
import { clampScale, stepScale } from '../utils/viewerZoom';
import FileSyncExclusionButton from './FileSyncExclusionButton';
import DocumentPopoutButton from './DocumentPopoutButton';
import ViewerZoomControls from './ViewerZoomControls';

GlobalWorkerOptions.workerSrc = workerUrl;

const RANGE_CHUNK_SIZE = 1024 * 1024;
const OCR_SPACE_PATTERN = /[\s\u00A0\u1680\u180E\u2000-\u200D\u2028\u2029\u202F\u205F\u2060\u3000\uFEFF\u0000-\u001F]+/g;

const OCR_SPACE_CHAR = new RegExp(`^${OCR_SPACE_PATTERN.source}$`);
const OCR_MATCH_FOLDING: MatchTextFolding = {
  foldChar: (ch) => ch.toLowerCase(),
  isSpace: (ch) => OCR_SPACE_CHAR.test(ch),
};

const normalizeMatchText = (value: string | null | undefined): string => {
  if (!value) {
    return '';
  }
  return value.replace(OCR_SPACE_PATTERN, ' ').trim();
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

/** Highlights every occurrence of every raw on the page; returns the first overlay in page order. */
function highlightMatchesOnPageView(pageViewRoot: HTMLElement, rawMatchTexts: readonly string[]): HTMLElement | null {
  const normalizedNeedles = rawMatchTexts.map((raw) => normalizeMatchText(raw).toLowerCase()).filter(Boolean);
  if (normalizedNeedles.length === 0) {
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

  const { haystack, ranges } = buildTextLayerHaystack(spans, (value) => normalizeMatchText(value).toLowerCase());

  let firstHighlight: HTMLElement | null = null;

  for (const { start: matchStart, end: matchEnd } of findAllMatchRanges(haystack, normalizedNeedles)) {
    for (const range of ranges) {
      if (range.end <= matchStart || range.start >= matchEnd) {
        continue;
      }

      for (const rect of getMatchClientRects(range, matchStart, matchEnd, OCR_MATCH_FOLDING)) {
        const highlight = pageViewRoot.ownerDocument.createElement('div');
        highlight.className = 'pdf-raw-highlight';
        if (!placeOverlayOnPage(highlight, pageViewRoot, rect)) {
          continue;
        }
        if (!firstHighlight) {
          firstHighlight = highlight;
        }
      }
    }
  }

  return firstHighlight;
}

interface PdfViewerPaneProps {
  /** Runs when a scripture link in the document is followed (e.g. to expand the mobile panel). */
  onScriptureReferenceOpen?: () => void;
}

const PdfViewerPane: React.FC<PdfViewerPaneProps> = ({ onScriptureReferenceOpen }) => {
  const dispatch = useAppDispatch();
  const backToVerses = useBackToVerses();
  const { pdfViewer } = useAppSelector((state) => state.ui);
  const currentBible = useAppSelector((state) => state.bible.currentBible);
  const openScriptureReference = useOpenDocumentScriptureReference(onScriptureReferenceOpen);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pagesRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<PDFViewer | null>(null);
  const eventBusRef = useRef<EventBus | null>(null);
  const linkServiceRef = useRef<PDFLinkService | null>(null);
  const loadingTaskRef = useRef<{ destroy: () => void } | null>(null);
  const documentProxyRef = useRef<PDFDocumentProxy | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const highlightAttemptedRef = useRef(false);
  const highlightPageRef = useRef(0);
  const syncingPageFromViewerRef = useRef(false);
  const allowViewportPageSyncRef = useRef(false);
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
  const [fitWidth, setFitWidth] = useState(true);
  const fitWidthRef = useRef(fitWidth);
  fitWidthRef.current = fitWidth;
  const [viewerReady, setViewerReady] = useState(false);
  const [highlightEpoch, setHighlightEpoch] = useState(0);

  const activeSourceUrl = pdfViewer.sourceUrl;
  const activePage = Math.max(1, pdfViewer.page);
  const activePageRef = useRef(activePage);
  activePageRef.current = activePage;
  const matchRaws = useMemo(
    () => pdfViewer.matchRaws.map(normalizeMatchText).filter(Boolean),
    [pdfViewer.matchRaws]
  );
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

  // Create viewer once container mounts.
  useEffect(() => {
    if (!pdfViewer.isOpen || pdfViewer.kind === 'markup') {
      return;
    }

    const container = containerRef.current;
    const pages = pagesRef.current;
    if (!container || !pages) {
      return;
    }

    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });
    const pdfViewerInstance = new PDFViewer({
      container,
      viewer: pages,
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

    const onPageChanging = () => {
      // Scroll may bring already-cached pages into view without a fresh textlayerrendered.
      void scanRenderedPagesForLinks();
    };
    eventBus.on('pagechanging', onPageChanging);

    // pagechanging uses the most-visible page. The toolbar follows the page at the
    // top of the viewport, ignoring that page's trailing band so a leftover strip
    // does not keep the previous page number (and fit-to-width).
    const onUpdateViewArea = () => {
      if (!allowViewportPageSyncRef.current) {
        return;
      }
      const frames: Array<{ offsetTop: number; clientTop: number; clientHeight: number }> = [];
      for (let index = 0; index < pdfViewerInstance.pagesCount; index += 1) {
        const pageRoot = (pdfViewerInstance.getPageView(index) as { div?: HTMLElement } | undefined)?.div;
        if (!pageRoot) {
          return;
        }
        frames.push(pageRoot);
      }
      if (frames.length === 0) {
        return;
      }
      const pageNumber = findTopVisiblePageIndexInContainer(container, frames) + 1;
      if (pageNumber === activePageRef.current) {
        return;
      }
      syncingPageFromViewerRef.current = true;
      dispatch(setPdfViewerPage(pageNumber));
    };
    eventBus.on('updateviewarea', onUpdateViewArea);

    // Keeps the toolbar percentage in sync when pdf.js resolves page-width.
    const onScaleChanging = (evt: { scale?: number }) => {
      if (typeof evt.scale === 'number' && Number.isFinite(evt.scale)) {
        setScale(evt.scale);
      }
    };
    eventBus.on('scalechanging', onScaleChanging);

    // page-width and page navigation need page views, which exist only once pages init.
    const onPagesInit = () => {
      if (fitWidthRef.current) {
        pdfViewerInstance.currentScaleValue = 'page-width';
      }
      pdfViewerInstance.currentPageNumber = activePageRef.current;
      allowViewportPageSyncRef.current = true;
    };
    eventBus.on('pagesinit', onPagesInit);

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
        if (fitWidthRef.current && pdfViewerInstance.pdfDocument) {
          pdfViewerInstance.currentScaleValue = 'page-width';
        }
      });
    resizeObserver?.observe(container);

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
      // pdf.js reset() strips foreign page children, taking the find highlight with it.
      if (evt.pageNumber === highlightPageRef.current) {
        setHighlightEpoch((value) => value + 1);
      }
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
      resizeObserver?.disconnect();
      eventBus.off('scalechanging', onScaleChanging);
      eventBus.off('pagesinit', onPagesInit);
      eventBus.off('pagechanging', onPageChanging);
      eventBus.off('updateviewarea', onUpdateViewArea);
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
      allowViewportPageSyncRef.current = false;
      pages.replaceChildren();
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
    allowViewportPageSyncRef.current = false;
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
        if (!fitWidthRef.current) {
          viewer.currentScale = scale;
        }
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
    if (!viewer || !viewer.pdfDocument) {
      return;
    }
    if (syncingPageFromViewerRef.current) {
      // Scroll-driven page updates must not reset the view to the top of that page.
      syncingPageFromViewerRef.current = false;
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
    if (fitWidth) {
      if (viewer.currentScaleValue !== 'page-width') {
        viewer.currentScaleValue = 'page-width';
      }
      return;
    }
    if (Math.abs(viewer.currentScale - scale) > 0.001) {
      viewer.currentScale = scale;
    }
  }, [scale, fitWidth, viewerReady, activeSourceUrl]);

  useEffect(() => {
    if (matchRaws.length === 0 || isLoading || !viewerReady) {
      return;
    }

    const viewer = viewerRef.current;
    const container = containerRef.current;
    if (!viewer || !container) {
      return;
    }

    // Only the first attempt for a navigation targets/scrolls; later runs redraw after pdf.js re-renders.
    const isInitialAttempt = !highlightAttemptedRef.current;
    if (isInitialAttempt) {
      highlightPageRef.current = activePage;
    }
    const targetPage = highlightPageRef.current;

    let cancelled = false;
    let attempts = 0;

    const tryHighlight = () => {
      if (cancelled) {
        return;
      }
      attempts += 1;
      const pageView = viewer.getPageView(targetPage - 1) as { div?: HTMLElement } | undefined;
      const pageRoot = pageView?.div;
      if (!pageRoot || !pageRoot.querySelector('.textLayer span')) {
        if (attempts < 40) {
          window.setTimeout(tryHighlight, 150);
        }
        return;
      }

      const highlight = highlightMatchesOnPageView(pageRoot, matchRaws);
      highlightAttemptedRef.current = true;
      if (!isInitialAttempt) {
        return;
      }
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
  }, [matchRaws, activePage, focusNonce, highlightEpoch, isLoading, viewerReady, activeSourceUrl]);

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

  useViewerZoomInputs({
    enabled: pdfViewer.isOpen && pdfViewer.kind !== 'markup',
    stageRef,
    scale,
    onZoomStep: adjustScale,
    onZoomReset: () => setFitWidth(true),
    onZoomTo: zoomTo,
  });

  if (!pdfViewer.isOpen || pdfViewer.kind === 'markup') {
    return null;
  }

  return (
    <div className="pdf-viewer-shell d-flex flex-column h-100">
      <div className="pdf-viewer-toolbar d-flex flex-wrap align-items-center gap-2 border-bottom pb-2 mb-3">
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          onClick={backToVerses}
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

          <ViewerZoomControls
            scale={scale}
            fitWidth={fitWidth}
            onZoomStep={adjustScale}
            onFitWidth={() => setFitWidth(true)}
          />

          <DocumentPopoutButton />
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">{error}</div>
      )}

      <div
        ref={stageRef}
        className="pdf-viewer-stage pdf-viewer-continuous flex-grow-1"
        tabIndex={0}
        aria-label="PDF viewer"
      >
        <div ref={containerRef} className="pdf-viewer-container">
          <div ref={pagesRef} className="pdfViewer" />
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
