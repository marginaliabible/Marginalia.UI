import React, { useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { SubscriptionsBinding } from '../models/subscription';
import type { SubscriptionDocument, SubscriptionLibrary } from '../services/subscriptionCatalogService';
import type { SubscriptionStaging } from '../hooks/useSubscriptionStaging';
import {
  applyResourceTagOverride,
  buildResourceTagOverride,
  SUBSCRIPTION_DOCUMENT_TYPES,
  typeItemKey,
  type SubscriptionDocumentType,
} from '../utils/sourceSubscriptions';
import { getStoredResourceTagColors } from '../utils/resourceTagColors';
import FileSyncTagModal from './FileSyncTagModal';
import FileSyncTagRowTags from './FileSyncTagRowTags';

const ROOT_GROUP = '__subscriptions__';

const TYPE_LABEL: Record<SubscriptionDocumentType, string> = {
  translation: 'Translations',
  resource: 'Resources',
  hyperlink: 'Hyperlinks',
};

export interface SubscriptionRevealTarget {
  libraryKey: string;
  type?: SubscriptionDocumentType;
  documentKey?: string;
  flash?: boolean;
}

export interface SubscriptionsPanelHandle {
  reveal: (target: SubscriptionRevealTarget) => void;
}

interface SubscriptionsPanelProps {
  binding: SubscriptionsBinding;
  staging: SubscriptionStaging;
  ref?: React.Ref<SubscriptionsPanelHandle>;
}

type SubscriptionRow =
  | { kind: 'library'; key: string; depth: number; library: SubscriptionLibrary }
  | { kind: 'type'; key: string; depth: number; library: SubscriptionLibrary; type: SubscriptionDocumentType; count: number }
  | { kind: 'document'; key: string; depth: number; library: SubscriptionLibrary; type: SubscriptionDocumentType; document: SubscriptionDocument }
  | { kind: 'empty'; key: string; depth: number; library: SubscriptionLibrary };

export function libraryRowKey(libraryKey: string): string {
  return `library:${libraryKey}`;
}

function exposedTypes(library: SubscriptionLibrary): SubscriptionDocumentType[] {
  return SUBSCRIPTION_DOCUMENT_TYPES.filter((type) => (library.types[type]?.length ?? 0) > 0);
}

/** Built-In plus every subscription that is still saved (disconnects remove the URL right away). */
export function visibleSubscriptionLibraries(binding: SubscriptionsBinding): SubscriptionLibrary[] {
  return binding.libraries.filter((library) => library.isBuiltIn || binding.sourceUrls.includes(library.key));
}

function formatCount(count: number): string {
  return count === 1 ? '1 item' : `${count} items`;
}

const SubscriptionsPanel: React.FC<SubscriptionsPanelProps> = ({ binding, staging, ref }) => {
  const [expandedByParent, setExpandedByParent] = useState<Record<string, string>>({});
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [tagColors, setTagColors] = useState<Map<string, string>>(() => getStoredResourceTagColors());
  const [tagModalTarget, setTagModalTarget] = useState<{
    resourceKey: string;
    label: string;
    publisherTags: string[];
    currentTags: string[];
  } | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const libraries = useMemo(() => visibleSubscriptionLibraries(binding), [binding]);
  const starredIds = useMemo(
    () => new Set(binding.translationRecords.filter((record) => record.starred).map((record) => record.id)),
    [binding.translationRecords]
  );
  const disconnected = useMemo(() => new Set(staging.staging.disconnected), [staging.staging.disconnected]);
  const disabled = useMemo(() => new Set(staging.staging.disabled), [staging.staging.disabled]);

  useImperativeHandle(ref, () => ({
    reveal: ({ libraryKey, type, documentKey, flash }) => {
      const library = libraries.find((entry) => entry.key === libraryKey);
      if (!library) {
        return;
      }

      const libraryKeyForRow = libraryRowKey(libraryKey);
      setExpandedByParent((current) => {
        const next: Record<string, string> = { ...current, [ROOT_GROUP]: libraryKeyForRow };
        if (type && exposedTypes(library).length > 1) {
          next[libraryKeyForRow] = typeItemKey(libraryKey, type);
        }
        return next;
      });

      const targetKey = documentKey ?? libraryKeyForRow;
      window.setTimeout(() => {
        rowRefs.current[targetKey]?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        if (flash) {
          setFlashKey(targetKey);
          window.setTimeout(() => {
            setFlashKey((current) => (current === targetKey ? null : current));
          }, 3000);
        }
      }, 30);
    },
  }), [libraries]);

  const rows = useMemo<SubscriptionRow[]>(() => {
    const result: SubscriptionRow[] = [];
    for (const library of libraries) {
      const libraryKeyForRow = libraryRowKey(library.key);
      result.push({ kind: 'library', key: libraryKeyForRow, depth: 0, library });
      if (expandedByParent[ROOT_GROUP] !== libraryKeyForRow) {
        continue;
      }

      const types = exposedTypes(library);
      if (types.length === 0) {
        result.push({ kind: 'empty', key: `${libraryKeyForRow}:empty`, depth: 1, library });
        continue;
      }

      const pushDocuments = (type: SubscriptionDocumentType, depth: number) => {
        for (const document of library.types[type] ?? []) {
          result.push({ kind: 'document', key: document.key, depth, library, type, document });
        }
      };

      if (types.length === 1) {
        pushDocuments(types[0], 1);
        continue;
      }

      for (const type of types) {
        const typeKey = typeItemKey(library.key, type);
        result.push({ kind: 'type', key: typeKey, depth: 1, library, type, count: library.types[type]?.length ?? 0 });
        if (expandedByParent[libraryKeyForRow] === typeKey) {
          pushDocuments(type, 2);
        }
      }
    }

    return result;
  }, [expandedByParent, libraries]);

  const toggleExpanded = (groupKey: string, childKey: string) => {
    setExpandedByParent((current) => {
      const next = { ...current };
      if (current[groupKey] === childKey) {
        delete next[groupKey];
      } else {
        next[groupKey] = childKey;
      }
      return next;
    });
  };

  const copySubscriptionUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      return;
    }
    setCopiedUrl(url);
    window.setTimeout(() => {
      setCopiedUrl((current) => (current === url ? null : current));
    }, 1500);
  };

  const renderToggle = (options: {
    label: string;
    isOff: boolean;
    isCovered: boolean;
    onToggle: () => void;
  }) => {
    const { label, isOff, isCovered, onToggle } = options;
    return (
      <button
        type="button"
        className={`btn btn-link btn-sm p-0 ${isOff ? 'cloud-folder-selected-restore text-warning' : 'cloud-folder-selected-remove text-info'}`}
        style={isCovered ? { visibility: 'hidden' } : undefined}
        title={isOff ? 'Sync disabled. Click to resume syncing' : 'Sync enabled. Click to exclude from syncing.'}
        aria-label={isOff ? `Resume syncing ${label}` : `Exclude ${label} from sync`}
        aria-hidden={isCovered}
        disabled={isCovered}
        tabIndex={isCovered ? -1 : undefined}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
      >
        <i className={`fa-solid ${isOff ? 'fa-upload' : 'fa-arrows-rotate'}`}></i>
      </button>
    );
  };

  return (
    <div className="subscriptions-panel">
      {binding.isCatalogLoading && libraries.every((library) => exposedTypes(library).length === 0) && (
        <p className="small text-body-secondary mb-0">Loading subscriptions...</p>
      )}

      <ul className="cloud-folder-selected-list" aria-label="Subscription libraries">
        {rows.map((row) => {
          const libraryOff = disconnected.has(row.library.key);
          const rowClassName = `cloud-folder-selected-row${flashKey === row.key ? ' is-highlighted' : ''}`;
          const setRowRef = (entry: HTMLDivElement | null) => {
            rowRefs.current[row.key] = entry;
          };

          if (row.kind === 'library') {
            const { library } = row;
            const types = exposedTypes(library);
            const isExpanded = expandedByParent[ROOT_GROUP] === row.key;
            const total = types.reduce((sum, type) => sum + (library.types[type]?.length ?? 0), 0);
            return (
              <li key={row.key}>
                <div
                  ref={setRowRef}
                  className={`${rowClassName} is-clickable`}
                  onClick={() => toggleExpanded(ROOT_GROUP, row.key)}
                >
                  <button
                    type="button"
                    className="cloud-folder-tree-chevron"
                    aria-label={isExpanded ? `Collapse ${library.name}` : `Expand ${library.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleExpanded(ROOT_GROUP, row.key);
                    }}
                  >
                    <i className={`fa-solid ${isExpanded ? 'fa-chevron-down' : 'fa-chevron-right'}`} aria-hidden="true"></i>
                  </button>
                  <div className="cloud-folder-selected-name-wrap">
                    <button
                      type="button"
                      className={`btn btn-link btn-sm p-0 text-start cloud-folder-selected-path${libraryOff ? ' text-body-secondary' : ''}`}
                      title={library.isBuiltIn ? undefined : library.key}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleExpanded(ROOT_GROUP, row.key);
                      }}
                    >
                      {`Subscriptions/\u200B${library.name}`}
                    </button>
                    {!library.isBuiltIn && (
                      <button
                        type="button"
                        className="btn btn-link btn-sm p-0 text-body-secondary"
                        title={copiedUrl === library.key ? 'Copied!' : `Copy URL: ${library.key}`}
                        aria-label={`Copy URL for ${library.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          void copySubscriptionUrl(library.key);
                        }}
                      >
                        <i className={copiedUrl === library.key ? 'fa-solid fa-check text-success' : 'fa-regular fa-copy'} aria-hidden="true"></i>
                      </button>
                    )}
                  </div>
                  <span className="cloud-folder-selected-size text-end text-nowrap text-body-secondary">
                    {total > 0 ? formatCount(total) : ''}
                  </span>
                  <span className="cloud-folder-selected-action">
                    <button
                      type="button"
                      className={`btn btn-link btn-sm p-0 ${libraryOff ? 'cloud-folder-selected-restore text-warning' : 'cloud-folder-selected-remove text-info'}`}
                      title={library.isBuiltIn
                        ? 'Built-In libraries are always available. Disable individual entries instead.'
                        : libraryOff
                          ? 'Will disconnect when you Apply. Click to keep syncing.'
                          : 'Sync enabled. Click to stop syncing.'}
                      aria-label={libraryOff ? `Resume syncing ${library.name}` : `Stop syncing ${library.name}`}
                      disabled={library.isBuiltIn}
                      onClick={(event) => {
                        event.stopPropagation();
                        staging.toggleDisconnect(library.key);
                      }}
                    >
                      <i className={`fa-solid ${libraryOff ? 'fa-upload' : 'fa-arrows-rotate'}`}></i>
                    </button>
                  </span>
                </div>
              </li>
            );
          }

          if (row.kind === 'empty') {
            return (
              <li key={row.key}>
                <div className="cloud-folder-selected-row" style={{ paddingLeft: `${row.depth * 0.55}rem` }}>
                  <span className="cloud-folder-tree-chevron-spacer" aria-hidden="true"></span>
                  <span className="cloud-folder-selected-name text-body-secondary">
                    {binding.isCatalogLoading ? 'Loading...' : 'No documents found.'}
                  </span>
                  <span></span>
                  <span></span>
                </div>
              </li>
            );
          }

          if (row.kind === 'type') {
            const libraryKeyForRow = libraryRowKey(row.library.key);
            const isExpanded = expandedByParent[libraryKeyForRow] === row.key;
            const isOff = disabled.has(row.key);
            return (
              <li key={row.key}>
                <div
                  ref={setRowRef}
                  className={`${rowClassName} is-clickable`}
                  style={{ paddingLeft: `${row.depth * 0.55}rem` }}
                  onClick={() => toggleExpanded(libraryKeyForRow, row.key)}
                >
                  <button
                    type="button"
                    className="cloud-folder-tree-chevron"
                    aria-label={isExpanded ? `Collapse ${TYPE_LABEL[row.type]}` : `Expand ${TYPE_LABEL[row.type]}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleExpanded(libraryKeyForRow, row.key);
                    }}
                  >
                    <i className={`fa-solid ${isExpanded ? 'fa-chevron-down' : 'fa-chevron-right'}`} aria-hidden="true"></i>
                  </button>
                  <div className="cloud-folder-selected-name-wrap">
                    <span className={`cloud-folder-selected-name${isOff || libraryOff ? ' is-unsupported' : ''}`}>
                      {TYPE_LABEL[row.type]}
                    </span>
                  </div>
                  <span className="cloud-folder-selected-size text-end text-nowrap text-body-secondary">
                    {formatCount(row.count)}
                  </span>
                  <span className="cloud-folder-selected-action">
                    {renderToggle({
                      label: `${TYPE_LABEL[row.type]} in ${row.library.name}`,
                      isOff,
                      isCovered: libraryOff,
                      onToggle: () => staging.toggleDisabled(row.key),
                    })}
                  </span>
                </div>
              </li>
            );
          }

          const { document, type } = row;
          const typeOff = disabled.has(typeItemKey(row.library.key, type));
          const isOff = disabled.has(document.key);
          const isCovered = libraryOff || typeOff;
          const isStarred = type === 'translation' && starredIds.has(document.itemId);
          const publisherTags = document.publisherTags ?? [];
          const override = staging.staging.overrides[document.itemId];
          const effectiveTags = type === 'resource' ? applyResourceTagOverride(publisherTags, override) : [];
          const isTaggable = type === 'resource' && !isOff && !isCovered;

          return (
            <li key={row.key}>
              <div ref={setRowRef} className={rowClassName} style={{ paddingLeft: `${row.depth * 0.55}rem` }}>
                <span className="cloud-folder-tree-chevron-spacer" aria-hidden="true"></span>
                <div className="cloud-folder-selected-name-wrap">
                  <span className={`cloud-folder-selected-name${isOff || isCovered ? ' is-unsupported' : ''}`}>
                    {document.label}
                  </span>
                  {isStarred && (
                    <i className="fa-solid fa-star text-warning small" title="Starred translation" aria-label="Starred"></i>
                  )}
                  {isTaggable && (
                    <FileSyncTagRowTags
                      effectiveTags={effectiveTags}
                      ownTags={override?.added ?? []}
                      tagColors={tagColors}
                      onAdd={(event) => {
                        event.stopPropagation();
                        setTagModalTarget({ resourceKey: document.itemId, label: document.label, publisherTags, currentTags: effectiveTags });
                      }}
                      onEditOwn={(event) => {
                        event.stopPropagation();
                        setTagModalTarget({ resourceKey: document.itemId, label: document.label, publisherTags, currentTags: effectiveTags });
                      }}
                    />
                  )}
                </div>
                <span className="cloud-folder-selected-size text-end text-nowrap text-body-secondary"></span>
                <span className="cloud-folder-selected-action">
                  {renderToggle({
                    label: document.label,
                    isOff,
                    isCovered,
                    onToggle: () => staging.toggleDisabled(document.key),
                  })}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      {tagModalTarget && (
        <FileSyncTagModal
          itemLabel={tagModalTarget.label}
          initialTags={tagModalTarget.currentTags}
          onDone={(nextTags) => {
            staging.setTagOverride(
              tagModalTarget.resourceKey,
              buildResourceTagOverride(tagModalTarget.publisherTags, nextTags)
            );
            setTagColors(getStoredResourceTagColors());
            setTagModalTarget(null);
          }}
          onClose={() => setTagModalTarget(null)}
        />
      )}
    </div>
  );
};

export default SubscriptionsPanel;
