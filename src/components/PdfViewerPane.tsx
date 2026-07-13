import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/types/src/display/api';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { closePdfViewer, setPdfViewerPage } from '../store/slices/uiSlice';

GlobalWorkerOptions.workerSrc = workerUrl;

const MIN_SCALE = 0.6;
const MAX_SCALE = 2.4;
const SCALE_STEP = 0.2;
const RANGE_CHUNK_SIZE = 1024 * 1024;

const PdfViewerPane: React.FC = () => {
  const dispatch = useAppDispatch();
  const { pdfViewer } = useAppSelector((state) => state.ui);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const loadingTaskRef = useRef<{ destroy: () => void } | null>(null);

  const [documentProxy, setDocumentProxy] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const hasLoggedFetchModeRef = useRef(false);

  const activeSourceUrl = pdfViewer.sourceUrl;
  const activePage = Math.max(1, pdfViewer.page);

  useEffect(() => {
    let cancelled = false;

    const loadDocument = async () => {
      if (!pdfViewer.isOpen || !activeSourceUrl) {
        loadingTaskRef.current?.destroy();
        loadingTaskRef.current = null;
        setDocumentProxy(null);
        setPageCount(0);
        setError(null);
        hasLoggedFetchModeRef.current = false;
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        if (!hasLoggedFetchModeRef.current) {
          console.info('[GitBible][PDF] Fetch mode selected: range (requested)', {
            sourceUrl: activeSourceUrl,
            rangeChunkSize: RANGE_CHUNK_SIZE,
          });
          hasLoggedFetchModeRef.current = true;
        }

        loadingTaskRef.current?.destroy();
        const loadingTask = getDocument({
          url: activeSourceUrl,
          disableAutoFetch: true,
          disableStream: true,
          disableRange: false,
          rangeChunkSize: RANGE_CHUNK_SIZE,
        });
        loadingTaskRef.current = loadingTask;

        const nextDocument = await loadingTask.promise;
        if (cancelled) {
          loadingTaskRef.current = null;
          await nextDocument.destroy();
          return;
        }

        loadingTaskRef.current = null;
        setDocumentProxy(nextDocument);
        setPageCount(nextDocument.numPages);

        if (activePage > nextDocument.numPages) {
          dispatch(setPdfViewerPage(nextDocument.numPages));
        }
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        loadingTaskRef.current = null;
        setDocumentProxy(null);
        setPageCount(0);
        setError(loadError instanceof Error ? loadError.message : 'Unable to load PDF document.');
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadDocument();

    return () => {
      cancelled = true;
      loadingTaskRef.current?.destroy();
      loadingTaskRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfViewer.isOpen, activeSourceUrl, dispatch]);

  useEffect(() => {
    return () => {
      if (documentProxy) {
        void documentProxy.destroy();
      }
    };
  }, [documentProxy]);

  useEffect(() => {
    let cancelled = false;

    const renderPage = async () => {
      if (!documentProxy || !canvasRef.current || !pdfViewer.isOpen) {
        return;
      }

      const pageNumber = Math.min(Math.max(1, activePage), documentProxy.numPages);
      setIsRendering(true);
      setError(null);

      try {
        const page: PDFPageProxy = await documentProxy.getPage(pageNumber);
        if (cancelled || !canvasRef.current) {
          return;
        }

        const viewport = page.getViewport({ scale });
        const outputScale = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        if (!context) {
          throw new Error('PDF canvas rendering context is unavailable.');
        }

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        context.setTransform(outputScale, 0, 0, outputScale, 0, 0);

        renderTaskRef.current?.cancel();
        const task = page.render({ canvasContext: context, viewport });
        renderTaskRef.current = task;
        await task.promise;
      } catch (renderError) {
        if (!cancelled) {
          setError(renderError instanceof Error ? renderError.message : 'Unable to render PDF page.');
        }
      } finally {
        if (!cancelled) {
          setIsRendering(false);
        }
      }
    };

    void renderPage();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
    };
  }, [documentProxy, activePage, scale, pdfViewer.isOpen]);

  const title = useMemo(() => {
    if (pdfViewer.title && pdfViewer.title.trim().length > 0) {
      return pdfViewer.title;
    }

    return 'Document Viewer';
  }, [pdfViewer.title]);

  if (!pdfViewer.isOpen) {
    return null;
  }

  const canGoBack = activePage > 1;
  const canGoForward = pageCount > 0 && activePage < pageCount;

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
          <button
            type="button"
            className="btn btn-sm btn-outline-primary"
            disabled={!canGoBack}
            onClick={() => dispatch(setPdfViewerPage(activePage - 1))}
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
            onClick={() => dispatch(setPdfViewerPage(activePage + 1))}
          >
            Next
          </button>

          <div className="btn-group btn-group-sm" role="group" aria-label="Zoom controls">
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={() => setScale((current) => Math.max(MIN_SCALE, Number((current - SCALE_STEP).toFixed(2))))}
              disabled={scale <= MIN_SCALE}
            >
              <i className="fa-solid fa-magnifying-glass-minus" aria-hidden="true"></i>
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={() => setScale((current) => Math.min(MAX_SCALE, Number((current + SCALE_STEP).toFixed(2))))}
              disabled={scale >= MAX_SCALE}
            >
              <i className="fa-solid fa-magnifying-glass-plus" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      </div>

      {isLoading && <p className="text-body-secondary small mb-2">Loading document...</p>}
      {isLoading && <p className="text-body-secondary small mb-2">Range mode requested.</p>}
      {error && <p className="text-danger small mb-2">{error}</p>}

      <div className="pdf-viewer-stage flex-grow-1">
        <div className="pdf-viewer-canvas-wrap">
          <canvas ref={canvasRef} className="pdf-viewer-canvas" />
        </div>

        {isRendering && (
          <div className="pdf-viewer-rendering-badge small text-body-secondary">Rendering page...</div>
        )}
      </div>
    </div>
  );
};

export default PdfViewerPane;
