import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { FederatedProvider } from '../models/bible';
import type { FederatedSession } from '../services/federatedAuthService';
import {
  listFolderChildrenForSession,
  computeSupportedFolderSizeForSession,
} from '../services/cloudConfigProviderService';
import { getMarkupFileIcon } from '../utils/supportedMarkupFileTypes';
import { useHorizontalSplit } from '../hooks/useHorizontalSplit';
import WorkspaceDivider from './WorkspaceDivider';
import FileSyncTagModal from './FileSyncTagModal';
import { getStoredResourceTagColors } from '../utils/resourceTagColors';

const ROOT_LABEL: Record<FederatedProvider, string> = {
  google: 'Google Drive',
  microsoft: 'OneDrive',
};

// Group key for the right panel's top-level accordion (only one selected root expanded at a time).
const RIGHT_PANEL_TOP_LEVEL_GROUP = '__root__';

export interface FolderSelectionTarget {
  id: string;
  kind: 'folder';
  name?: string;
  path?: string;
  sizeBytes?: number;
  sizeKnown?: boolean;
  // Microsoft shared/remote folder drive id; required to list the folder via /drives/{driveId}/items/{id}.
  driveId?: string;
  // Cloud item IDs (folders or files, any depth) explicitly excluded from sync within this selection.
  excludedItemIds?: string[];
  // Tags assigned to this root selection item itself.
  tags?: string[];
  // Tags for nested items (any depth) within this selection, keyed by cloud item id.
  itemTags?: Record<string, string[]>;
  // Inherited tags explicitly cancelled for a nested item (any depth), keyed by cloud item id.
  itemTagExclusions?: Record<string, string[]>;
}

interface CloudFolderPickerProps {
  sessions: Record<FederatedProvider, FederatedSession | null>;
  initialSelections: Record<FederatedProvider, FolderSelectionTarget[]>;
  providerSyncFilesEnabled: Record<FederatedProvider, boolean>;
  linkedProviders: Record<FederatedProvider, boolean>;
  focusRequest: { provider: FederatedProvider; requestId: number } | null;
  onSelectionsChange: (next: Record<FederatedProvider, FolderSelectionTarget[]>) => void;
  onConnectRequested: (provider: FederatedProvider) => void;
  onDirtyChange?: (isDirty: boolean) => void;
  ref?: React.Ref<CloudFolderPickerHandle>;
}

export interface CloudFolderPickerHandle {
  apply: () => void;
  cancel: () => void;
}

interface FolderTreeNode {
  key: string;
  provider: FederatedProvider;
  id: string;
  kind: 'file' | 'folder';
  name: string;
  path: string;
  sizeBytes: number;
  sizeKnown: boolean;
  hasChildren: boolean;
  /** Microsoft shared/remote folder drive id for Graph /drives/{id}/items/... listing. */
  driveId?: string;
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
  driveId?: string;
  excludedItemIds: Set<string>;
  tags: string[];
  itemTags: Map<string, string[]>;
  itemTagExclusions: Map<string, string[]>;
}

interface VisibleNode {
  key: string;
  depth: number;
}

