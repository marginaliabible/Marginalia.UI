import React, { useEffect, useMemo, useState } from 'react';
import type { PanelTab, VerseContext } from '../models/tab';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setResourceHiddenTags, setResourceVerseMatchMode } from '../store/slices/uiSlice';
import { bibleService, type VerseResourcesPayload } from '../services/bibleService';
import { assignHashWithoutScroll, buildDocumentLinkRoute, REOPEN_DOCUMENT_LINK_EVENT } from '../App';
import { TAG_COLOR_PALETTE } from '../utils/resourceTagColors';
import { useResourceTagColors } from '../hooks/useResourceTagColors';
import { versesFromContext } from '../utils/selectedVerseContext';
import { mergePageLinks, mergeVerseResourcePayloads, type ResourceVerseMatchMode } from '../utils/verseResources';
import { markupFlagsFromBible } from '../utils/verseMarkup';
import { useRevealVerseSelectionInBible } from '../hooks/useDocumentScriptureNavigation';
import { useSourcePreferences } from '../hooks/useSourcePreferences';
import { VerseReferenceLabel, VerseTextList } from './VersePreview';

interface ResourcesPanelProps {
  tab: PanelTab;
  isActive: boolean;
  /** Runs when a page link or verse reveal is followed in this window (e.g. to collapse the mobile panel). */
  onBeforeNavigate?: () => void;
}

