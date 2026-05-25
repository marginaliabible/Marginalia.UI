import React, { useState, useMemo } from 'react';
import type { PanelTab, VerseContext } from '../models/tab';
import type { BibleData, BibleTranslationMeta, TranslationRecord } from '../models/bible';

interface TranslationsPanelProps {
  tab: PanelTab;
  translationRecords: TranslationRecord[];
  translationMetadataById: Map<string, BibleTranslationMeta>;
  loadedTranslations: Record<string, BibleData>;
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
  loadedTranslations,
  addableTranslations,
  onAddTranslation,
  onRemoveTranslation,
  onToggleStar,
  onReorder,
}) => {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [translationFilter, setTranslationFilter] = useState('');
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

  const verseTextByTranslation = useMemo(() => {
    if (!verseContext) {
      return new Map<string, string>();
    }

    const { book, chapter, verse } = verseContext;
    const result = new Map<string, string>();

    for (const record of translationRecords) {
      const bible = loadedTranslations[record.id];
      if (!bible) {
        result.set(record.id, '');
        continue;
      }

      const bookData = bible.books.find((b) => b.name === book);
      const chapterData = bookData?.chapters.find((c) => c.chapter === chapter);
      const verseData = chapterData?.verses.find((v) => v.verse === verse);
      result.set(record.id, verseData?.text ?? '');
    }

    return result;
  }, [verseContext, translationRecords, loadedTranslations]);

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

    const fromRecord = translationRecords[draggedIndex];
    const toRecord = translationRecords[targetIndex];

    // Only allow reordering within the same starred/unstarred group
    if (fromRecord.starred !== toRecord.starred) {
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
          <p className="text-body-secondary mb-0">Click a verse number to open translations</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card border-0 shadow-sm h-100 d-flex flex-column">
      <div className="card-body d-flex flex-column gap-3 translations-panel-shell" style={{ flex: '1 1 auto', minHeight: 0 }}>
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
                translationRecords.map((record, index) => {
                  const meta = translationMetadataById.get(record.id);
                  const label = meta?.label ?? record.id;
                  const chipText = `${record.id}: ${label}`;
                  const verseText = verseTextByTranslation.get(record.id) ?? '';
                  const canClose = !record.starred;
                  const isLastStarred = record.starred && translationRecords.filter((r) => r.starred).length === 1;

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
                        style={{
                          cursor: 'grab',
                          opacity: draggedIndex === index ? 0.5 : 1
                        }}
                      >
                        <div className="d-flex align-items-center justify-content-between mb-2">
                          <div className="d-flex align-items-center gap-2 flex-grow-1">
                            <span className="text-muted" style={{ cursor: 'grab' }} title="Drag to reorder">
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
                              aria-label={record.starred ? 'Unstar translation' : 'Star translation'}
                              title={
                                isLastStarred
                                  ? 'Cannot unstar the last starred translation'
                                  : record.starred
                                    ? 'Remove from main page'
                                    : 'Show on main page'
                              }
                            >
                              <i className={`fa-${record.starred ? 'solid' : 'regular'} fa-star`} aria-hidden="true"></i>
                            </button>
                            <span className="small fw-semibold" title={chipText}>
                              {label}
                            </span>
                          </div>

                          <div className="d-flex align-items-center gap-1">
                            {canClose && (
                              <button
                                type="button"
                                className="btn btn-sm btn-link p-0 text-danger"
                                onClick={() => onRemoveTranslation(record.id)}
                                aria-label="Close translation"
                                title="Remove translation"
                              >
                                ×
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="text-body text-small" style={{ lineHeight: 1.6 }}>
                          {verseText || <span className="text-muted">-</span>}
                        </div>
                      </div>
                    </div>
                  );
                })
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