interface RightVisibleRow {
  key: string;
  depth: number;
  isRootSelection: boolean;
  rootSelectionKey: string;
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

function formatFolderSize(sizeBytes: number, sizeKnown: boolean): string {
  if (!sizeKnown) {
    return '';
  }

  const bytes = Number.isFinite(sizeBytes) ? Math.max(0, sizeBytes) : 0;
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

function toSelectionPayload(
  selectedRows: SelectedFolder[],
  nodes: Record<string, FolderTreeNode>
): Record<FederatedProvider, FolderSelectionTarget[]> {
  const next: Record<FederatedProvider, FolderSelectionTarget[]> = {
    google: [],
    microsoft: [],
  };

  for (const row of selectedRows) {
    const node = nodes[row.key];
    const itemTagsRecord = Array.from(row.itemTags.entries())
      .filter(([, tags]) => tags.length > 0)
      .sort(([leftId], [rightId]) => leftId.localeCompare(rightId));
    const itemTagExclusionsRecord = Array.from(row.itemTagExclusions.entries())
      .filter(([, tags]) => tags.length > 0)
      .sort(([leftId], [rightId]) => leftId.localeCompare(rightId));

    next[row.provider].push({
      id: row.id,
      kind: 'folder',
      name: row.name,
      path: row.path,
      sizeBytes: node?.sizeKnown ? node.sizeBytes : undefined,
      sizeKnown: node?.sizeKnown ?? false,
      driveId: row.driveId ?? node?.driveId,
      excludedItemIds: row.excludedItemIds.size > 0 ? Array.from(row.excludedItemIds).sort() : undefined,
      tags: row.tags.length > 0 ? [...row.tags].sort() : undefined,
      itemTags: itemTagsRecord.length > 0 ? Object.fromEntries(itemTagsRecord.map(([id, tags]) => [id, [...tags].sort()])) : undefined,
      itemTagExclusions: itemTagExclusionsRecord.length > 0
        ? Object.fromEntries(itemTagExclusionsRecord.map(([id, tags]) => [id, [...tags].sort()]))
        : undefined,
    });
  }

  return next;
}

function normalizeSelectionPayload(
  payload: Record<FederatedProvider, FolderSelectionTarget[]>
): Record<FederatedProvider, FolderSelectionTarget[]> {
  const normalizeProviderTargets = (targets: FolderSelectionTarget[]): FolderSelectionTarget[] => {
    return [...targets]
      .map((target) => ({
        id: target.id,
        kind: target.kind,
        name: target.name,
        path: target.path,
        excludedItemIds: [...(target.excludedItemIds || [])].sort(),
        tags: [...(target.tags || [])].sort(),
        itemTags: Object.fromEntries(
          Object.entries(target.itemTags || {})
            .map(([id, tags]) => [id, [...tags].sort()] as const)
            .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
        ),
        itemTagExclusions: Object.fromEntries(
          Object.entries(target.itemTagExclusions || {})
            .map(([id, tags]) => [id, [...tags].sort()] as const)
            .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
        ),
      }))
      .sort((left, right) => {
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
  // Size fields are recomputed live on every load and intentionally excluded from the dirty check
  // (normalizeSelectionPayload strips them) so async size loads never flip the Apply/Cancel state.
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

// Walks from a descendant node up to (but not including) its selected root, checking whether
// any ancestor along the way was explicitly excluded from sync.
function hasExcludedAncestor(
  nodeKey: string,
  rootSelectionKey: string,
  rootSelection: SelectedFolder,
  nodes: Record<string, FolderTreeNode>
): boolean {
  let cursor = nodes[nodeKey]?.parentKey ?? null;
  while (cursor && cursor !== rootSelectionKey) {
    const ancestor = nodes[cursor];
    if (!ancestor) {
      return false;
    }

    if (rootSelection.excludedItemIds.has(ancestor.id)) {
      return true;
    }

    cursor = ancestor.parentKey;
  }

  return false;
}

// Computes the tags visible on a row: the root selection's own tags plus every ancestor's own
// tags down to (and including) this item, minus any tag explicitly excluded along that chain.
// Only the item that owns a tag (or an exclusion) actually persists it; everything else here is derived.
function computeEffectiveTags(
  nodeKey: string,
  rootSelectionKey: string,
  rootSelection: SelectedFolder,
  nodes: Record<string, FolderTreeNode>,
  isRootSelection: boolean
): { effectiveTags: string[]; ownTags: string[] } {
  if (isRootSelection) {
    return { effectiveTags: [...rootSelection.tags], ownTags: [...rootSelection.tags] };
  }

  const chain: string[] = [];
  let cursor: FolderTreeNode | undefined = nodes[nodeKey];
  while (cursor && cursor.key !== rootSelectionKey) {
    chain.unshift(cursor.id);
    cursor = cursor.parentKey ? nodes[cursor.parentKey] : undefined;
  }

  const effective = new Set(rootSelection.tags);
  for (const id of chain) {
    for (const tag of rootSelection.itemTags.get(id) ?? []) {
      effective.add(tag);
    }
    for (const tag of rootSelection.itemTagExclusions.get(id) ?? []) {
      effective.delete(tag);
    }
  }

  const targetId = nodes[nodeKey]?.id ?? '';
  return { effectiveTags: Array.from(effective), ownTags: [...(rootSelection.itemTags.get(targetId) ?? [])] };
}

interface UntaggedSelectionHit {
  key: string;
  rootSelectionKey: string;
  // Ancestor node keys from the root selection down to (but not including) the untagged node.
  // Used to expand the right-panel accordion so the row is visible before scrolling.
  ancestorKeys: string[];
}

function isNodeTaggable(
  nodeKey: string,
  rootSelectionKey: string,
  rootSelection: SelectedFolder,
  nodes: Record<string, FolderTreeNode>,
  providerAvailable: boolean
): boolean {
  const node = nodes[nodeKey];
  if (!node || !providerAvailable) {
    return false;
  }

  const isRootSelection = nodeKey === rootSelectionKey;
  if (isRootSelection) {
    return true;
  }

  if (rootSelection.excludedItemIds.has(node.id) || hasExcludedAncestor(nodeKey, rootSelectionKey, rootSelection, nodes)) {
    return false;
  }

  if (node.kind === 'folder') {
    return true;
  }

  return Boolean(getMarkupFileIcon(node.name)?.supported);
}

// Prefers root selections, then depth-first among already-loaded descendants. Nested items that
// inherit tags from an ancestor count as tagged; items that exclude every inherited tag do not.
function findFirstUntaggedSelection(
  selectedRows: SelectedFolder[],
  nodes: Record<string, FolderTreeNode>,
  providerSyncFilesEnabled: Record<FederatedProvider, boolean>,
  sessions: Record<FederatedProvider, FederatedSession | null>
): UntaggedSelectionHit | null {
  const walk = (
    nodeKey: string,
    rootSelectionKey: string,
    rootSelection: SelectedFolder,
    ancestorKeys: string[]
  ): UntaggedSelectionHit | null => {
    const node = nodes[nodeKey];
    if (!node) {
      return null;
    }

    const providerAvailable = providerSyncFilesEnabled[node.provider] && Boolean(sessions[node.provider]);
    if (isNodeTaggable(nodeKey, rootSelectionKey, rootSelection, nodes, providerAvailable)) {
      const { effectiveTags } = computeEffectiveTags(
        nodeKey,
        rootSelectionKey,
        rootSelection,
        nodes,
        nodeKey === rootSelectionKey
      );
      if (effectiveTags.length === 0) {
        return { key: nodeKey, rootSelectionKey, ancestorKeys };
      }
    }

    if (node.kind === 'folder' && node.childrenLoaded) {
      for (const childKey of node.childKeys) {
        const found = walk(childKey, rootSelectionKey, rootSelection, [...ancestorKeys, nodeKey]);
        if (found) {
          return found;
        }
      }
    }

    return null;
  };

  for (const row of selectedRows) {
    const found = walk(row.key, row.key, row, []);
    if (found) {
      return found;
    }
  }

  return null;
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
        driveId: target.driveId,
        excludedItemIds: new Set(target.excludedItemIds || []),
        tags: [...(target.tags || [])],
        itemTags: new Map(Object.entries(target.itemTags || {}).map(([id, tags]) => [id, [...tags]])),
        itemTagExclusions: new Map(Object.entries(target.itemTagExclusions || {}).map(([id, tags]) => [id, [...tags]])),
      };
    }
  }

  return nextSelected;
}

const FileSyncTagRowTags: React.FC<{
  effectiveTags: string[];
  ownTags: string[];
  tagColors: Map<string, string>;
  flashAddButton?: boolean;
  onAdd: (event: React.MouseEvent) => void;
  onEditOwn: (event: React.MouseEvent) => void;
  onFlashEnd?: () => void;
}> = ({ effectiveTags, ownTags, tagColors, flashAddButton = false, onAdd, onEditOwn, onFlashEnd }) => {
  const ownTagSet = new Set(ownTags);

  return (
    <>
      {effectiveTags.map((tag) => {
        const color = tagColors.get(tag) ?? '#6c757d';
        const isOwn = ownTagSet.has(tag);
        const style = { ['--resource-tag-color' as '--resource-tag-color']: color } as React.CSSProperties;

        return (
          <button
            key={tag}
            type="button"
            className={`cloud-folder-tag-chip${isOwn ? '' : ' is-inherited'}`}
            style={style}
            title={isOwn ? tag : `${tag} (inherited)`}
            onClick={onEditOwn}
          >
            {tag}
          </button>
        );
      })}
      <button
        type="button"
        className={`btn btn-outline-secondary btn-sm cloud-folder-tag-add-btn${flashAddButton ? ' is-flashing' : ''}`}
        onClick={onAdd}
        onAnimationEnd={flashAddButton ? onFlashEnd : undefined}
      >
        {effectiveTags.length === 0 ? '+ Tags' : '+'}
      </button>
    </>
  );
};

const CloudFolderPicker: React.FC<CloudFolderPickerProps> = ({
  sessions,
  initialSelections,
  providerSyncFilesEnabled,
  linkedProviders,
  focusRequest,
  onSelectionsChange,
  onConnectRequested,
  onDirtyChange,
  ref,
}) => {
  const [loadingRoots, setLoadingRoots] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [rootKeys, setRootKeys] = useState<string[]>([]);
  const [nodes, setNodes] = useState<Record<string, FolderTreeNode>>({});
  const [selected, setSelected] = useState<Record<string, SelectedFolder>>({});
  const [highlightNodeKey, setHighlightNodeKey] = useState<string | null>(null);
  const [highlightServiceProvider, setHighlightServiceProvider] = useState<FederatedProvider | null>(null);
  const [rightExpandedKeyByParent, setRightExpandedKeyByParent] = useState<Record<string, string | null>>({});
  const [tagColors, setTagColors] = useState<Map<string, string>>(() => getStoredResourceTagColors());
  const [flashTagAddKey, setFlashTagAddKey] = useState<string | null>(null);
  const [tagModalTarget, setTagModalTarget] = useState<{
    rootSelectionKey: string;
    itemId: string | null;
    itemKey: string;
    itemLabel: string;
    currentTags: string[];
    ownTags: string[];
  } | null>(null);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const nodesRef = useRef<Record<string, FolderTreeNode>>({});
  const inFlightLoadsRef = useRef<Record<string, Promise<FolderTreeNode[]>>>({});
  const inFlightFolderSizeReadsRef = useRef<Partial<Record<string, Promise<void>>>>({});
  const nodeRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const selectedRowRefs = useRef<Record<string, HTMLDivElement | null>>({});
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

  const loadChildren = useCallback(async (
    nodeKey: string,
    options?: { checkSubfolders?: boolean }
  ): Promise<FolderTreeNode[]> => {
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
      setErrorMessage(`Connect ${ROOT_LABEL[node.provider]} to browse folders.`);
      return [];
    }

    updateNodes((current) => ({
      ...current,
      [nodeKey]: {
        ...current[nodeKey],
        isLoading: true,
      },
    }));

    const checkSubfolders = options?.checkSubfolders ?? false;

    const loadPromise = (async () => {
      try {
        const children = await listFolderChildrenForSession(session, node.id, node.driveId);
        // Subfolders are listed before files within a folder.
        const sortedChildren = [...children].sort((left, right) => {
          if (left.kind === right.kind) {
            return 0;
          }

          return left.kind === 'folder' ? -1 : 1;
        });

        // The left panel only ever navigates folders, so its chevron should only appear when a
        // subfolder actually has its own subfolders (checked one level ahead), instead of guessing.
        let subfolderPresenceById: Record<string, boolean> | null = null;
        if (checkSubfolders) {
          const folderChildren = sortedChildren.filter((child) => child.kind === 'folder');
          const checks = await Promise.all(folderChildren.map(async (child) => {
            try {
              const grandchildren = await listFolderChildrenForSession(session, child.id, child.driveId);
              return [child.id, grandchildren.some((entry) => entry.kind === 'folder')] as const;
            } catch {
              return [child.id, child.hasChildren] as const;
            }
          }));
          subfolderPresenceById = Object.fromEntries(checks);
        }

        const nextChildren: FolderTreeNode[] = [];
        updateNodes((current) => {
          const parent = current[nodeKey];
          if (!parent) {
            return current;
          }

          const next = { ...current };
          const childKeys: string[] = [];

          for (const child of sortedChildren) {
            const childKey = makeNodeKey(parent.provider, child.id);
            childKeys.push(childKey);

            const hasChildren = child.kind === 'folder'
              ? subfolderPresenceById?.[child.id] ?? child.hasChildren
              : false;

            const existingChild = next[childKey];
            next[childKey] = {
              key: childKey,
              provider: parent.provider,
              id: child.id,
              kind: child.kind,
              name: child.name,
              path: `${parent.path}/${child.name}`,
              sizeBytes: child.sizeBytes,
              sizeKnown: existingChild?.sizeKnown ?? child.kind === 'file',
              hasChildren,
              driveId: child.driveId,
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

      const rootEntries = allProviders.map((provider) => {
        const key = makeNodeKey(provider, 'root');

        return {
          key,
          provider,
          id: 'root',
          kind: 'folder',
          name: ROOT_LABEL[provider],
          path: ROOT_LABEL[provider],
          sizeBytes: 0,
          // Folder sizes are computed lazily (only once a folder row becomes visible in the right panel).
          sizeKnown: false,
          hasChildren: true,
          parentKey: null,
          childKeys: [],
          childrenLoaded: false,
          isExpanded: false,
          isLoading: false,
        } satisfies FolderTreeNode;
      });

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

      // Synthesize a placeholder node for each persisted selection so it renders in the right
      // panel immediately, without requiring the left panel to be browsed down to that folder first.
      for (const selection of Object.values(initialSelected)) {
        if (nextNodes[selection.key]) {
          continue;
        }

        nextNodes[selection.key] = {
          key: selection.key,
          provider: selection.provider,
          id: selection.id,
          kind: 'folder',
          name: selection.name,
          path: selection.path,
          sizeBytes: 0,
          sizeKnown: false,
          hasChildren: true,
          driveId: selection.driveId,
          parentKey: null,
          childKeys: [],
          childrenLoaded: false,
          isExpanded: false,
          isLoading: false,
        };
      }

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
      // The left panel only ever shows folders.
      if (!node || node.kind !== 'folder') {
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
      void loadChildren(key, { checkSubfolders: true });
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
        driveId: node.driveId,
        excludedItemIds: new Set<string>(),
        tags: [],
        itemTags: new Map<string, string[]>(),
        itemTagExclusions: new Map<string, string[]>(),
      };

      return next;
    });
  }, [nodes]);

  const isDirty = useMemo(() => {
    if (!hasBootstrappedSelectionsRef.current) {
      return false;
    }

    return !areSelectionPayloadsEqual(toSelectionPayload(selectedRows, nodes), initialSelections);
  }, [initialSelections, nodes, selectedRows]);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const handleApply = useCallback(() => {
    const untagged = findFirstUntaggedSelection(selectedRows, nodes, providerSyncFilesEnabled, sessions);
    if (untagged) {
      window.alert('You must supply tags for all files before saving.');

      setRightExpandedKeyByParent((current) => {
        if (untagged.key === untagged.rootSelectionKey) {
          return current;
        }

        const next = { ...current, [RIGHT_PANEL_TOP_LEVEL_GROUP]: untagged.rootSelectionKey };
        for (let index = 1; index < untagged.ancestorKeys.length; index += 1) {
          next[untagged.ancestorKeys[index - 1]] = untagged.ancestorKeys[index];
        }
        return next;
      });

      setFlashTagAddKey(untagged.key);
      window.setTimeout(() => {
        selectedRowRefs.current[untagged.key]?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      }, 30);
      return;
    }

    setErrorMessage(null);
    onSelectionsChange(toSelectionPayload(selectedRows, nodes));
  }, [nodes, onSelectionsChange, providerSyncFilesEnabled, selectedRows, sessions]);

  const handleCancel = useCallback(() => {
    setSelected(buildSelectedMapFromPayload(initialSelectionsRef.current));
  }, []);

  useImperativeHandle(ref, () => ({
    apply: handleApply,
    cancel: handleCancel,
  }), [handleApply, handleCancel]);

  const revealPath = useCallback(async (row: { key: string; provider: FederatedProvider; path: string }) => {
    const trace: string[] = [];

    const waitForChildrenLoaded = async (nodeKey: string): Promise<FolderTreeNode[]> => {
      const deadline = Date.now() + 12_000;

      while (Date.now() < deadline) {
        const node = nodesRef.current[nodeKey];
        if (!node) {
          return [];
        }

        if (!node.childrenLoaded && !node.isLoading) {
          await loadChildren(nodeKey, { checkSubfolders: true });
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

    // Only take the fast path for nodes whose ancestor chain is actually known (real root, or
    // discovered via left-panel browsing). Selections restored from persisted config but never
    // browsed to yet have no known parent chain, so fall through to path-based resolution below.
    const existingNode = nodesRef.current[row.key];
    if (existingNode && (existingNode.id === 'root' || existingNode.parentKey !== null)) {
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

  const toggleRightExpanded = useCallback((groupKey: string, childKey: string) => {
    setRightExpandedKeyByParent((current) => {
      const next = { ...current };
      if (current[groupKey] === childKey) {
        delete next[groupKey];
      } else {
        next[groupKey] = childKey;
      }

      return next;
    });

    const node = nodesRef.current[childKey];
    if (node && !node.childrenLoaded) {
      void loadChildren(childKey);
    }
  }, [loadChildren]);

  const toggleExcluded = useCallback((rootSelectionKey: string, itemId: string) => {
    setSelected((current) => {
      const existing = current[rootSelectionKey];
      if (!existing) {
        return current;
      }

      const nextExcluded = new Set(existing.excludedItemIds);
      if (nextExcluded.has(itemId)) {
        nextExcluded.delete(itemId);
      } else {
        nextExcluded.add(itemId);
      }

      return {
        ...current,
        [rootSelectionKey]: {
          ...existing,
          excludedItemIds: nextExcluded,
        },
      };
    });
  }, []);

  const updateItemTags = useCallback((rootSelectionKey: string, itemId: string | null, nextTags: string[]) => {
    setSelected((current) => {
      const existing = current[rootSelectionKey];
      if (!existing) {
        return current;
      }

      if (itemId === null) {
        return {
          ...current,
          [rootSelectionKey]: {
            ...existing,
            tags: nextTags,
          },
        };
      }

      const nextItemTags = new Map(existing.itemTags);
      if (nextTags.length > 0) {
        nextItemTags.set(itemId, nextTags);
      } else {
        nextItemTags.delete(itemId);
      }

      return {
        ...current,
        [rootSelectionKey]: {
          ...existing,
          itemTags: nextItemTags,
        },
      };
    });
  }, []);

  const excludeInheritedTag = useCallback((rootSelectionKey: string, itemId: string, tag: string) => {
    setSelected((current) => {
      const existing = current[rootSelectionKey];
      if (!existing) {
        return current;
      }

      const nextExclusions = new Map(existing.itemTagExclusions);
      const currentExclusions = new Set(nextExclusions.get(itemId) ?? []);
      currentExclusions.add(tag);
      nextExclusions.set(itemId, Array.from(currentExclusions));

      return {
        ...current,
        [rootSelectionKey]: {
          ...existing,
          itemTagExclusions: nextExclusions,
        },
      };
    });
  }, []);

  const rightVisibleRows = useMemo<RightVisibleRow[]>(() => {
    const rows: RightVisibleRow[] = [];

    const walkChildren = (parentNode: FolderTreeNode, depth: number, rootSelectionKey: string) => {
      const expandedChildKey = rightExpandedKeyByParent[parentNode.key] ?? null;
      for (const childKey of parentNode.childKeys) {
        const child = nodes[childKey];
        if (!child) {
          continue;
        }

        rows.push({ key: childKey, depth, isRootSelection: false, rootSelectionKey });
        if (child.kind === 'folder' && expandedChildKey === childKey) {
          walkChildren(child, depth + 1, rootSelectionKey);
        }
      }
    };

    const expandedRootKey = rightExpandedKeyByParent[RIGHT_PANEL_TOP_LEVEL_GROUP] ?? null;
    for (const row of selectedRows) {
      const node = nodes[row.key];
      if (!node) {
        continue;
      }

      rows.push({ key: row.key, depth: 0, isRootSelection: true, rootSelectionKey: row.key });
      if (expandedRootKey === row.key) {
        walkChildren(node, 1, row.key);
      }
    }

    return rows;
  }, [nodes, rightExpandedKeyByParent, selectedRows]);

  useEffect(() => {
    for (const visibleRow of rightVisibleRows) {
      const node = nodesRef.current[visibleRow.key];
      if (!node || node.kind !== 'folder' || node.sizeKnown) {
        continue;
      }

      if (inFlightFolderSizeReadsRef.current[visibleRow.key]) {
        continue;
      }

      const session = sessions[node.provider];
      if (!session) {
        continue;
      }

      const readPromise = (async () => {
        try {
          const computedSize = await computeSupportedFolderSizeForSession(session, node.id, node.driveId);
          updateNodes((current) => {
            const existing = current[visibleRow.key];
            if (!existing) {
              return current;
            }

            return {
              ...current,
              [visibleRow.key]: {
                ...existing,
                sizeBytes: Math.max(0, Math.floor(computedSize)),
                sizeKnown: true,
              },
            };
          });
        } catch {
          // Keep unknown size blank if compute fails.
        } finally {
          delete inFlightFolderSizeReadsRef.current[visibleRow.key];
        }
      })();

      inFlightFolderSizeReadsRef.current[visibleRow.key] = readPromise;
    }
  }, [rightVisibleRows, sessions, updateNodes]);

  return (
    <section className="cloud-folder-picker" aria-label="File Sync">
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
                const rootLinkLabel = linkedProviders[node.provider] ? 'Manage' : 'Connect';

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
                          disabled={disabled}
                          onClick={() => toggleSelected(key)}
                        >
                          {node.name}
                        </button>
                        {isRoot && (
                          <button
                            type="button"
                            className="btn btn-link btn-sm cloud-folder-tree-connect-link"
                            aria-label={`${rootLinkLabel} ${ROOT_LABEL[node.provider]}`}
                            onClick={() => onConnectRequested(node.provider)}
                          >
                            {rootLinkLabel}
                          </button>
                        )}
                      </div>
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
          <div className="cloud-folder-selected-header">
            <span className="cloud-folder-selected-header-name">Selected Files & Folders</span>
            <span className="cloud-folder-selected-header-size text-end" title="Shows file sync size and status. Unsupported file types are excluded.">Synchronization</span>
          </div>

          {selectedRows.length === 0 && (
            <p className="small text-body-secondary mb-0">No folders selected yet.</p>
          )}

          {selectedRows.length > 0 && (
            <ul className="cloud-folder-selected-list">
              {rightVisibleRows.map((visibleRow) => {
                const node = nodes[visibleRow.key];
                const rootSelection = selected[visibleRow.rootSelectionKey];
                if (!node || !rootSelection) {
                  return null;
                }

                const providerAvailable = providerSyncFilesEnabled[node.provider] && Boolean(sessions[node.provider]);
                const isFolder = node.kind === 'folder';
                // Once expanded, a folder that turned out to have no files/subfolders loses its chevron.
                const isEmptyFolder = isFolder && node.childrenLoaded && node.childKeys.length === 0;
                const showChevron = isFolder && !isEmptyFolder;
                const groupKey = visibleRow.isRootSelection ? RIGHT_PANEL_TOP_LEVEL_GROUP : node.parentKey || RIGHT_PANEL_TOP_LEVEL_GROUP;
                const isExpanded = rightExpandedKeyByParent[groupKey] === visibleRow.key;
                const fileIcon = isFolder ? null : getMarkupFileIcon(node.name);
                const isExcluded = !visibleRow.isRootSelection && rootSelection.excludedItemIds.has(node.id);
                const isCoveredByExcludedAncestor = !visibleRow.isRootSelection
                  && hasExcludedAncestor(visibleRow.key, visibleRow.rootSelectionKey, rootSelection, nodes);
                const canToggleSync = isFolder || Boolean(fileIcon?.supported);
                const displayLabel = (visibleRow.isRootSelection ? rootSelection.path : node.name).replace(/\//g, '/\u200B');
                const canActivateName = visibleRow.isRootSelection && showChevron;
                const isTaggable = visibleRow.isRootSelection
                  ? providerAvailable
                  : !isExcluded && !isCoveredByExcludedAncestor && canToggleSync && providerAvailable;
                const itemTagId = visibleRow.isRootSelection ? null : node.id;
                const { effectiveTags: effectiveItemTags, ownTags: ownItemTags } = computeEffectiveTags(
                  visibleRow.key,
                  visibleRow.rootSelectionKey,
                  rootSelection,
                  nodes,
                  visibleRow.isRootSelection
                );

                const handleNameActivate = () => {
                  if (!canActivateName) {
                    return;
                  }

                  toggleRightExpanded(groupKey, visibleRow.key);
                  void revealPath(rootSelection);
                };

                const handleOpenTagModal = (event: React.MouseEvent) => {
                  event.stopPropagation();
                  setTagModalTarget({
                    rootSelectionKey: visibleRow.rootSelectionKey,
                    itemId: itemTagId,
                    itemKey: visibleRow.key,
                    itemLabel: node.name,
                    currentTags: effectiveItemTags,
                    ownTags: ownItemTags,
                  });
                };

                return (
                  <li key={visibleRow.key}>
                    <div
                      ref={(entry) => {
                        selectedRowRefs.current[visibleRow.key] = entry;
                      }}
                      className={`cloud-folder-selected-row${canActivateName ? ' is-clickable' : ''}`}
                      style={{ paddingLeft: `${visibleRow.depth * 0.55}rem` }}
                      onClick={canActivateName ? handleNameActivate : undefined}
                    >
                      {showChevron ? (
                        <button
                          type="button"
                          className="cloud-folder-tree-chevron"
                          aria-label={isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleRightExpanded(groupKey, visibleRow.key);
                          }}
                        >
                          <i className={`fa-solid ${isExpanded ? 'fa-chevron-down' : 'fa-chevron-right'}`} aria-hidden="true"></i>
                        </button>
                      ) : isFolder ? (
                        <span className="cloud-folder-tree-chevron-spacer" aria-hidden="true"></span>
                      ) : (
                        <span className={`cloud-folder-selected-file-icon${fileIcon?.supported ? '' : ' is-unsupported'}`} aria-hidden="true">
                          <i className={`fa-solid ${fileIcon?.icon}`}></i>
                        </span>
                      )}

                      {visibleRow.isRootSelection && (!providerSyncFilesEnabled[node.provider] || !sessions[node.provider]) ? (
                        <div className="cloud-folder-selected-name-wrap">
                          <button
                            type="button"
                            className="btn btn-link btn-sm p-0 text-start cloud-folder-selected-path is-disabled"
                            disabled
                          >
                            {displayLabel}
                          </button>
                        </div>
                      ) : canActivateName ? (
                        <div className="cloud-folder-selected-name-wrap">
                          <button
                            type="button"
                            className="btn btn-link btn-sm p-0 text-start cloud-folder-selected-path"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleNameActivate();
                            }}
                          >
                            {displayLabel}
                          </button>
                          {isTaggable && (
                            <FileSyncTagRowTags
                              effectiveTags={effectiveItemTags}
                              ownTags={ownItemTags}
                              tagColors={tagColors}
                              flashAddButton={flashTagAddKey === visibleRow.key}
                              onAdd={handleOpenTagModal}
                              onEditOwn={handleOpenTagModal}
                              onFlashEnd={() => {
                                setFlashTagAddKey((current) => (current === visibleRow.key ? null : current));
                              }}
                            />
                          )}
                        </div>
                      ) : (
                        <div className="cloud-folder-selected-name-wrap">
                          <span className={`cloud-folder-selected-name${!isFolder && !fileIcon?.supported ? ' is-unsupported' : ''}`}>
                            {displayLabel}
                          </span>
                          {isTaggable && (
                            <FileSyncTagRowTags
                              effectiveTags={effectiveItemTags}
                              ownTags={ownItemTags}
                              tagColors={tagColors}
                              flashAddButton={flashTagAddKey === visibleRow.key}
                              onAdd={handleOpenTagModal}
                              onEditOwn={handleOpenTagModal}
                              onFlashEnd={() => {
                                setFlashTagAddKey((current) => (current === visibleRow.key ? null : current));
                              }}
                            />
                          )}
                        </div>
                      )}

                      <span className="cloud-folder-selected-size text-end text-nowrap text-body-secondary">
                        {isFolder || fileIcon?.supported ? formatFolderSize(node.sizeBytes, node.sizeKnown) : ''}
                      </span>

                      <span className="cloud-folder-selected-action">
                        {visibleRow.isRootSelection && (!providerSyncFilesEnabled[node.provider] || !sessions[node.provider]) ? (
                          <button
                            type="button"
                            className="btn btn-link btn-sm p-0 cloud-folder-selected-reconnect"
                            aria-label={`Reconnect ${node.provider === 'google' ? 'Google' : 'Microsoft'} for ${node.path}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              onConnectRequested(node.provider);
                            }}
                          >
                            Reconnect
                          </button>
                        ) : visibleRow.isRootSelection ? (
                          <button
                            type="button"
                            className="btn btn-link btn-sm text-info p-0 cloud-folder-selected-remove"
                            title="Sync enabled. Click to stop syncing."
                            aria-label={`Stop syncing ${node.path}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelected((current) => {
                                const next = { ...current };
                                delete next[visibleRow.key];
                                return next;
                              });
                            }}
                          >
                            <i className="fa-solid fa-arrows-rotate"></i>
                          </button>
                        ) : canToggleSync && providerAvailable ? (
                          <button
                            type="button"
                            className={`btn btn-link btn-sm p-0 ${isExcluded ? 'cloud-folder-selected-restore text-warning' : 'cloud-folder-selected-remove text-info'}`}
                            style={isCoveredByExcludedAncestor ? { visibility: 'hidden' } : undefined}
                            title={isExcluded ? 'Sync disabled. Click to resume syncing' : 'Sync enabled. Click to exclude from syncing.'}
                            aria-label={isExcluded ? `Resume syncing ${node.path}` : `Exclude ${node.path} from sync`}
                            aria-hidden={isCoveredByExcludedAncestor}
                            disabled={isCoveredByExcludedAncestor}
                            tabIndex={isCoveredByExcludedAncestor ? -1 : undefined}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleExcluded(visibleRow.rootSelectionKey, node.id);
                            }}
                          >
                            <i className={`fa-solid ${isExcluded ? 'fa-upload' : 'fa-arrows-rotate'}`}></i>
                          </button>
                        ) : null}
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
      </div>

      {errorMessage && <p className="small text-danger mb-0">{errorMessage}</p>}

      {tagModalTarget && (
        <FileSyncTagModal
          itemLabel={tagModalTarget.itemLabel}
          initialTags={tagModalTarget.currentTags}
          onDone={(nextTags) => {
            const { rootSelectionKey, itemId, itemKey, currentTags, ownTags } = tagModalTarget;
            // Tags shown only because an ancestor owns them; deselecting one of these adds an
            // exclusion instead of trying to remove a tag this item never actually owned.
            const inheritedOnlyTags = currentTags.filter((tag) => !ownTags.includes(tag));
            const nextOwnTags = nextTags.filter((tag) => !inheritedOnlyTags.includes(tag));
            updateItemTags(rootSelectionKey, itemId, nextOwnTags);

            if (itemId) {
              const removedInheritedTags = inheritedOnlyTags.filter((tag) => !nextTags.includes(tag));
              for (const tag of removedInheritedTags) {
                excludeInheritedTag(rootSelectionKey, itemId, tag);
              }
            }

            // Flash only when the user just cleared the last effective tag — not when a newly
            // added folder starts empty (that path never goes through this modal callback).
            if (nextTags.length === 0 && currentTags.length > 0) {
              setFlashTagAddKey(itemKey);
            } else if (nextTags.length > 0) {
              setFlashTagAddKey((current) => (current === itemKey ? null : current));
            }

            setTagColors(getStoredResourceTagColors());
            setTagModalTarget(null);
          }}
          onClose={() => setTagModalTarget(null)}
        />
      )}
    </section>
  );
};

export default CloudFolderPicker;
