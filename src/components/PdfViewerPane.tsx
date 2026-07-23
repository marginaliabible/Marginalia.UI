import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, TextLayer, Util } from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/types/src/display/api';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { closePdfViewer, setPdfViewerPage } from '../store/slices/uiSlice';

GlobalWorkerOptions.workerSrc = workerUrl;

const MIN_SCALE = 0.6;
const MAX_SCALE = 2.4;
const SCALE_STEP = 0.2;
const RANGE_CHUNK_SIZE = 1024 * 1024;
const POPUP_ANNOTATION_TYPE = 16;
const WHEEL_PAGE_TURN_COOLDOWN_MS = 280;
const CANVAS_RENDER_TIMEOUT_MS = 8000;
const TEXT_LAYER_RENDER_TIMEOUT_MS = 3500;
const OCR_SPACE_PATTERN = /[\s\u00A0\u1680\u180E\u2000-\u200D\u2028\u2029\u202F\u205F\u2060\u3000\uFEFF\u0000-\u001F]+/g;

interface RenderedAnnotation {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  contents: string;
  title: string;
}

interface HighlightBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface TextContentItemLike {
  str?: unknown;
  transform?: unknown;
  width?: unknown;
}

interface AnnotationDataLike {
  id?: unknown;
  rect?: unknown;
  title?: unknown;
  titleObj?: { str?: unknown } | null;
  contents?: unknown;
  contentsObj?: { str?: unknown } | null;
  richText?: { str?: unknown } | null;
  popupRef?: unknown;
  annotationType?: unknown;
}

const isAbortOrCancelled = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === 'AbortException' || error.name === 'RenderingCancelledException';
};

const clampScale = (value: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(value.toFixed(2))));

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, timeoutLabel: string): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(timeoutLabel));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
};

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

const readAnnotationString = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

const extractAnnotationText = (annotation: AnnotationDataLike | null | undefined): { title: string; contents: string } => {
  if (!annotation) {
    return { title: '', contents: '' };
  }

  const title = readAnnotationString(annotation.titleObj?.str) || readAnnotationString(annotation.title);
  const contents = readAnnotationString(annotation.contentsObj?.str)
    || readAnnotationString(annotation.richText?.str)
    || readAnnotationString(annotation.contents);

  return { title, contents };
};

