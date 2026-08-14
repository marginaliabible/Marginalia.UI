import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FederatedProvider } from '../models/bible';
import type { FederatedSession } from '../services/federatedAuthService';
import {
  listFolderChildrenForSession,
  readFolderSizeForSession,
  readFolderRootSizeForSession,
} from '../services/cloudConfigProviderService';
import { useHorizontalSplit } from '../hooks/useHorizontalSplit';
import WorkspaceDivider from './WorkspaceDivider';

const ROOT_LABEL: Record<FederatedProvider, string> = {
  google: 'Google Drive',
  microsoft: 'OneDrive',
};

export interface FolderSelectionTarget {
  id: string;
  kind: 'folder';
  name?: string;
  path?: string;
  sizeBytes?: number;
  sizeKnown?: boolean;
}

interface CloudFolderPickerProps {
  sessions: Record<FederatedProvider, FederatedSession | null>;
  initialSelections: Record<FederatedProvider, FolderSelectionTarget[]>;
  providerSyncFilesEnabled: Record<FederatedProvider, boolean>;
  focusRequest: { provider: FederatedProvider; requestId: number } | null;
  onSelectionsChange: (next: Record<FederatedProvider, FolderSelectionTarget[]>) => void;
  onConnectRequested: (provider: FederatedProvider) => void;
  onDirtyChange?: (isDirty: boolean) => void;
}

interface FolderTreeNode {
  key: string;
  provider: FederatedProvider;
  id: string;
  name: string;
  path: string;
  sizeBytes: number;
  hasChildren: boolean;
  parentKey: string | null;
  childKeys: string[];
  childrenLoaded: boolean;
  isExpanded: boolean;
  isLoading: boolean;
}

interface SelectedFolder {
  key: string;
  provider: FederatedProvider;
  id: string;
  name: string;
  path: string;
  sizeBytes: number;
  sizeKnown: boolean;
}

interface VisibleNode {
  key: string;
  depth: number;
}

function makeNodeKey(provider: FederatedProvider, id: string): string {
  return `${provider}:${id}`;
}

