import React, { useEffect, useMemo, useState } from 'react';
import type { PanelTab, VerseContext } from '../models/tab';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { setResourceHiddenTags } from '../store/slices/uiSlice';
import { bibleService, type VerseResourcesPayload } from '../services/bibleService';

interface ResourcesPanelProps {
  tab: PanelTab;
}

const TAG_COLOR_STORAGE_KEY = 'gitbible:resource-tag-colors';
const TAG_COLOR_PALETTE = [
  '#0aa7a0', '#f1c40f', '#e84393', '#16a085', '#2ecc71', '#f39c12', '#e67e22', '#2980b9',
  '#1abc9c', '#c0392b', '#27ae60', '#8e44ad', '#d35400', '#3498db', '#7f8c8d', '#9b59b6',
  '#00b894', '#fdcb6e', '#0984e3', '#6c5ce7', '#e17055', '#00cec9', '#55efc4', '#fab1a0',
];

const ResourcesPanel: React.FC<ResourcesPanelProps> = ({ tab }) => {
  const verseContext = tab.verseContext as VerseContext | undefined;
  const dispatch = useAppDispatch();
  const { sourceUrls, resourceHiddenTags } = useAppSelector((state) => state.ui);
  const { currentBible } = useAppSelector((state) => state.bible);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<VerseResourcesPayload | null>(null);
  const [tagColors, setTagColors] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__GITBIBLE_RESOURCE_TAG_SWATCHES__ = TAG_COLOR_PALETTE;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!verseContext) {
        if (!cancelled) {
          setPayload(null);
          setError(null);
        }
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const nextPayload = await bibleService.getResourcesForVerse(
          verseContext.book,
          verseContext.chapter,
          verseContext.verse,
          sourceUrls
        );

        if (cancelled) {
          return;
        }

        setPayload(nextPayload);

        const colors = getOrAssignTagColors(nextPayload.tags);
        setTagColors(colors);
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        setPayload(null);
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
  }, [verseContext, sourceUrls]);

  const hiddenTags = useMemo(() => new Set(resourceHiddenTags), [resourceHiddenTags]);

  const verseText = useMemo(() => {
    if (!verseContext || !currentBible) {
      return '';
    }

    const book = currentBible.books.find((entry) => entry.name === verseContext.book);
    const chapter = book?.chapters.find((entry) => entry.chapter === verseContext.chapter);
    const verse = chapter?.verses.find((entry) => entry.verse === verseContext.verse);
    return verse?.text ?? '';
  }, [verseContext, currentBible]);

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

  if (!verseContext) {
    return (
      <div className="card border-0 shadow-sm h-100">
        <div className="card-body d-flex flex-column justify-content-center align-items-center text-center">
          <p className="text-body-secondary mb-0">Click a verse to open resources</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card border-0 shadow-sm h-100 d-flex flex-column">
      <div className="card-body d-flex flex-column gap-3 flex-grow-1 resources-panel-body">
        <div className="position-sticky top-0 z-3 bg-body border-bottom pb-3 resources-panel-sticky">
          <div className="small fw-semibold text-body-secondary mb-1">
            {verseContext.book} {verseContext.chapter}:{verseContext.verse}
          </div>
          <div className="small">{verseText || 'Verse text unavailable in current translation.'}</div>
        </div>

        <div className="d-flex flex-column gap-3 resources-panel-scroll">
          {isLoading && <p className="text-body-secondary small mb-0">Loading resources...</p>}
          {error && <p className="text-danger small mb-0">{error}</p>}

          {!isLoading && !error && payload && (
            <>
              {payload.tags.length > 0 && (
                <div className="d-flex flex-wrap gap-2 resources-panel-tags">
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
                        className={`btn btn-sm d-inline-flex align-items-center gap-1 resource-tag-button ${isOn ? 'is-active' : 'is-inactive'}`}
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
                <p className="text-body-secondary small mb-0">No resources matched this verse.</p>
              ) : (
                <div className="d-flex flex-column gap-2">
                  {groupedDocuments.map((document) => (
                    <div key={document.documentId} className="border rounded p-2">
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
                        {document.pageLinks.map((link, index) => (
                          <span key={`${document.documentId}:${link.page}`}>
                            {index > 0 ? ', ' : ''}
                            <a href={link.url} target="_blank" rel="noreferrer">
                              {link.page}
                            </a>
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

function mergePageLinks(
  left: { page: number; url: string }[],
  right: { page: number; url: string }[]
): { page: number; url: string }[] {
  const byPage = new Map<number, { page: number; url: string }>();

  for (const link of [...left, ...right]) {
    if (!byPage.has(link.page)) {
      byPage.set(link.page, link);
    }
  }

  return Array.from(byPage.values()).sort((a, b) => a.page - b.page);
}

function readStoredTagColors(): Map<string, string> {
  if (typeof window === 'undefined') {
    return new Map();
  }

  try {
    const raw = window.localStorage.getItem(TAG_COLOR_STORAGE_KEY);
    if (!raw) {
      return new Map();
    }

    const parsed = JSON.parse(raw) as Record<string, string>;
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

function writeStoredTagColors(map: Map<string, string>): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(TAG_COLOR_STORAGE_KEY, JSON.stringify(Object.fromEntries(map.entries())));
  } catch {
    // Best effort cache write only.
  }
}

function getOrAssignTagColors(tags: string[]): Map<string, string> {
  const stored = readStoredTagColors();
  const used = new Set(Array.from(stored.values()));
  let nextPaletteIndex = 0;

  for (const tag of tags) {
    if (stored.has(tag)) {
      continue;
    }

    let color: string | null = null;
    while (nextPaletteIndex < TAG_COLOR_PALETTE.length) {
      const candidate = TAG_COLOR_PALETTE[nextPaletteIndex++];
      if (!used.has(candidate)) {
        color = candidate;
        break;
      }
    }

    if (!color) {
      color = generateFallbackColor(used.size);
    }

    stored.set(tag, color);
    used.add(color);
  }

  writeStoredTagColors(stored);
  return stored;
}

function generateFallbackColor(index: number): string {
  const hue = (index * 137.508) % 360;
  return `hsl(${hue.toFixed(0)} 70% 52%)`;
}

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