const PdfViewerPane: React.FC = () => {
  const dispatch = useAppDispatch();
  const { pdfViewer } = useAppSelector((state) => state.ui);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const highlightLayerRef = useRef<HTMLDivElement | null>(null);
  const loadingTaskRef = useRef<{ destroy: () => void } | null>(null);
  const renderTasksRef = useRef(new Map<string, { cancel: () => void }>());
  const pinchStartDistanceRef = useRef(0);
  const pinchStartScaleRef = useRef(1);
  const lastWheelPageTurnAtRef = useRef(0);
  const fitScaleRef = useRef(1);
  const previousNavigationRef = useRef<{ sourceUrl: string | null; page: number }>({
    sourceUrl: null,
    page: 1,
  });

  const [documentProxy, setDocumentProxy] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [annotations, setAnnotations] = useState<RenderedAnnotation[]>([]);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [useNativePopupFallback, setUseNativePopupFallback] = useState(false);
  const renderCycleRef = useRef(0);

  const activeSourceUrl = pdfViewer.sourceUrl;
  const activePage = Math.max(1, pdfViewer.page);
  const matchRaw = normalizeMatchText(pdfViewer.matchRaw);

  const adjustScale = (direction: 1 | -1) => {
    setScale((current) => clampScale(current + (direction * SCALE_STEP)));
  };

  const getViewerWindow = (): Window => {
    return stageRef.current?.ownerDocument.defaultView ?? window;
  };

  const getViewerDocument = (): Document => {
    return stageRef.current?.ownerDocument ?? document;
  };

  useEffect(() => {
    setUseNativePopupFallback(false);
  }, [activeSourceUrl]);

  const computeFitScaleForPageFrame = (pageWidth: number, pageHeight: number): number => {
    const stage = stageRef.current;
    if (!stage) {
      return 1;
    }

    const computed = getViewerWindow().getComputedStyle(stage);
    const horizontalPadding = Number.parseFloat(computed.paddingLeft || '0') + Number.parseFloat(computed.paddingRight || '0');
    const verticalPadding = Number.parseFloat(computed.paddingTop || '0') + Number.parseFloat(computed.paddingBottom || '0');
    const availableWidth = Math.max(1, stage.clientWidth - horizontalPadding);
    const availableHeight = Math.max(1, stage.clientHeight - verticalPadding);
    const widthScale = availableWidth / Math.max(1, pageWidth);
    const heightScale = availableHeight / Math.max(1, pageHeight);
    return clampScale(Math.min(widthScale, heightScale));
  };

  const isClippedByWidth = (): boolean => {
    const stage = stageRef.current;
    if (!stage) {
      return false;
    }

    return stage.scrollWidth > stage.clientWidth + 1;
  };

  const resetZoomIfClipped = (): void => {
    const fitScale = fitScaleRef.current;
    if (scale <= fitScale) {
      return;
    }

    if (!isClippedByWidth()) {
      return;
    }

    setScale(fitScale);
  };

  const resetZoomToFitFrame = async (): Promise<void> => {
    if (!documentProxy) {
      setScale(fitScaleRef.current);
      return;
    }

    try {
      const pageNumber = Math.min(Math.max(1, activePage), documentProxy.numPages);
      const page = await documentProxy.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const fitScale = computeFitScaleForPageFrame(baseViewport.width, baseViewport.height);
      fitScaleRef.current = fitScale;
      setScale(fitScale);
    } catch {
      setScale(fitScaleRef.current);
    }
  };

  const isScrolledToTop = (): boolean => {
    const stage = stageRef.current;
    if (!stage) {
      return true;
    }

    return stage.scrollTop <= 1;
  };

  const isScrolledToBottom = (): boolean => {
    const stage = stageRef.current;
    if (!stage) {
      return true;
    }

    return stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 1;
  };

  const closeOpenAnnotation = () => {
    setActiveAnnotationId(null);
  };

  const goToPage = (pageNumber: number) => {
    const next = Math.max(1, Math.min(pageCount || 1, pageNumber));
    if (next !== activePage) {
      resetZoomIfClipped();
    }
    closeOpenAnnotation();
    dispatch(setPdfViewerPage(next));
  };

  const renderHighlights = (
    highlightLayer: HTMLDivElement,
    textContent: unknown,
    viewport: ReturnType<PDFPageProxy['getViewport']>,
    rawMatchText: string
  ): boolean => {
    highlightLayer.innerHTML = '';

    if (!rawMatchText) {
      return false;
    }

    const itemsRaw = (textContent as { items?: unknown[] } | undefined)?.items;
    const items = Array.isArray(itemsRaw) ? itemsRaw as TextContentItemLike[] : [];
    const normalizedSegments: Array<{ start: number; end: number; item: TextContentItemLike }> = [];

    let normalizedPageText = '';
    let cursor = 0;

    for (const item of items) {
      const rawStr = typeof item.str === 'string' ? item.str : '';
      const normalized = rawStr.replace(OCR_SPACE_PATTERN, ' ').trim();
      if (!normalized) {
        continue;
      }

      if (normalizedPageText.length > 0) {
        normalizedPageText += ' ';
        cursor += 1;
      }

      const start = cursor;
      normalizedPageText += normalized;
      cursor += normalized.length;
      normalizedSegments.push({ start, end: cursor, item });
    }

    const matchStart = normalizedPageText.indexOf(rawMatchText);
    if (matchStart < 0) {
      return false;
    }

    const matchEnd = matchStart + rawMatchText.length;
    const boxes: HighlightBox[] = [];

    for (const segment of normalizedSegments) {
      if (segment.end <= matchStart || segment.start >= matchEnd) {
        continue;
      }

      const transform = Array.isArray(segment.item.transform) ? segment.item.transform as number[] : null;
      const widthRaw = typeof segment.item.width === 'number' ? segment.item.width : 0;
      if (!transform || transform.length < 6 || widthRaw <= 0) {
        continue;
      }

      const mapped = Util.transform(viewport.transform, transform);
      const height = Math.max(1, Math.hypot(mapped[2], mapped[3]));
      const width = Math.max(1, widthRaw * viewport.scale);
      boxes.push({
        left: mapped[4],
        top: mapped[5] - height,
        width,
        height,
      });
    }

    for (const box of boxes) {
      const marker = document.createElement('div');
      marker.className = 'pdf-raw-highlight';
      marker.style.left = `${box.left}px`;
      marker.style.top = `${box.top}px`;
      marker.style.width = `${box.width}px`;
      marker.style.height = `${box.height}px`;
      highlightLayer.appendChild(marker);
    }

    return boxes.length > 0;
  };

  const buildAnnotations = (
    viewport: ReturnType<PDFPageProxy['getViewport']>,
    rawAnnotations: unknown[]
  ): RenderedAnnotation[] => {
    const annotationsData = rawAnnotations as AnnotationDataLike[];
    const popupAnnotations = new Map<string, AnnotationDataLike>();

    for (const annotation of annotationsData) {
      if (Number(annotation.annotationType) === POPUP_ANNOTATION_TYPE && annotation.id != null) {
        popupAnnotations.set(String(annotation.id), annotation);
      }
    }

    const output: RenderedAnnotation[] = [];
    const seen = new Set<string>();

    for (const annotation of annotationsData) {
      if (Number(annotation.annotationType) === POPUP_ANNOTATION_TYPE) {
        continue;
      }

      const rect = Array.isArray(annotation.rect) ? annotation.rect as number[] : null;
      if (!rect || rect.length < 4) {
        continue;
      }

      const popupRef = annotation.popupRef != null ? String(annotation.popupRef) : '';
      const popupAnnotation = popupRef ? popupAnnotations.get(popupRef) ?? null : null;
      const popupText = extractAnnotationText(popupAnnotation);
      const ownText = extractAnnotationText(annotation);
      const title = popupText.title || ownText.title;
      const contents = popupText.contents || ownText.contents;

      if (!title && !contents && !popupRef) {
        continue;
      }

      const viewportRect = viewport.convertToViewportRectangle(rect);
      const left = Math.min(viewportRect[0], viewportRect[2]);
      const top = Math.min(viewportRect[1], viewportRect[3]);
      const width = Math.max(14, Math.abs(viewportRect[0] - viewportRect[2]));
      const height = Math.max(14, Math.abs(viewportRect[1] - viewportRect[3]));
      const id = String(annotation.id ?? `${left}:${top}:${width}:${height}`);

      if (seen.has(id)) {
        continue;
      }

      seen.add(id);
      output.push({ id, left, top, width, height, title, contents });
    }

    return output;
  };

  useEffect(() => {
    if (!pdfViewer.isOpen) {
      previousNavigationRef.current = { sourceUrl: activeSourceUrl, page: activePage };
      return;
    }

    const previous = previousNavigationRef.current;
    const hasNavigated = previous.sourceUrl !== activeSourceUrl || previous.page !== activePage;
    if (hasNavigated) {
      resetZoomIfClipped();
    }

    previousNavigationRef.current = { sourceUrl: activeSourceUrl, page: activePage };
  }, [pdfViewer.isOpen, activeSourceUrl, activePage, scale]);

  useEffect(() => {
    let cancelled = false;

    const loadDocument = async () => {
      if (!pdfViewer.isOpen || !activeSourceUrl) {
        loadingTaskRef.current?.destroy();
        loadingTaskRef.current = null;
        setDocumentProxy(null);
        setPageCount(0);
        setAnnotations([]);
        closeOpenAnnotation();
        setError(null);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        loadingTaskRef.current?.destroy();
        const ownerDocument = getViewerDocument();
        const loadingTask = getDocument({
          url: activeSourceUrl,
          disableAutoFetch: true,
          disableStream: true,
          disableRange: false,
          rangeChunkSize: RANGE_CHUNK_SIZE,
          ownerDocument,
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
        setAnnotations([]);
        closeOpenAnnotation();

        const pageForFit = Math.min(Math.max(1, activePage), nextDocument.numPages);
        const fitPage = await nextDocument.getPage(pageForFit);
        const baseViewport = fitPage.getViewport({ scale: 1 });
        const fitScale = computeFitScaleForPageFrame(baseViewport.width, baseViewport.height);
        fitScaleRef.current = fitScale;
        setScale(fitScale);

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

    const renderCurrentPage = async () => {
      if (!documentProxy || !pdfViewer.isOpen || !canvasRef.current || !textLayerRef.current || !highlightLayerRef.current) {
        return;
      }

      const renderCycle = renderCycleRef.current + 1;
      renderCycleRef.current = renderCycle;
      setIsRendering(true);
      setError(null);
      closeOpenAnnotation();
      setAnnotations([]);

      if (textLayerRef.current) {
        textLayerRef.current.innerHTML = '';
      }

      if (highlightLayerRef.current) {
        highlightLayerRef.current.innerHTML = '';
      }

      const selection = getViewerDocument().getSelection();
      if (selection && stageRef.current && stageRef.current.contains(selection.anchorNode)) {
        selection.removeAllRanges();
      }

      try {
        const pageNumber = Math.min(Math.max(1, activePage), documentProxy.numPages);
        const page = await documentProxy.getPage(pageNumber);
        if (cancelled || !canvasRef.current || !textLayerRef.current || !highlightLayerRef.current) {
          return;
        }

        const baseViewport = page.getViewport({ scale: 1 });
        fitScaleRef.current = computeFitScaleForPageFrame(baseViewport.width, baseViewport.height);

        const viewport = page.getViewport({ scale });
        const viewerWindow = getViewerWindow();
        const outputScale = viewerWindow.devicePixelRatio || 1;
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

        const canvasTaskKey = 'canvas';
        renderTasksRef.current.get(canvasTaskKey)?.cancel();
        const canvasTask = page.render({ canvasContext: context, viewport });
        renderTasksRef.current.set(canvasTaskKey, canvasTask);
        await withTimeout(
          canvasTask.promise,
          CANVAS_RENDER_TIMEOUT_MS,
          'Canvas render timed out.'
        );

        const textLayer = textLayerRef.current;
        const highlightLayer = highlightLayerRef.current;
        const textContent = await page.getTextContent();

        textLayer.innerHTML = '';
        textLayer.style.width = `${Math.floor(viewport.width)}px`;
        textLayer.style.height = `${Math.floor(viewport.height)}px`;
        textLayer.style.color = 'transparent';
        textLayer.style.lineHeight = '1';
        textLayer.style.setProperty('-webkit-text-fill-color', 'transparent');
        textLayer.style.position = 'absolute';
        textLayer.style.inset = '0';

        const textTaskKey = 'text';
        renderTasksRef.current.get(textTaskKey)?.cancel();
        const textTask = new TextLayer({
          textContentSource: textContent,
          container: textLayer,
          viewport,
        });
        renderTasksRef.current.set(textTaskKey, textTask);
        try {
          await withTimeout(
            textTask.render(),
            TEXT_LAYER_RENDER_TIMEOUT_MS,
            'Text layer render timed out.'
          );
        } catch (textLayerError) {
          textTask.cancel();
          if (!cancelled && isAbortOrCancelled(textLayerError)) {
            return;
          }
          textLayer.innerHTML = '';
        }

        highlightLayer.style.width = `${Math.floor(viewport.width)}px`;
        highlightLayer.style.height = `${Math.floor(viewport.height)}px`;
        renderHighlights(highlightLayer, textContent, viewport, matchRaw);

        const nextAnnotations = buildAnnotations(viewport, await page.getAnnotations({ intent: 'display' }) as unknown[]);
        if (!cancelled) {
          setAnnotations(nextAnnotations);
        }
      } catch (renderError) {
        if (!cancelled && !isAbortOrCancelled(renderError)) {
          const timedOut = renderError instanceof Error && renderError.message === 'Canvas render timed out.';
          if (timedOut && getViewerWindow() !== window) {
            setUseNativePopupFallback(true);
            setError(null);
            return;
          }

          setError(renderError instanceof Error ? renderError.message : 'Unable to render PDF page.');
        }
      } finally {
        if (!cancelled && renderCycleRef.current === renderCycle) {
          setIsRendering(false);
        }
      }
    };

    void renderCurrentPage();

    return () => {
      cancelled = true;
      for (const task of renderTasksRef.current.values()) {
        task.cancel();
      }
      renderTasksRef.current.clear();
    };
  }, [documentProxy, activePage, scale, pdfViewer.isOpen, matchRaw]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !pdfViewer.isOpen) {
      return;
    }

    stage.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [activeSourceUrl, activePage, scale, pdfViewer.isOpen]);

  useEffect(() => {
    if (!pdfViewer.isOpen) {
      return;
    }

    const viewerWindow = getViewerWindow();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      const isZoomIn = event.key === '=' || event.key === '+' || event.code === 'NumpadAdd';
      const isZoomOut = event.key === '-' || event.key === '_' || event.code === 'NumpadSubtract';

      if (isZoomIn) {
        event.preventDefault();
        adjustScale(1);
        return;
      }

      if (isZoomOut) {
        event.preventDefault();
        adjustScale(-1);
      }
    };

    viewerWindow.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      viewerWindow.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [pdfViewer.isOpen]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !pdfViewer.isOpen) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey) {
        event.preventDefault();
        if (event.deltaY < 0) {
          adjustScale(1);
        } else if (event.deltaY > 0) {
          adjustScale(-1);
        }
        return;
      }

      const hasOverflowScrollbars = stage.scrollWidth > stage.clientWidth + 1 || stage.scrollHeight > stage.clientHeight + 1;
      if (hasOverflowScrollbars) {
        return;
      }

      const now = Date.now();
      const atTop = stage.scrollTop <= 1;
      const atBottom = stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 1;
      const largeEnoughDelta = Math.abs(event.deltaY) >= 20;

      if (!largeEnoughDelta || now - lastWheelPageTurnAtRef.current < WHEEL_PAGE_TURN_COOLDOWN_MS) {
        return;
      }

      if (event.deltaY < 0 && atTop && activePage > 1) {
        event.preventDefault();
        lastWheelPageTurnAtRef.current = now;
        goToPage(activePage - 1);
        return;
      }

      if (event.deltaY > 0 && atBottom && activePage < pageCount) {
        event.preventDefault();
        lastWheelPageTurnAtRef.current = now;
        goToPage(activePage + 1);
      }
    };

    stage.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      stage.removeEventListener('wheel', handleWheel);
    };
  }, [activePage, pageCount, pdfViewer.isOpen]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !pdfViewer.isOpen) {
      return;
    }

    const handleArrowPaging = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }

      if (event.key === 'ArrowDown') {
        if (!isScrolledToBottom() || activePage >= pageCount) {
          return;
        }

        event.preventDefault();
        goToPage(activePage + 1);
        return;
      }

      if (event.key === 'ArrowUp') {
        if (!isScrolledToTop() || activePage <= 1) {
          return;
        }

        event.preventDefault();
        goToPage(activePage - 1);
      }
    };

    stage.addEventListener('keydown', handleArrowPaging);
    return () => {
      stage.removeEventListener('keydown', handleArrowPaging);
    };
  }, [activePage, pageCount, pdfViewer.isOpen]);

  useEffect(() => {
    if (!activeAnnotationId) {
      return;
    }

    const viewerWindow = getViewerWindow();

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) {
        closeOpenAnnotation();
        return;
      }

      if (target.closest('.pdf-annotation-popup') || target.closest('.pdf-annotation-marker')) {
        return;
      }

      closeOpenAnnotation();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeOpenAnnotation();
      }
    };

    viewerWindow.addEventListener('pointerdown', handlePointerDown, true);
    viewerWindow.addEventListener('keydown', handleEscape, true);

    return () => {
      viewerWindow.removeEventListener('pointerdown', handlePointerDown, true);
      viewerWindow.removeEventListener('keydown', handleEscape, true);
    };
  }, [activeAnnotationId]);

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
              onClick={() => {
                void resetZoomToFitFrame();
              }}
              title="fit to frame"
              aria-label="fit to frame"
            >
              <i className="fa-solid fa-up-right-and-down-left-from-center" aria-hidden="true"></i>
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

          <span className="small text-body-secondary">{Math.round(scale * 100)}%</span>
        </div>
      </div>

      {error && <p className="text-danger small mb-2">{error}</p>}

      {useNativePopupFallback && activeSourceUrl ? (
        <div className="d-flex flex-column flex-grow-1 min-h-0">
          <div className="small text-body-secondary mb-2">
            The PDF had trouble rendering. Falling back to browser's PDF viewer.
          </div>
          <iframe
            key={`${activeSourceUrl}:${activePage}`}
            title={title}
            src={`${activeSourceUrl}#page=${activePage}`}
            className="w-100 flex-grow-1 border rounded"
          />
        </div>
      ) : (
      <div
        className={`pdf-viewer-stage flex-grow-1${isRendering ? ' is-rendering' : ''}`}
        ref={stageRef}
        tabIndex={0}
        aria-label="PDF viewer"
        onPointerDown={() => stageRef.current?.focus({ preventScroll: true })}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="pdf-page-shell">
          <div className="pdf-page-inner">
            <canvas ref={canvasRef} className="pdf-viewer-canvas" />
            <div ref={textLayerRef} className="pdf-page-text-layer"></div>
            <div ref={highlightLayerRef} className="pdf-page-highlight-layer"></div>

            <div className="pdf-page-annotation-layer">
              {annotations.map((annotation) => {
                const isOpen = activeAnnotationId === annotation.id;

                return (
                  <React.Fragment key={annotation.id}>
                    <button
                      type="button"
                      className="pdf-annotation-marker"
                      style={{
                        left: `${annotation.left}px`,
                        top: `${annotation.top}px`,
                        width: `${annotation.width}px`,
                        height: `${annotation.height}px`,
                      }}
                      aria-label={annotation.title || annotation.contents || 'Open annotation'}
                      title={annotation.title || ''}
                      onClick={() => {
                        if (isOpen) {
                          closeOpenAnnotation();
                          return;
                        }

                        setActiveAnnotationId(annotation.id);
                      }}
                    ></button>

                    {isOpen && (
                      <div
                        className="pdf-annotation-popup"
                        style={{
                          left: `${annotation.left + annotation.width + 8}px`,
                          top: `${annotation.top}px`,
                        }}
                      >
                        {annotation.title && <div className="pdf-annotation-popup-title">{annotation.title}</div>}
                        {annotation.contents && <div className="pdf-annotation-popup-body">{annotation.contents}</div>}
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-secondary mt-2"
                          onClick={closeOpenAnnotation}
                        >
                          Close
                        </button>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </div>

        {isLoading && (
          <div className="pdf-loading-overlay" role="status" aria-live="polite" aria-label="Loading PDF document">
            <div className="spinner-border text-secondary" role="presentation"></div>
            <span>Loading document...</span>
          </div>
        )}

        {isRendering && (
          <div className="pdf-viewer-rendering-badge small text-body-secondary">Rendering page...</div>
        )}
      </div>
      )}
    </div>
  );
};

export default PdfViewerPane;