function normalizePathSegment(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function summarizeChildNames(children: FolderTreeNode[], maxItems: number = 12): string {
  if (children.length === 0) {
    return '(none)';
  }

  const names = children.slice(0, maxItems).map((child) => child.name);
  const suffix = children.length > maxItems ? ` ... (+${children.length - maxItems} more)` : '';
  return `${names.join(', ')}${suffix}`;
}

function formatFolderSize(
  sizeBytes: number,
  options?: { provider?: FederatedProvider; isRoot?: boolean; sizeKnown?: boolean }
): string {
  if (options?.sizeKnown === false) {
    return '';
  }

  const bytes = Number.isFinite(sizeBytes) ? Math.max(0, sizeBytes) : 0;

  if (options?.provider === 'google' && !options?.isRoot && bytes === 0) {
    return '';
  }

  const kb = bytes / 1024;

  if (kb < 1024) {
    return `${Math.round(kb)} KB`;
  }

  const mb = kb / 1024;
  if (mb < 1024) {
    return `${Math.round(mb)} MB`;
  }

  const gb = mb / 1024;
  return `${gb.toFixed(1)} GB`;
}

function toSelectionPayload(selectedRows: SelectedFolder[]): Record<FederatedProvider, FolderSelectionTarget[]> {
  const next: Record<FederatedProvider, FolderSelectionTarget[]> = {
    google: [],
    microsoft: [],
  };

  for (const row of selectedRows) {
    next[row.provider].push({
      id: row.id,
      kind: 'folder',
      name: row.name,
      path: row.path,
      sizeBytes: row.sizeKnown ? row.sizeBytes : undefined,
      sizeKnown: row.sizeKnown,
    });
  }

  return next;
}

function normalizeSelectionPayload(
  payload: Record<FederatedProvider, FolderSelectionTarget[]>
): Record<FederatedProvider, FolderSelectionTarget[]> {
  const normalizeProviderTargets = (targets: FolderSelectionTarget[]): FolderSelectionTarget[] => {
    return [...targets].sort((left, right) => {
      const leftPath = left.path || '';
      const rightPath = right.path || '';
      if (leftPath !== rightPath) {
        return leftPath.localeCompare(rightPath);
      }

      return left.id.localeCompare(right.id);
    });
  };

  return {
    google: normalizeProviderTargets(payload.google || []),
    microsoft: normalizeProviderTargets(payload.microsoft || []),
  };
}

function areSelectionPayloadsEqual(
  left: Record<FederatedProvider, FolderSelectionTarget[]>,
  right: Record<FederatedProvider, FolderSelectionTarget[]>
): boolean {
  const normalizedLeft = normalizeSelectionPayload(left);
  const normalizedRight = normalizeSelectionPayload(right);
  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

function collectDescendantKeys(nodes: Record<string, FolderTreeNode>, startKey: string): string[] {
  const descendants: string[] = [];
  const stack = [...(nodes[startKey]?.childKeys || [])];

  while (stack.length > 0) {
    const key = stack.pop() as string;
    descendants.push(key);
    const node = nodes[key];
    if (!node) {
      continue;
    }

    stack.push(...node.childKeys);
  }

  return descendants;
}

function hasSelectedAncestor(
  nodeKey: string,
  selected: Record<string, SelectedFolder>,
  nodes: Record<string, FolderTreeNode>
): boolean {
  let cursor = nodes[nodeKey]?.parentKey ?? null;
  while (cursor) {
    if (selected[cursor]) {
      return true;
    }

    cursor = nodes[cursor]?.parentKey ?? null;
  }

  return false;
}

function buildSelectedMapFromPayload(
  payload: Record<FederatedProvider, FolderSelectionTarget[]>
): Record<string, SelectedFolder> {
  const nextSelected: Record<string, SelectedFolder> = {};

  for (const provider of ['google', 'microsoft'] as FederatedProvider[]) {
    const providerTargets = payload[provider] || [];
    for (const target of providerTargets) {
      if (target.kind !== 'folder') {
        continue;
      }

      const key = makeNodeKey(provider, target.id);
      nextSelected[key] = {
        key,
        provider,
        id: target.id,
        name: target.name || target.id,
        path: target.path || `${ROOT_LABEL[provider]}/${target.name || target.id}`,
        sizeBytes: Number(target.sizeBytes || 0) || 0,
        sizeKnown: !(provider === 'google' && target.id !== 'root' && (Number(target.sizeBytes || 0) || 0) === 0),
      };
    }
  }

  return nextSelected;
}

const CloudFolderPicker: React.FC<CloudFolderPickerProps> = ({
  sessions,
  initialSelections,
  providerSyncFilesEnabled,
  focusRequest,
  onSelectionsChange,
  onConnectRequested,
  onDirtyChange,
}) => {
  const [loadingRoots, setLoadingRoots] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [rootKeys, setRootKeys] = useState<string[]>([]);
  const [nodes, setNodes] = useState<Record<string, FolderTreeNode>>({});
  const [selected, setSelected] = useState<Record<string, SelectedFolder>>({});
  const [highlightNodeKey, setHighlightNodeKey] = useState<string | null>(null);
  const [highlightServiceProvider, setHighlightServiceProvider] = useState<FederatedProvider | null>(null);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const nodesRef = useRef<Record<string, FolderTreeNode>>({});
  const inFlightLoadsRef = useRef<Record<string, Promise<FolderTreeNode[]>>>({});
  const inFlightSizeReadsRef = useRef<Partial<Record<string, Promise<void>>>>({});
  const nodeRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const rootRowRefs = useRef<Record<FederatedProvider, HTMLDivElement | null>>({ google: null, microsoft: null });
  const initialSelectionsRef = useRef(initialSelections);
  const hasBootstrappedSelectionsRef = useRef(false);
  const {
    primaryPercent: splitPercent,
    secondaryPercent: selectedPanePercent,
    handleDividerPointerDown,
    handleDividerKeyDown,
  } = useHorizontalSplit({
    containerRef: layoutRef,
    initialPercent: 33.3,
    minPercent: 22,
    maxPercent: 78,
    stepPercent: 3,
    enabled: true,
  });

  const updateNodes = useCallback((updater: (current: Record<string, FolderTreeNode>) => Record<string, FolderTreeNode>) => {
    setNodes((current) => {
      const next = updater(current);
      nodesRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    initialSelectionsRef.current = initialSelections;
  }, [initialSelections]);

  useEffect(() => {
    if (!focusRequest) {
      return;
    }

    const provider = focusRequest.provider;
    const rootKey = makeNodeKey(provider, 'root');
    const rootNode = nodesRef.current[rootKey];
    if (!rootNode) {
      return;
    }

    rootRowRefs.current[provider]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setHighlightServiceProvider(provider);

    const timeout = window.setTimeout(() => {
      setHighlightServiceProvider((current) => current === provider ? null : current);
    }, 3000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [focusRequest]);

  const loadChildren = useCallback(async (nodeKey: string): Promise<FolderTreeNode[]> => {
    const node = nodesRef.current[nodeKey];
    if (!node) {
      return [];
    }

    if (node.childrenLoaded) {
      return node.childKeys
        .map((childKey) => nodesRef.current[childKey])
        .filter((entry): entry is FolderTreeNode => Boolean(entry));
    }

    if (node.isLoading) {
      const inFlight = inFlightLoadsRef.current[nodeKey];
      if (inFlight) {
        return inFlight;
      }

      return node.childKeys
        .map((childKey) => nodesRef.current[childKey])
        .filter((entry): entry is FolderTreeNode => Boolean(entry));
    }

    const session = sessions[node.provider];
    if (!session) {
      setErrorMessage(`Reconnect ${ROOT_LABEL[node.provider]} to browse folders.`);
      return [];
    }

    updateNodes((current) => ({
      ...current,
      [nodeKey]: {
        ...current[nodeKey],
        isLoading: true,
      },
    }));

    const loadPromise = (async () => {
      try {
        const children = await listFolderChildrenForSession(session, node.id);
        const nextChildren: FolderTreeNode[] = [];
        updateNodes((current) => {
          const parent = current[nodeKey];
          if (!parent) {
            return current;
          }

          const next = { ...current };
          const childKeys: string[] = [];

          for (const child of children) {
            const childKey = makeNodeKey(parent.provider, child.id);
            childKeys.push(childKey);

            const existingChild = next[childKey];
            next[childKey] = {
              key: childKey,
              provider: parent.provider,
              id: child.id,
              name: child.name,
              path: `${parent.path}/${child.name}`,
              sizeBytes: child.sizeBytes,
              hasChildren: child.hasChildren,
              parentKey: nodeKey,
              childKeys: existingChild?.childKeys || [],
              childrenLoaded: existingChild?.childrenLoaded || false,
              isExpanded: existingChild?.isExpanded || false,
              isLoading: false,
            };

            nextChildren.push(next[childKey]);
          }

          next[nodeKey] = {
            ...parent,
            childKeys,
            childrenLoaded: true,
            isLoading: false,
            hasChildren: childKeys.length > 0,
          };

          return next;
        });

        return nextChildren;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setErrorMessage(`Unable to load folders: ${message}`);
        updateNodes((current) => ({
          ...current,
          [nodeKey]: {
            ...current[nodeKey],
            isLoading: false,
          },
        }));

        return [];
      } finally {
        delete inFlightLoadsRef.current[nodeKey];
      }
    })();

    inFlightLoadsRef.current[nodeKey] = loadPromise;
    return loadPromise;
  }, [sessions, updateNodes]);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      hasBootstrappedSelectionsRef.current = false;
      setLoadingRoots(true);
      setErrorMessage(null);

      const allProviders: FederatedProvider[] = ['google', 'microsoft'];

      const rootEntries = await Promise.all(allProviders.map(async (provider) => {
        const session = sessions[provider];
        const sizeBytes = session ? await readFolderRootSizeForSession(session as FederatedSession) : 0;
        const key = makeNodeKey(provider, 'root');

        return {
          key,
          provider,
          id: 'root',
          name: ROOT_LABEL[provider],
          path: ROOT_LABEL[provider],
          sizeBytes,
          hasChildren: true,
          parentKey: null,
          childKeys: [],
          childrenLoaded: false,
          isExpanded: false,
          isLoading: false,
        } satisfies FolderTreeNode;
      }));

      if (cancelled) {
        return;
      }

      const nextNodes: Record<string, FolderTreeNode> = {};
      const nextRootKeys: string[] = [];
      for (const root of rootEntries) {
        nextNodes[root.key] = root;
        nextRootKeys.push(root.key);
      }

      const initialSelected = buildSelectedMapFromPayload(initialSelectionsRef.current);

      nodesRef.current = nextNodes;
      setNodes(nextNodes);
      setRootKeys(nextRootKeys);
      setSelected(initialSelected);
      hasBootstrappedSelectionsRef.current = true;
      setLoadingRoots(false);
    };

    void bootstrap().catch((error) => {
      if (cancelled) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(`Unable to initialize folder picker: ${message}`);
      setLoadingRoots(false);
    });

    return () => {
      cancelled = true;
    };
  }, [sessions]);

  const visibleNodes = useMemo<VisibleNode[]>(() => {
    const result: VisibleNode[] = [];

    const walk = (key: string, depth: number) => {
      const node = nodes[key];
      if (!node) {
        return;
      }

      result.push({ key, depth });
      if (!node.isExpanded) {
        return;
      }

      for (const childKey of node.childKeys) {
        walk(childKey, depth + 1);
      }
    };

    for (const rootKey of rootKeys) {
      walk(rootKey, 0);
    }

    return result;
  }, [nodes, rootKeys]);

  const selectedRows = useMemo(() => {
    return Object.values(selected).sort((left, right) => left.path.localeCompare(right.path));
  }, [selected]);

  const toggleExpanded = useCallback((key: string) => {
    const node = nodes[key];
    if (!node) {
      return;
    }

    updateNodes((current) => ({
      ...current,
      [key]: {
        ...current[key],
        isExpanded: !current[key].isExpanded,
      },
    }));

    if (!node.childrenLoaded) {
      void loadChildren(key);
    }
  }, [loadChildren, nodes, updateNodes]);

  const toggleSelected = useCallback((key: string) => {
    const node = nodes[key];
    if (!node) {
      return;
    }

    setSelected((current) => {
      const ancestorSelected = hasSelectedAncestor(key, current, nodes);
      if (ancestorSelected) {
        return current;
      }

      if (current[key]) {
        const next = { ...current };
        delete next[key];
        return next;
      }

      const next = { ...current };
      const descendantKeys = collectDescendantKeys(nodes, key);
      for (const descendantKey of descendantKeys) {
        delete next[descendantKey];
      }

      next[key] = {
        key,
        provider: node.provider,
        id: node.id,
        name: node.name,
        path: node.path,
        sizeBytes: node.sizeBytes,
        sizeKnown: !(node.provider === 'google' && node.id !== 'root' && node.sizeBytes === 0),
      };

      return next;
    });
  }, [nodes]);

  const isDirty = useMemo(() => {
    if (!hasBootstrappedSelectionsRef.current) {
      return false;
    }

    return !areSelectionPayloadsEqual(toSelectionPayload(selectedRows), initialSelections);
  }, [initialSelections, selectedRows]);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const handleApply = useCallback(() => {
    onSelectionsChange(toSelectionPayload(selectedRows));
  }, [onSelectionsChange, selectedRows]);

  const handleCancel = useCallback(() => {
    setSelected(buildSelectedMapFromPayload(initialSelectionsRef.current));
  }, []);

  const revealPath = useCallback(async (row: SelectedFolder) => {
    const trace: string[] = [];

    const waitForChildrenLoaded = async (nodeKey: string): Promise<FolderTreeNode[]> => {
      const deadline = Date.now() + 12_000;

      while (Date.now() < deadline) {
        const node = nodesRef.current[nodeKey];
        if (!node) {
          return [];
        }

        if (!node.childrenLoaded && !node.isLoading) {
          await loadChildren(nodeKey);
        }

        if (node.isLoading) {
          const inFlight = inFlightLoadsRef.current[nodeKey];
          if (inFlight) {
            await inFlight;
          } else {
            await new Promise<void>((resolve) => {
              window.setTimeout(resolve, 25);
            });
          }
        }

        const refreshed = nodesRef.current[nodeKey];
        if (!refreshed) {
          return [];
        }

        if (refreshed.childrenLoaded && !refreshed.isLoading) {
          return refreshed.childKeys
            .map((childKey) => nodesRef.current[childKey])
            .filter((entry): entry is FolderTreeNode => Boolean(entry));
        }

        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 25);
        });
      }

      const fallbackNode = nodesRef.current[nodeKey];
      return (fallbackNode?.childKeys || [])
        .map((childKey) => nodesRef.current[childKey])
        .filter((entry): entry is FolderTreeNode => Boolean(entry));
    };

    const revealNode = (resolvedKey: string) => {
      const targetNode = nodesRef.current[resolvedKey];
      if (!targetNode) {
        return;
      }

      const ancestors: string[] = [];
      let cursor = targetNode.parentKey;
      while (cursor) {
        ancestors.push(cursor);
        cursor = nodesRef.current[cursor]?.parentKey ?? null;
      }

      updateNodes((current) => {
        const next = { ...current };
        for (const ancestorKey of ancestors) {
          if (next[ancestorKey]) {
            next[ancestorKey] = {
              ...next[ancestorKey],
              isExpanded: true,
            };
          }
        }

        return next;
      });

      window.setTimeout(() => {
        nodeRefs.current[resolvedKey]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        setHighlightNodeKey(resolvedKey);
        window.setTimeout(() => {
          setHighlightNodeKey((current) => current === resolvedKey ? null : current);
        }, 3000);
      }, 30);
    };

    setErrorMessage(null);

    if (nodesRef.current[row.key]) {
      revealNode(row.key);
      return;
    }

    const rawSegments = row.path
      .split('/')
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);

    if (rawSegments.length === 0) {
      setErrorMessage('No path was available to reveal this folder.');
      return;
    }

    const rootSegmentNormalized = normalizePathSegment(rawSegments[0]);
    const rootKeyByPath = rootKeys.find((candidateKey) => {
      const candidate = nodesRef.current[candidateKey];
      if (!candidate) {
        return false;
      }

      return normalizePathSegment(candidate.name) === rootSegmentNormalized;
    }) || null;

    const rootKey = rootKeyByPath || makeNodeKey(row.provider, 'root');
    if (!nodesRef.current[rootKey]) {
      setErrorMessage('That provider root is not currently loaded.');
      console.warn('Folder reveal failed: missing provider root', {
        provider: row.provider,
        path: row.path,
        key: row.key,
      });
      return;
    }

    const pathSegments = rawSegments.slice(1);

    if (pathSegments.length === 0) {
      revealNode(rootKey);
      return;
    }

    let currentKey = rootKey;

    for (const segment of pathSegments) {
      updateNodes((current) => {
        const node = current[currentKey];
        if (!node || node.isExpanded) {
          return current;
        }

        return {
          ...current,
          [currentKey]: {
            ...node,
            isExpanded: true,
          },
        };
      });

      const currentNode = nodesRef.current[currentKey];
      const childNodes = await waitForChildrenLoaded(currentKey);

      trace.push(
        `segment="${segment}" parent="${currentNode?.path || currentKey}" childCount=${childNodes.length} children=[${summarizeChildNames(childNodes)}]`
      );

      let match = childNodes.find((child) => child.name === segment) || null;
      if (!match) {
        const normalizedSegment = normalizePathSegment(segment);
        match = childNodes.find((child) => normalizePathSegment(child.name) === normalizedSegment) || null;
      }

      if (!match) {
        setErrorMessage(`Unable to locate folder segment "${segment}" in ${ROOT_LABEL[row.provider]}.`);
        console.warn('Folder reveal path resolution failed', {
          provider: row.provider,
          key: row.key,
          id: row.id,
          path: row.path,
          failedSegment: segment,
          trace,
        });
        return;
      }

      currentKey = match.key;
    }

    revealNode(currentKey);
  }, [loadChildren, rootKeys, updateNodes]);

  useEffect(() => {
    for (const row of Object.values(selected)) {
      if (row.provider !== 'google' || row.id === 'root' || row.sizeKnown) {
        continue;
      }

      if (inFlightSizeReadsRef.current[row.key]) {
        continue;
      }

      const session = sessions.google;
      if (!session) {
        continue;
      }

      const readPromise = (async () => {
        try {
          const computedSize = await readFolderSizeForSession(session, row.id);
          setSelected((current) => {
            const existing = current[row.key];
            if (!existing) {
              return current;
            }

            return {
              ...current,
              [row.key]: {
                ...existing,
                sizeBytes: Math.max(0, Math.floor(computedSize)),
                sizeKnown: true,
              },
            };
          });
        } catch {
          // Keep unknown size blank if compute fails.
        } finally {
          delete inFlightSizeReadsRef.current[row.key];
        }
      })();

      inFlightSizeReadsRef.current[row.key] = readPromise;
    }
  }, [selected, sessions]);

  return (
    <section className="cloud-folder-picker" aria-label="Cloud folder picker">
      <div className="cloud-folder-picker-header">
        <div>
          <div className="fw-semibold">File Sync</div>
          <div className="small text-body-secondary">Select folders to allow for sync across connected providers.</div>
        </div>
        <div className="cloud-folder-picker-header-actions d-flex gap-2">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={!isDirty}
            onClick={handleCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!isDirty}
            onClick={handleApply}
          >
            Apply
          </button>
        </div>
      </div>

      <div ref={layoutRef} className="cloud-folder-picker-layout">
        <div className="cloud-folder-picker-left" style={{ flexBasis: `${splitPercent}%` }}>
          {loadingRoots && <p className="small text-body-secondary mb-0">Loading folder roots...</p>}

          {!loadingRoots && rootKeys.length === 0 && (
            <p className="small text-body-secondary mb-0">No connected folder providers found.</p>
          )}

          {!loadingRoots && visibleNodes.length > 0 && (
            <ul className="cloud-folder-tree-list">
              {visibleNodes.map(({ key, depth }) => {
                const node = nodes[key];
                if (!node) {
                  return null;
                }

                const directSelected = Boolean(selected[key]);
                const ancestorSelected = hasSelectedAncestor(key, selected, nodes);
                const checked = directSelected || ancestorSelected;
                const providerAvailable = providerSyncFilesEnabled[node.provider] && Boolean(sessions[node.provider]);
                const disabled = ancestorSelected || !providerAvailable;
                const isRoot = node.id === 'root';
                const providerSyncFilesEnabledForNode = providerSyncFilesEnabled[node.provider];
                const providerConnectedForNode = Boolean(sessions[node.provider]);

                return (
                  <li key={key}>
                    <div
                      ref={(entry) => {
                        if (isRoot) {
                          rootRowRefs.current[node.provider] = entry;
                        }
                        nodeRefs.current[key] = entry;
                      }}
                      className={`cloud-folder-tree-row${highlightNodeKey === key ? ' is-highlighted' : ''}${isRoot && highlightServiceProvider === node.provider ? ' is-service-highlighted' : ''}`}
                      style={{ paddingLeft: `${depth * 0.55}rem` }}
                    >
                      {node.hasChildren ? (
                        <button
                          type="button"
                          className="cloud-folder-tree-chevron"
                          aria-label={node.isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
                          onClick={() => toggleExpanded(key)}
                        >
                          <i className={`fa-solid ${node.isExpanded ? 'fa-chevron-down' : 'fa-chevron-right'}`} aria-hidden="true"></i>
                        </button>
                      ) : (
                        <span className="cloud-folder-tree-chevron-spacer" aria-hidden="true"></span>
                      )}

                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggleSelected(key)}
                        aria-label={node.path}
                      />

                      <div className="cloud-folder-tree-name-wrap">
                        <button
                          type="button"
                          className={`cloud-folder-tree-name${isRoot && highlightServiceProvider === node.provider ? ' is-highlighted' : ''}`}
                          onClick={() => node.hasChildren && toggleExpanded(key)}
                        >
                          {node.name}
                        </button>
                        {isRoot && (!providerSyncFilesEnabledForNode || !providerConnectedForNode) && (
                          <button
                            type="button"
                            className="btn btn-link btn-sm cloud-folder-tree-connect-link"
                            onClick={() => onConnectRequested(node.provider)}
                          >
                            Connect
                          </button>
                        )}
                      </div>

                      <span className="cloud-folder-tree-size">
                        {formatFolderSize(node.sizeBytes, {
                          provider: node.provider,
                          isRoot: node.id === 'root',
                          sizeKnown: !(node.provider === 'google' && node.id !== 'root' && node.sizeBytes === 0),
                        })}
                      </span>
                    </div>

                    {node.isLoading && (
                      <div className="small text-body-secondary cloud-folder-tree-loading">Loading...</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <WorkspaceDivider
          orientation="vertical"
          onPointerDown={handleDividerPointerDown}
          onKeyDown={handleDividerKeyDown}
        />

        <div className="cloud-folder-picker-right" style={{ flexBasis: `${selectedPanePercent}%` }}>
          <div className="table-responsive">
            <table className="table table-sm align-middle mb-0 cloud-folder-selected-table">
              <thead>
                <tr>
                  <th scope="col" className="cloud-folder-selected-remove-col"></th>
                  <th scope="col">Folder</th>
                  <th scope="col" className="text-end text-nowrap">Size</th>
                </tr>
              </thead>
              <tbody>
                {selectedRows.length === 0 && (
                  <tr>
                    <td colSpan={3} className="text-body-secondary">No folders selected yet.</td>
                  </tr>
                )}
                {selectedRows.map((row) => (
                  <tr key={row.key}>
                    <td>
                      {(!providerSyncFilesEnabled[row.provider] || !sessions[row.provider]) ? (
                        <button
                          type="button"
                          className="btn btn-link btn-sm p-0 cloud-folder-selected-reconnect"
                          aria-label={`Reconnect ${row.provider === 'google' ? 'Google' : 'Microsoft'} for ${row.path}`}
                          onClick={() => onConnectRequested(row.provider)}
                        >
                          Reconnect
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-link btn-sm p-0 cloud-folder-selected-remove"
                          title="Stop syncing folder"
                          aria-label={`Stop syncing ${row.path}`}
                          onClick={() => {
                            setSelected((current) => {
                              const next = { ...current };
                              delete next[row.key];
                              return next;
                            });
                          }}
                        >
                          <span className="fa-stack fa-lg">
                            <i className="fa-solid fa-arrows-rotate fa-stack-1x"></i>
                            <i className="fa-solid fa-slash fa-stack-1x"></i>
                          </span>
                        </button>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className={`btn btn-link btn-sm p-0 text-start cloud-folder-selected-path${(!providerSyncFilesEnabled[row.provider] || !sessions[row.provider]) ? ' is-disabled' : ''}`}
                        disabled={!providerSyncFilesEnabled[row.provider] || !sessions[row.provider]}
                        onClick={() => {
                          void revealPath(row);
                        }}
                      >
                        {row.path}
                      </button>
                    </td>
                    <td className="text-end text-nowrap text-body-secondary">
                      {formatFolderSize(row.sizeBytes, {
                        provider: row.provider,
                        isRoot: row.id === 'root',
                        sizeKnown: row.sizeKnown,
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {errorMessage && <p className="small text-danger mb-0">{errorMessage}</p>}
    </section>
  );
};

export default CloudFolderPicker;