const ResourcesPanel: React.FC<ResourcesPanelProps> = ({ tab, isActive, onBeforeNavigate }) => {
  const verseContext = tab.verseContext as VerseContext | undefined;
  const selectedVerseNumbers = useMemo(
    () => (verseContext ? versesFromContext(verseContext) : []),
    [verseContext]
  );
  const dispatch = useAppDispatch();
  const {
    sourceUrls,
    resourceHiddenTags,
    resourceVerseMatchMode,
    pdfViewer,
    translatorItalics,
    translatorParagraphMarks,
  } = useAppSelector((state) => state.ui);
  const { currentBible } = useAppSelector((state) => state.bible);
  const revealInBible = useRevealVerseSelectionInBible();
  const sourcePreferences = useSourcePreferences();
  const verseMarkupSettings = useMemo(() => ({
    italics: translatorItalics,
    paragraphMarks: translatorParagraphMarks,
  }), [translatorItalics, translatorParagraphMarks]);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [versePayloads, setVersePayloads] = useState<VerseResourcesPayload[]>([]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__MARGINALIA_RESOURCE_TAG_SWATCHES__ = TAG_COLOR_PALETTE;
    }
  }, []);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    let cancelled = false;

    const run = async () => {
      if (!verseContext) {
        if (!cancelled) {
          setVersePayloads([]);
          setError(null);
        }
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const nextPayloads = await Promise.all(
          versesFromContext(verseContext).map((verse) => (
            bibleService.getResourcesForVerse(
              verseContext.book,
              verseContext.chapter,
              verse,
              sourceUrls,
              sourcePreferences
            )
          ))
        );

        if (cancelled) {
          return;
        }

        setVersePayloads(nextPayloads);
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        setVersePayloads([]);
        setError(loadError instanceof Error ? loadError.message : 'Failed to load resources');
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [isActive, verseContext, sourceUrls, sourcePreferences]);

  const hiddenTags = useMemo(() => new Set(resourceHiddenTags), [resourceHiddenTags]);
  const matchMode: ResourceVerseMatchMode = selectedVerseNumbers.length > 1
    ? resourceVerseMatchMode
    : 'any';

  const payload = useMemo(
    () => mergeVerseResourcePayloads(versePayloads, matchMode),
    [versePayloads, matchMode]
  );

  const tagColors = useResourceTagColors(payload?.tags);

  const verseTexts = useMemo(() => {
    if (!verseContext || !currentBible) {
      return [];
    }

    const book = currentBible.books.find((entry) => entry.name === verseContext.book);
    const chapter = book?.chapters.find((entry) => entry.chapter === verseContext.chapter);
    return selectedVerseNumbers.map((verseNumber) => ({
      verse: verseNumber,
      text: chapter?.verses.find((entry) => entry.verse === verseNumber)?.text ?? '',
    }));
  }, [verseContext, currentBible, selectedVerseNumbers]);

  const visibleDocuments = useMemo(() => {
    if (!payload) {
      return [];
    }

    if (hiddenTags.size === 0) {
      return payload.documents;
    }

    return payload.documents.filter((document) => {
      if (document.tags.length === 0) {
        return true;
      }

      return document.tags.some((tag) => !hiddenTags.has(tag));
    });
  }, [payload, hiddenTags]);

  const groupedDocuments = useMemo(() => {
    const groups = new Map<string, (typeof visibleDocuments)[number] & { libraryLabels: string[] }>();

    for (const document of visibleDocuments) {
      const key = `${document.documentId}::${document.title}`;
      const existing = groups.get(key);

      if (!existing) {
        groups.set(key, {
          ...document,
          libraryLabels: [document.libraryLabel],
        });
        continue;
      }

      existing.pageLinks = mergePageLinks(existing.pageLinks, document.pageLinks);
      existing.tags = Array.from(new Set([...existing.tags, ...document.tags]));
      if (!existing.libraryLabels.includes(document.libraryLabel)) {
        existing.libraryLabels.push(document.libraryLabel);
      }
    }

    return Array.from(groups.values()).sort((left, right) => left.title.localeCompare(right.title));
  }, [visibleDocuments]);

  const toggleTag = (tag: string) => {
    const next = new Set(hiddenTags);
    if (next.has(tag)) {
      next.delete(tag);
    } else {
      next.add(tag);
    }

    dispatch(setResourceHiddenTags(Array.from(next)));
  };

  const linkReference = verseContext && selectedVerseNumbers.length > 0
    ? { book: verseContext.book, chapter: verseContext.chapter, verse: selectedVerseNumbers[0] }
    : null;

  const handlePageLinkClick = (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    event.preventDefault();
    onBeforeNavigate?.();

    if (typeof window !== 'undefined' && window.location.hash === href) {
      window.dispatchEvent(new Event(REOPEN_DOCUMENT_LINK_EVENT));
      return;
    }

    assignHashWithoutScroll(href);
  };

  if (!verseContext) {
    return (
      <div className="card border-0 shadow-sm h-100" data-help="resources-panel">
        <div className="card-body d-flex flex-column justify-content-center align-items-center text-center">
          <p className="text-body-secondary mb-0">Click a verse to open resources</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card border-0 shadow-sm h-100 d-flex flex-column" data-help="resources-panel">
      <div className="card-body d-flex flex-column gap-3 flex-grow-1 resources-panel-body">
        <div className="position-sticky top-0 z-3 bg-body border-bottom pb-3 resources-panel-sticky">
          <div className="d-flex align-items-start justify-content-between gap-2">
            <div data-help="resources-reference">
              <VerseReferenceLabel
                verseContext={verseContext}
                className="small fw-semibold mb-1"
                onClick={() => {
                  onBeforeNavigate?.();
                  revealInBible(verseContext);
                }}
              />
            </div>
            {selectedVerseNumbers.length > 1 && (
              <div
                className="btn-group btn-group-sm resources-verse-match-toggle"
                role="group"
                aria-label="Show resources containing ALL these verses or ANY of these verses."
                title="Show resources containing ALL these verses or ANY of these verses."
                data-help="resources-match-toggle"
              >
                <button
                  type="button"
                  className={`btn ${resourceVerseMatchMode === 'all' ? 'btn-primary' : 'btn-outline-primary'}`}
                  aria-pressed={resourceVerseMatchMode === 'all'}
                  onClick={() => dispatch(setResourceVerseMatchMode('all'))}
                >
                  ALL
                </button>
                <button
                  type="button"
                  className={`btn ${resourceVerseMatchMode === 'any' ? 'btn-primary' : 'btn-outline-primary'}`}
                  aria-pressed={resourceVerseMatchMode === 'any'}
                  onClick={() => dispatch(setResourceVerseMatchMode('any'))}
                >
                  ANY
                </button>
              </div>
            )}
          </div>
          <div className="small">
            <VerseTextList
              verses={verseTexts}
              totalVerseCount={selectedVerseNumbers.length}
              markupFlags={markupFlagsFromBible(currentBible)}
              verseMarkupSettings={verseMarkupSettings}
              onOverflowClick={verseContext
                ? () => {
                  onBeforeNavigate?.();
                  revealInBible(verseContext);
                }
                : undefined}
            />
          </div>
        </div>

        <div className="d-flex flex-column gap-3 resources-panel-scroll">
          {isLoading && <p className="text-body-secondary small mb-0">Loading resources...</p>}
          {error && <p className="text-danger small mb-0">{error}</p>}

          {!isLoading && !error && payload && (
            <>
              {payload.tags.length > 0 && (
                <div className="d-flex flex-wrap gap-2 resources-panel-tags" data-help="resources-tags">
                  {payload.tags.map((tag) => {
                    const isOn = !hiddenTags.has(tag);
                    const color = tagColors.get(tag) ?? '#6c757d';
                    const textColor = isOn ? pickReadableTextColor(color) : color;
                    const style = {
                      ['--resource-tag-color' as '--resource-tag-color']: color,
                      ['--resource-tag-text-color' as '--resource-tag-text-color']: textColor,
                    } as React.CSSProperties;

                    return (
                      <button
                        key={tag}
                        type="button"
                        className={`d-inline-flex align-items-center gap-1 resource-tag-button ${isOn ? 'is-active' : 'is-inactive'}`}
                        aria-pressed={isOn}
                        onClick={() => toggleTag(tag)}
                        title={tag}
                        style={style}
                      >
                        <i className={`fa-solid ${isOn ? 'fa-eye' : 'fa-eye-slash'}`} aria-hidden="true"></i>
                        <span>{tag}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {groupedDocuments.length === 0 ? (
                <p className="text-body-secondary small mb-0">
                  {selectedVerseNumbers.length > 1
                    ? 'No resources matched these verses.'
                    : 'No resources matched this verse.'}
                </p>
              ) : (
                <div className="d-flex flex-column gap-2" data-help="resources-document-list">
                  {groupedDocuments.map((document, documentIndex) => {
                    const isSelected = pdfViewer.isOpen
                      && document.pageLinks.some((link) => link.url === pdfViewer.sourceUrl);

                    return (
                    <div
                      key={document.documentId}
                      className={`resource-document border rounded p-2 ${isSelected ? 'is-selected' : ''}`}
                      data-help={documentIndex === 0 ? 'resources-document' : undefined}
                    >
                      <div className="d-flex align-items-center justify-content-between gap-2 flex-wrap">
                        <div className="d-flex align-items-center flex-wrap gap-2 flex-grow-1">
                          <span
                            className="small fw-semibold"
                            title={`Pulled from ${document.libraryLabels[0] ?? 'this library'}`}
                          >
                            {document.title}
                          </span>
                          <div className="d-inline-flex align-items-center gap-1 flex-wrap">
                            {document.tags.map((tag) => {
                              const color = tagColors.get(tag) ?? '#6c757d';
                              return (
                                <span
                                  key={`${document.documentId}:${tag}`}
                                  className="resource-tag-dot"
                                  title={tag}
                                  style={{
                                    ['--resource-tag-color' as '--resource-tag-color']: color,
                                  } as React.CSSProperties}
                                ></span>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      <div className="small mt-1">
                        {document.pageLinks.map((link, index) => {
                          const href = buildDocumentLinkRoute(linkReference, { ...document.link, page: link.page });
                          return (
                            <span key={`${document.documentId}:${link.page}`}>
                              {index > 0 ? ', ' : ''}
                              <a
                                className="resource-page-link btn btn-link btn-sm p-0 align-baseline"
                                href={href}
                                data-help={documentIndex === 0 && index === 0 ? 'resources-page-link' : undefined}
                                onClick={(event) => handlePageLinkClick(event, href)}
                              >
                                {link.page}
                              </a>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

function pickReadableTextColor(color: string): string {
  const rgb = parseColorToRgb(color);
  if (!rgb) {
    return '#111111';
  }

  const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return luminance > 0.62 ? '#111111' : '#ffffff';
}

function parseColorToRgb(value: string): { r: number; g: number; b: number } | null {
  const hex = value.trim();
  if (hex.startsWith('#')) {
    if (hex.length === 7) {
      const r = Number.parseInt(hex.slice(1, 3), 16);
      const g = Number.parseInt(hex.slice(3, 5), 16);
      const b = Number.parseInt(hex.slice(5, 7), 16);
      return { r, g, b };
    }
    if (hex.length === 4) {
      const r = Number.parseInt(hex[1] + hex[1], 16);
      const g = Number.parseInt(hex[2] + hex[2], 16);
      const b = Number.parseInt(hex[3] + hex[3], 16);
      return { r, g, b };
    }
  }

  return null;
}

export default ResourcesPanel;
