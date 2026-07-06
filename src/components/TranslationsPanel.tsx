import React, { useState, useMemo, useEffect } from 'react';
import type { PanelTab, VerseContext } from '../models/tab';
import type { BibleTranslationMeta, TranslationRecord } from '../models/bible';
import { bibleService } from '../services/bibleService';

interface TranslationsPanelProps {
  tab: PanelTab;
  translationRecords: TranslationRecord[];
  translationMetadataById: Map<string, BibleTranslationMeta>;
  addableTranslations: BibleTranslationMeta[];
  onAddTranslation: (id: string) => void;
  onRemoveTranslation: (id: string) => void;
  onToggleStar: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

const TranslationsPanel: React.FC<TranslationsPanelProps> = ({
  tab,
  translationRecords,
  translationMetadataById,
  addableTranslations,
  onAddTranslation,
  onRemoveTranslation,
  onToggleStar,
  onReorder,
}) => {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [translationFilter, setTranslationFilter] = useState('');
  const [verseTextByTranslation, setVerseTextByTranslation] = useState<Map<string, string>>(new Map());
  const verseContext = tab.verseContext as VerseContext | undefined;

  const filteredAddableTranslations = useMemo(() => {
    const query = translationFilter.trim().toLowerCase();
    if (!query) {
      return addableTranslations;
    }

    return addableTranslations.filter((translation) => {
      const haystack = `${translation.id} ${translation.label}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [addableTranslations, translationFilter]);

  useEffect(() => {
    let cancelled = false;

    const loadVerseTexts = async () => {
      if (!verseContext) {
        if (!cancelled) {
          setVerseTextByTranslation(new Map());
        }
        return;
      }

      const { book, chapter, verse } = verseContext;
      const entries = await Promise.all(
        translationRecords.map(async (record) => {
          const text = await bibleService.loadVerseText(record.id, book, chapter, verse);
          return [record.id, text] as const;
        })
      );

      if (!cancelled) {
        setVerseTextByTranslation(new Map(entries));
      }
    };

    void loadVerseTexts();
    return () => {
      cancelled = true;
    };
  }, [verseContext, translationRecords]);

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (targetIndex: number) => {
    if (draggedIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null);
      return;
    }

    onReorder(draggedIndex, targetIndex);
    setDraggedIndex(null);
  };

  if (!verseContext) {
    return (
      <div className="card border-0 shadow-sm h-100">
        <div className="card-body d-flex flex-column justify-content-center align-items-center text-center">
          <p className="text-body-secondary mb-0">Click a verse or verse number to open translations</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card border-0 shadow-sm h-100 d-flex flex-column">
      <div className="card-body d-flex flex-column gap-3 flex-grow-1 translations-panel-shell translations-panel-body">
        {/* Verse reference header */}
        <div className="d-flex align-items-center justify-content-between">
          <span className="text-body-secondary small fw-semibold">
            {verseContext.book} {verseContext.chapter}:{verseContext.verse}
          </span>
        </div>

        <div className="translations-panel-layout">
          <div className="translations-panel-verse-column">
            <div className="translations-verse-grid">
              {translationRecords.length === 0 ? (
                <div className="translations-verse-grid-empty">
                  <p className="text-body-secondary text-center mb-0">Select translations above</p>
                </div>
              ) : (
                (() => {
                  const starredCount = translationRecords.filter((r) => r.starred).length;

                  return translationRecords.map((record, index) => {
                  const meta = translationMetadataById.get(record.id);
                  const label = meta?.label ?? record.id;
                  const chipText = `${record.id}: ${label}`;
                  const verseText = verseTextByTranslation.get(record.id) ?? '';
                  const isLastStarred = record.starred && starredCount === 1;

                  return (
                    <div key={record.id} className="translations-verse-grid-item">
                      <div
                        draggable
                        onDragStart={() => handleDragStart(index)}
                        onDragOver={handleDragOver}
                        onDrop={() => handleDrop(index)}
                        className={`card border p-2 translation-verse-card ${
                          draggedIndex === index ? 'opacity-50' : ''
                        }`}
                      >
                        <div className="d-flex align-items-center justify-content-between mb-2">
                          <div className="d-flex align-items-center gap-2 flex-grow-1">
                            <span className="text-muted translation-drag-handle" title="Drag to reorder">
                              ⋮
                            </span>
                            <button
                              type="button"
                              className={`btn btn-sm btn-link p-0 ${record.starred ? 'text-warning' : 'text-muted'}`}
                              onClick={() => {
                                if (!isLastStarred) {
                                  onToggleStar(record.id);
                                }
                              }}
                              disabled={isLastStarred}
                              aria-label={
                                isLastStarred
                                  ? 'Cannot remove the last side-by-side translation'
                                  : record.starred
                                    ? 'Remove from side-by-side translations'
                                    : 'Include in side-by-side translations'
                              }
                              title={
                                isLastStarred
                                  ? 'Cannot unstar the last starred translation'
                                  : record.starred
                                    ? 'Remove from side-by-side translations'
                                    : 'Include in side-by-side translations'
                              }
                            >
                              <i className={`fa-${record.starred ? 'solid' : 'regular'} fa-star`} aria-hidden="true"></i>
                            </button>
                            <span className="small fw-semibold" title={chipText}>
                              {label}
                            </span>
                          </div>

                          <div className="d-flex align-items-center gap-1">
                            <button
                              type="button"
                              className="btn btn-sm p-0 border-0 bg-transparent text-body-secondary fs-5 lh-1 text-decoration-none"
                              onClick={() => onRemoveTranslation(record.id)}
                              aria-label={isLastStarred ? 'Cannot remove the last starred translation' : 'Remove translation'}
                              title={isLastStarred ? 'Cannot remove the last starred translation' : 'Remove translation'}
                              disabled={isLastStarred}
                            >
                              ×
                            </button>
                          </div>
                        </div>

                        <div className="text-body text-small lh-base">
                          {verseText || (
                            <span
                              className="text-muted"
                              title="This verse is not available in this translation"
                            >
                              Not available in this translation
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                });
                })()
              )}
            </div>
          </div>

          <div className="translations-panel-add-column">
            <label htmlFor="moreTranslationsFilter" className="form-label text-uppercase small fw-semibold mb-1">
              More Translations
            </label>
            <div className="mb-2">
              <input
                id="moreTranslationsFilter"
                type="search"
                className="form-control form-control-sm"
                placeholder="Filter"
                value={translationFilter}
                onChange={(event) => setTranslationFilter(event.target.value)}
              />
            </div>
            {addableTranslations.length === 0 ? (
              <p className="text-body-secondary small mb-0">No additional translations available for selected languages.</p>
            ) : filteredAddableTranslations.length === 0 ? (
              <p className="text-body-secondary small mb-0">No matching translations.</p>
            ) : (
              <div className="d-flex flex-column gap-1">
                {filteredAddableTranslations.map((translation) => (
                  <a
                    key={translation.id}
                    href="#"
                    className="small"
                    onClick={(event) => {
                      event.preventDefault();
                      onAddTranslation(translation.id);
                    }}
                    title={`${translation.id} - ${translation.label}`}
                  >
                    {translation.label}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};

export default TranslationsPanel;
