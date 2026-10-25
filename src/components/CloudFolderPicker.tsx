import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { FederatedProvider } from '../models/bible';
import type { FederatedSession } from '../services/federatedAuthService';
import {
  listFolderChildrenForSession,
  listSupportedFolderContentsForSession,
  type SupportedFolderFile,
} from '../services/cloudConfigProviderService';
import { getMarkupFileIcon, isSupportedMarkupFileName } from '../utils/supportedMarkupFileTypes';
import { useHorizontalSplit } from '../hooks/useHorizontalSplit';
import { useDesktopLayout } from '../hooks/useDesktopLayout';
import WorkspaceDivider from './WorkspaceDivider';
import FileSyncTagModal from './FileSyncTagModal';
import FileSyncTagRowTags from './FileSyncTagRowTags';
import SubscriptionsPanel, {
  libraryRowKey,
  visibleSubscriptionLibraries,
  type SubscriptionRevealTarget,
  type SubscriptionsPanelHandle,
} from './SubscriptionsPanel';
import SubscriptionConnectModal from './SubscriptionConnectModal';
import { useResourceTagColors } from '../hooks/useResourceTagColors';
import type { SubscriptionsBinding } from '../models/subscription';
import { findStarredTranslationBlock, useSubscriptionStaging } from '../hooks/useSubscriptionStaging';
import { showToast } from '../services/toastService';
import { formatAccountSyncApplyToast, type FolderApplyResult } from '../utils/syncToastMessages';
import { describeSyncFailure } from '../utils/syncFailureMessages';
import type { SyncPlanDocumentRef, SyncPlanLiveFile } from '../utils/syncPlanUsage';

const ROOT_LABEL: Record<FederatedProvider, string> = {
  google: 'Google Drive',
  microsoft: 'OneDrive',
};

/** Live selection snapshot for the Account Sync plan usage bar. */
export interface CloudFolderPickerUsageSnapshot {
  selectedBytes: number;
  /** True when every selected root has a known size (or there are no selections). */
  sizesReady: boolean;
  providersWithSelection: FederatedProvider[];
  stagedSelectedDocs: SyncPlanDocumentRef[];
  /** Applied file docs under roots that are still staged (for exclusion del preview). */
  appliedSelectedDocs: SyncPlanDocumentRef[];
  /** Full supported sizes of applied roots that were removed from the staged selection. */
  deselectedAppliedRootBytes: number[];
  /** Supported files under staged folders from the size walk (exclusions applied). */
  liveSelectedDocs: SyncPlanLiveFile[];
  /**
   * True when every reconnecting provider's staged folder has a completed file inventory,
   * or there is nothing to list for those providers.
   */
  membershipKnown: boolean;
}

// Group key for the right panel's top-level accordion (only one selected root expanded at a time).
const RIGHT_PANEL_TOP_LEVEL_GROUP = '__root__';

/** Mobile stacked File Sync panes — mutually exclusive; only one open at a time. */
type MobileSyncPane = 'providers' | 'files';

const SUBFOLDER_CHECK_CONCURRENCY = 3;

function hasAnyFolderSelection(selections: Record<FederatedProvider, FolderSelectionTarget[]>): boolean {
  return (Object.keys(ROOT_LABEL) as FederatedProvider[]).some((provider) => selections[provider].length > 0);
}

function describeLowVerseRatioRejection(subject: string): string {
  return `${subject} contains less than an average of one verse per page, and has been removed from your library.`;
}

export interface FolderSelectionTarget {
  id: string;
  kind: 'folder' | 'file';
  name?: string;
  path?: string;
  sizeBytes?: number;
  sizeKnown?: boolean;
  // Microsoft shared/remote folder drive id; required to list the folder via /drives/{driveId}/items/{id}.
  driveId?: string;
  // Cloud item IDs (folders or files, any depth) explicitly excluded from sync within this selection.
  excludedItemIds?: string[];
  // Nested files the user opted into after a folder-inherited skip (e.g. over 500 pages).
  includedItemIds?: string[];
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
  onSelectionsChange: (next: Record<FederatedProvider, FolderSelectionTarget[]>) => Promise<FolderApplyResult>;
  onConnectRequested: (provider: FederatedProvider) => void;
  onDirtyChange?: (isDirty: boolean) => void;
  onUsageSnapshotChange?: (snapshot: CloudFolderPickerUsageSnapshot) => void;
  // Providers signed back in whose restored selections have not been applied yet.
  reconnectPending?: Partial<Record<FederatedProvider, boolean>>;
  // Selected file ids MarkupServer kept out of the library for averaging under one verse per page.
  rejectedDocumentIds?: Partial<Record<FederatedProvider, ReadonlySet<string>>>;
  // Folder-inherited files skipped for page count; shown as unselected, not rejected.
  skippedDocumentIds?: Partial<Record<FederatedProvider, ReadonlySet<string>>>;
  // Selected files that failed to convert and are not indexed, keyed by cloud item id → raw error.
  failedDocuments?: Partial<Record<FederatedProvider, ReadonlyMap<string, string>>>;
  subscriptions?: SubscriptionsBinding;
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
  includedItemIds: Set<string>;
  tags: string[];
  itemTags: Map<string, string[]>;
  itemTagExclusions: Map<string, string[]>;
}

interface VisibleNode {
  key: string;
  depth: number;
}

interface SubfolderCheckRequest {
  key: string;
  session: FederatedSession;
  generation: number;
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
      kind: node?.kind === 'file' ? 'file' : 'folder',
      name: row.name,
      path: row.path,
      sizeBytes: node?.sizeKnown ? node.sizeBytes : undefined,
      sizeKnown: node?.sizeKnown ?? false,
      driveId: row.driveId ?? node?.driveId,
      excludedItemIds: row.excludedItemIds.size > 0 ? Array.from(row.excludedItemIds).sort() : undefined,
      includedItemIds: row.includedItemIds.size > 0 ? Array.from(row.includedItemIds).sort() : undefined,
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
        includedItemIds: [...(target.includedItemIds || [])].sort(),
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

function isNodeVisibleInTree(nodeKey: string, nodes: Record<string, FolderTreeNode>): boolean {
  let cursor = nodes[nodeKey];
  while (cursor?.parentKey) {
    cursor = nodes[cursor.parentKey];
    if (!cursor?.isExpanded) {
      return false;
    }
  }

  return cursor?.id === 'root';
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
      if (target.kind !== 'folder' && target.kind !== 'file') {
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
        includedItemIds: new Set(target.includedItemIds || []),
        tags: [...(target.tags || [])],
        itemTags: new Map(Object.entries(target.itemTags || {}).map(([id, tags]) => [id, [...tags]])),
        itemTagExclusions: new Map(Object.entries(target.itemTagExclusions || {}).map(([id, tags]) => [id, [...tags]])),
      };
    }
  }

  return nextSelected;
}

function collectFileDocsUnderSelection(
  root: SelectedFolder,
  nodes: Record<string, FolderTreeNode>,
  skippedIds?: ReadonlySet<string>
): SyncPlanDocumentRef[] {
  const docs: SyncPlanDocumentRef[] = [];
  const visit = (nodeKey: string) => {
    const node = nodes[nodeKey];
    if (!node) {
      return;
    }
    if (nodeKey !== root.key) {
      if (root.excludedItemIds.has(node.id) || hasExcludedAncestor(nodeKey, root.key, root, nodes)) {
        return;
      }
      if (!root.includedItemIds.has(node.id) && skippedIds?.has(node.id)) {
        return;
      }
    }
    if (node.kind === 'file' && isSupportedMarkupFileName(node.name)) {
      docs.push({
        documentId: node.id,
        hash: '',
        sizeBytes: node.sizeKnown ? node.sizeBytes : undefined,
        provider: root.provider,
      });
      return;
    }
    for (const childKey of node.childKeys) {
      visit(childKey);
    }
  };
  visit(root.key);
  return docs;
}

function resolveRootSizeBytes(
  provider: FederatedProvider,
  rootId: string,
  nodes: Record<string, FolderTreeNode>,
  appliedPayload: Record<FederatedProvider, FolderSelectionTarget[]>
): number {
  const key = makeNodeKey(provider, rootId);
  const node = nodes[key];
  if (node?.sizeKnown) {
    return Math.max(0, node.sizeBytes);
  }
  const target = (appliedPayload[provider] || []).find((entry) => entry.id === rootId);
  if (target?.sizeKnown && typeof target.sizeBytes === 'number') {
    return Math.max(0, Math.floor(target.sizeBytes));
  }
  return 0;
}

function isFileExcludedFromSelection(
  file: SupportedFolderFile,
  excludedItemIds: ReadonlySet<string>,
  includedItemIds: ReadonlySet<string> = new Set(),
  skippedIds?: ReadonlySet<string>
): boolean {
  if (excludedItemIds.has(file.id) || file.ancestorIds.some((ancestorId) => excludedItemIds.has(ancestorId))) {
    return true;
  }
  if (includedItemIds.has(file.id)) {
    return false;
  }
  return Boolean(skippedIds?.has(file.id));
}

function computeUsageSnapshot(
  selectedRows: SelectedFolder[],
  nodes: Record<string, FolderTreeNode>,
  appliedPayload: Record<FederatedProvider, FolderSelectionTarget[]>,
  folderContentsByRoot: Record<string, SupportedFolderFile[]>,
  reconnectPending?: Partial<Record<FederatedProvider, boolean>>,
  skippedDocumentIds?: Partial<Record<FederatedProvider, ReadonlySet<string>>>
): CloudFolderPickerUsageSnapshot {
  let selectedBytes = 0;
  let sizesReady = true;
  const providers = new Set<FederatedProvider>();
  const stagedSelectedDocs: SyncPlanDocumentRef[] = [];
  const stagedRootKeys = new Set(selectedRows.map((row) => row.key));
  const liveById = new Map<string, SyncPlanLiveFile>();

  for (const row of selectedRows) {
    providers.add(row.provider);
    const node = nodes[row.key];
    if (!node?.sizeKnown) {
      sizesReady = false;
    }
    let rootBytes = node?.sizeKnown ? Math.max(0, node.sizeBytes) : 0;
    const skippedIds = skippedDocumentIds?.[row.provider];
    for (const excludedId of row.excludedItemIds) {
      const excludedKey = makeNodeKey(row.provider, excludedId);
      const excludedNode = nodes[excludedKey];
      if (excludedNode?.sizeKnown) {
        rootBytes = Math.max(0, rootBytes - excludedNode.sizeBytes);
      }
    }
    if (skippedIds) {
      for (const skippedId of skippedIds) {
        if (row.includedItemIds.has(skippedId) || row.excludedItemIds.has(skippedId)) {
          continue;
        }
        const skippedKey = makeNodeKey(row.provider, skippedId);
        const skippedNode = nodes[skippedKey];
        if (skippedNode?.sizeKnown) {
          rootBytes = Math.max(0, rootBytes - skippedNode.sizeBytes);
        }
      }
    }
    selectedBytes += rootBytes;
    stagedSelectedDocs.push(...collectFileDocsUnderSelection(row, nodes, skippedIds));
    for (const file of folderContentsByRoot[row.key] ?? []) {
      if (isFileExcludedFromSelection(file, row.excludedItemIds, row.includedItemIds, skippedIds)) {
        continue;
      }
      liveById.set(file.id, {
        documentId: file.id,
        provider: row.provider,
        ...(file.lastModified ? { lastModified: file.lastModified } : {}),
      });
    }
  }

  const appliedSelected = buildSelectedMapFromPayload(appliedPayload);
  const appliedSelectedDocs: SyncPlanDocumentRef[] = [];
  const deselectedAppliedRootBytes: number[] = [];
  for (const row of Object.values(appliedSelected)) {
    if (!stagedRootKeys.has(row.key)) {
      const rootBytes = resolveRootSizeBytes(row.provider, row.id, nodes, appliedPayload);
      if (rootBytes > 0) {
        deselectedAppliedRootBytes.push(rootBytes);
      }
      continue;
    }
    // Still staged: per-file exclusion preview from loaded tree children.
    appliedSelectedDocs.push(...collectFileDocsUnderSelection(row, nodes, skippedDocumentIds?.[row.provider]));
  }

  const reconnectRoots = selectedRows.filter((row) => reconnectPending?.[row.provider]);
  const reconnecting = (Object.keys(ROOT_LABEL) as FederatedProvider[]).some((provider) => (
    Boolean(reconnectPending?.[provider])
  ));
  const membershipKnown = reconnecting
    && reconnectRoots.every((row) => Object.prototype.hasOwnProperty.call(folderContentsByRoot, row.key));

  return {
    selectedBytes,
    sizesReady: selectedRows.length === 0 ? true : sizesReady,
    providersWithSelection: Array.from(providers),
    stagedSelectedDocs,
    appliedSelectedDocs,
    deselectedAppliedRootBytes,
    liveSelectedDocs: Array.from(liveById.values()),
    membershipKnown,
  };
}

const CloudFolderPicker: React.FC<CloudFolderPickerProps> = ({
  sessions,
  initialSelections,
  providerSyncFilesEnabled,
  linkedProviders,
  focusRequest,
  onSelectionsChange,
  onConnectRequested,
  onDirtyChange,
  onUsageSnapshotChange,
  reconnectPending,
  rejectedDocumentIds,
  skippedDocumentIds,
  failedDocuments,
  subscriptions,
  ref,
}) => {
  const isDesktopLayout = useDesktopLayout();
  const [loadingRoots, setLoadingRoots] = useState(true);
  const [isSubscriptionsExpanded, setIsSubscriptionsExpanded] = useState(false);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [pendingSubscriptionReveal, setPendingSubscriptionReveal] = useState<SubscriptionRevealTarget | null>(null);
  const subscriptionsPanelRef = useRef<SubscriptionsPanelHandle | null>(null);
  const subscriptionStaging = useSubscriptionStaging(subscriptions);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [rootKeys, setRootKeys] = useState<string[]>([]);
  const [nodes, setNodes] = useState<Record<string, FolderTreeNode>>({});
  const [selected, setSelected] = useState<Record<string, SelectedFolder>>({});
  const [folderContentsByRoot, setFolderContentsByRoot] = useState<Record<string, SupportedFolderFile[]>>({});
  // Mobile stacked layout: open files when selections already exist, otherwise providers.
  const [mobilePane, setMobilePane] = useState<MobileSyncPane>(() => (
    hasAnyFolderSelection(initialSelections) ? 'files' : 'providers'
  ));
  const [highlightNodeKey, setHighlightNodeKey] = useState<string | null>(null);
  const [highlightServiceProvider, setHighlightServiceProvider] = useState<FederatedProvider | null>(null);
  const [rightExpandedKeyByParent, setRightExpandedKeyByParent] = useState<Record<string, string | null>>({});
  const tagColors = useResourceTagColors();
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
  const subfolderCheckQueueRef = useRef<SubfolderCheckRequest[]>([]);
  const pendingSubfolderCheckKeysRef = useRef<Set<string>>(new Set());
  const checkedSubfolderKeysRef = useRef<Set<string>>(new Set());
  const activeSubfolderChecksRef = useRef(0);
  const subfolderCheckGenerationRef = useRef(0);
  const nodeRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const selectedRowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const rootRowRefs = useRef<Record<FederatedProvider, HTMLDivElement | null>>({ google: null, microsoft: null });
  const initialSelectionsRef = useRef(initialSelections);
  const hasBootstrappedSelectionsRef = useRef(false);
  const requestedRightExpandedLoadKeysRef = useRef<Set<string>>(new Set());
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
    enabled: isDesktopLayout,
  });

  const isMobileStacked = !isDesktopLayout;
  const showProvidersPane = isDesktopLayout || mobilePane === 'providers';
  const showFilesPane = isDesktopLayout || mobilePane === 'files';

  const toggleMobilePane = useCallback((pane: MobileSyncPane) => {
    setMobilePane((current) => (current === pane ? current : pane));
  }, []);

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

            const existingChild = next[childKey];
            const hasChildren = child.kind === 'folder'
              ? existingChild?.hasChildren ?? child.hasChildren
              : false;

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
            hasChildren: sortedChildren.some((child) => child.kind === 'folder'),
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
      const initialTargetsByKey = new Map<string, FolderSelectionTarget>();
      for (const provider of ['google', 'microsoft'] as FederatedProvider[]) {
        for (const target of initialSelectionsRef.current[provider] || []) {
          initialTargetsByKey.set(makeNodeKey(provider, target.id), target);
        }
      }
      for (const selection of Object.values(initialSelected)) {
        if (nextNodes[selection.key]) {
          const existing = nextNodes[selection.key];
          const target = initialTargetsByKey.get(selection.key);
          if (target?.sizeKnown && typeof target.sizeBytes === 'number' && !existing.sizeKnown) {
            nextNodes[selection.key] = {
              ...existing,
              sizeBytes: Math.max(0, Math.floor(target.sizeBytes)),
              sizeKnown: true,
            };
          }
          continue;
        }

        const target = initialTargetsByKey.get(selection.key);
        const persistedKnown = Boolean(target?.sizeKnown && typeof target.sizeBytes === 'number');
        nextNodes[selection.key] = {
          key: selection.key,
          provider: selection.provider,
          id: selection.id,
          kind: target?.kind === 'file' ? 'file' : 'folder',
          name: selection.name,
          path: selection.path,
          sizeBytes: persistedKnown ? Math.max(0, Math.floor(target!.sizeBytes!)) : 0,
          sizeKnown: persistedKnown,
          hasChildren: target?.kind !== 'file',
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
      subfolderCheckGenerationRef.current += 1;
      subfolderCheckQueueRef.current = [];
      pendingSubfolderCheckKeysRef.current.clear();
      checkedSubfolderKeysRef.current.clear();
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

  const pumpSubfolderChecks = useCallback(() => {
    while (activeSubfolderChecksRef.current < SUBFOLDER_CHECK_CONCURRENCY) {
      const request = subfolderCheckQueueRef.current.shift();
      if (!request) {
        return;
      }

      if (request.generation !== subfolderCheckGenerationRef.current) {
        continue;
      }

      const node = nodesRef.current[request.key];
      if (!node || !node.hasChildren || node.childrenLoaded || node.isLoading || !isNodeVisibleInTree(request.key, nodesRef.current)) {
        pendingSubfolderCheckKeysRef.current.delete(request.key);
        continue;
      }

      activeSubfolderChecksRef.current += 1;
      void (async () => {
        try {
          const children = await listFolderChildrenForSession(request.session, node.id, node.driveId);
          if (request.generation !== subfolderCheckGenerationRef.current) {
            return;
          }

          const hasSubfolders = children.some((entry) => entry.kind === 'folder');
          updateNodes((current) => {
            const existing = current[request.key];
            if (!existing || existing.childrenLoaded || existing.hasChildren === hasSubfolders) {
              return current;
            }

            return {
              ...current,
              [request.key]: {
                ...existing,
                hasChildren: hasSubfolders,
              },
            };
          });
        } catch {
          // Keep the chevron visible if the check fails.
        } finally {
          activeSubfolderChecksRef.current -= 1;
          if (request.generation === subfolderCheckGenerationRef.current) {
            pendingSubfolderCheckKeysRef.current.delete(request.key);
            checkedSubfolderKeysRef.current.add(request.key);
          }
          pumpSubfolderChecks();
        }
      })();
    }
  }, [updateNodes]);

  useEffect(() => {
    const generation = subfolderCheckGenerationRef.current;
    const requests: SubfolderCheckRequest[] = [];
    for (const { key } of visibleNodes) {
      const node = nodes[key];
      if (!node || node.id === 'root' || !node.hasChildren || node.childrenLoaded || node.isLoading) {
        continue;
      }

      if (checkedSubfolderKeysRef.current.has(key) || pendingSubfolderCheckKeysRef.current.has(key)) {
        continue;
      }

      const session = sessions[node.provider];
      if (!session) {
        continue;
      }

      requests.push({ key, session, generation });
    }

    if (requests.length === 0) {
      return;
    }

    for (const request of requests) {
      pendingSubfolderCheckKeysRef.current.add(request.key);
    }
    subfolderCheckQueueRef.current = [...requests, ...subfolderCheckQueueRef.current];
    pumpSubfolderChecks();
  }, [nodes, pumpSubfolderChecks, sessions, visibleNodes]);

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
        driveId: node.driveId,
        excludedItemIds: new Set<string>(),
        includedItemIds: new Set<string>(),
        tags: [],
        itemTags: new Map<string, string[]>(),
        itemTagExclusions: new Map<string, string[]>(),
      };

      return next;
    });
  }, [nodes]);

  const areFilesDirty = useMemo(() => {
    if (!hasBootstrappedSelectionsRef.current) {
      return false;
    }

    return !areSelectionPayloadsEqual(toSelectionPayload(selectedRows, nodes), initialSelections);
  }, [initialSelections, nodes, selectedRows]);
  const areSubscriptionsDirty = Boolean(subscriptions) && subscriptionStaging.isDirty;
  const isDirty = areFilesDirty || areSubscriptionsDirty;

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const usageSnapshot = useMemo(
    () => computeUsageSnapshot(
      selectedRows,
      nodes,
      initialSelections,
      folderContentsByRoot,
      reconnectPending,
      skippedDocumentIds
    ),
    [folderContentsByRoot, initialSelections, nodes, reconnectPending, selectedRows, skippedDocumentIds]
  );
  const usageSnapshotFingerprintRef = useRef('');

  useEffect(() => {
    if (!onUsageSnapshotChange) {
      return;
    }
    const fingerprint = JSON.stringify({
      selectedBytes: usageSnapshot.selectedBytes,
      sizesReady: usageSnapshot.sizesReady,
      providersWithSelection: usageSnapshot.providersWithSelection,
      stagedSelectedDocs: usageSnapshot.stagedSelectedDocs,
      appliedSelectedDocs: usageSnapshot.appliedSelectedDocs,
      deselectedAppliedRootBytes: usageSnapshot.deselectedAppliedRootBytes,
      liveSelectedDocs: usageSnapshot.liveSelectedDocs,
      membershipKnown: usageSnapshot.membershipKnown,
    });
    if (fingerprint === usageSnapshotFingerprintRef.current) {
      return;
    }
    usageSnapshotFingerprintRef.current = fingerprint;
    onUsageSnapshotChange(usageSnapshot);
  }, [onUsageSnapshotChange, usageSnapshot]);

  const requestCatalogRef = useRef(subscriptions?.onRequestCatalog);
  requestCatalogRef.current = subscriptions?.onRequestCatalog;
  useEffect(() => {
    requestCatalogRef.current?.();
  }, []);

  const subscriptionLibraries = useMemo(
    () => (subscriptions ? visibleSubscriptionLibraries(subscriptions) : []),
    [subscriptions]
  );

  useEffect(() => {
    if (!pendingSubscriptionReveal) {
      return;
    }
    if (!subscriptionLibraries.some((library) => library.key === pendingSubscriptionReveal.libraryKey)) {
      return;
    }

    subscriptionsPanelRef.current?.reveal(pendingSubscriptionReveal);
    setPendingSubscriptionReveal(null);
  }, [pendingSubscriptionReveal, subscriptionLibraries]);

  const handleApply = useCallback(() => {
    const shouldApplyFiles = areFilesDirty || !areSubscriptionsDirty;
    const untagged = shouldApplyFiles
      ? findFirstUntaggedSelection(selectedRows, nodes, providerSyncFilesEnabled, sessions)
      : null;
    if (untagged) {
      window.alert('You must supply tags for all files before saving.');

      setRightExpandedKeyByParent((current) => {
        if (untagged.key === untagged.rootSelectionKey) {
          return current;
        }

        const next: Record<string, string | null> = { ...current, [RIGHT_PANEL_TOP_LEVEL_GROUP]: untagged.rootSelectionKey };
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

    if (subscriptions && areSubscriptionsDirty) {
      const blocked = findStarredTranslationBlock(
        subscriptions.libraries,
        subscriptions.translationRecords,
        subscriptionStaging.staging
      );
      if (blocked) {
        window.alert('At least one of your starred translations must stay enabled.');
        setPendingSubscriptionReveal({ ...blocked, flash: true });
        return;
      }
    }

    setErrorMessage(null);
    const folderApply = shouldApplyFiles
      ? onSelectionsChange(toSelectionPayload(selectedRows, nodes))
      : null;
    const subscriptionsApply = subscriptions && areSubscriptionsDirty
      ? subscriptions.onSubscriptionsApply(subscriptionStaging.toChanges())
      : null;
    void Promise.all([folderApply, subscriptionsApply])
      .then(([folders, subscriptionSummary]) => {
        showToast(formatAccountSyncApplyToast(folders ?? null, subscriptionSummary ?? null));
      })
      .catch((error: unknown) => {
        showToast(formatAccountSyncApplyToast({
          queuedProviders: [],
          failures: [error instanceof Error ? error.message : String(error)],
        }, null));
      });
  }, [
    areFilesDirty,
    areSubscriptionsDirty,
    nodes,
    onSelectionsChange,
    providerSyncFilesEnabled,
    selectedRows,
    sessions,
    subscriptionStaging,
    subscriptions,
  ]);

  const resetSubscriptionStaging = subscriptionStaging.reset;
  const handleCancel = useCallback(() => {
    setSelected(buildSelectedMapFromPayload(initialSelectionsRef.current));
    resetSubscriptionStaging();
  }, [resetSubscriptionStaging]);

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

  const toggleExcluded = useCallback((rootSelectionKey: string, itemId: string, currentlyUnselected: boolean) => {
    setSelected((current) => {
      const existing = current[rootSelectionKey];
      if (!existing) {
        return current;
      }

      const nextExcluded = new Set(existing.excludedItemIds);
      const nextIncluded = new Set(existing.includedItemIds);
      if (currentlyUnselected) {
        nextExcluded.delete(itemId);
        nextIncluded.add(itemId);
      } else {
        nextExcluded.add(itemId);
        nextIncluded.delete(itemId);
      }

      return {
        ...current,
        [rootSelectionKey]: {
          ...existing,
          excludedItemIds: nextExcluded,
          includedItemIds: nextIncluded,
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

  const selectedRootKeys = useMemo(() => new Set(selectedRows.map((row) => row.key)), [selectedRows]);
  const selectedRootKeysRef = useRef(selectedRootKeys);
  selectedRootKeysRef.current = selectedRootKeys;
  useEffect(() => {
    setFolderContentsByRoot((current) => {
      const extra = Object.keys(current).filter((key) => !selectedRootKeys.has(key));
      if (extra.length === 0) {
        return current;
      }
      const next = { ...current };
      for (const key of extra) {
        delete next[key];
      }
      return next;
    });
  }, [selectedRootKeys]);

  // Eagerly size every selected root (and visible right-panel folders) so the plan bar can fill.
  useEffect(() => {
    const keysToSize = new Set<string>();
    for (const row of selectedRows) {
      keysToSize.add(row.key);
    }
    for (const visibleRow of rightVisibleRows) {
      keysToSize.add(visibleRow.key);
    }

    for (const nodeKey of keysToSize) {
      const node = nodesRef.current[nodeKey];
      if (!node || node.kind !== 'folder') {
        continue;
      }

      const isSelectedRoot = selectedRootKeys.has(nodeKey);
      const needsInventory = isSelectedRoot && Boolean(reconnectPending?.[node.provider]);
      const hasInventory = Object.prototype.hasOwnProperty.call(folderContentsByRoot, nodeKey);
      if (node.sizeKnown && !(needsInventory && !hasInventory)) {
        continue;
      }

      if (inFlightFolderSizeReadsRef.current[nodeKey]) {
        continue;
      }

      const session = sessions[node.provider];
      if (!session) {
        continue;
      }

      const readPromise = (async () => {
        try {
          const contents = await listSupportedFolderContentsForSession(session, node.id, node.driveId);
          const computedSize = Math.max(0, Math.floor(contents.totalBytes));
          updateNodes((current) => {
            const existing = current[nodeKey];
            if (!existing) {
              return current;
            }

            return {
              ...current,
              [nodeKey]: {
                ...existing,
                sizeBytes: computedSize,
                sizeKnown: true,
              },
            };
          });
          if (needsInventory && selectedRootKeysRef.current.has(nodeKey)) {
            setFolderContentsByRoot((current) => ({ ...current, [nodeKey]: contents.files }));
          }
        } catch {
          // Keep unknown size blank if compute fails.
        } finally {
          delete inFlightFolderSizeReadsRef.current[nodeKey];
        }
      })();

      inFlightFolderSizeReadsRef.current[nodeKey] = readPromise;
    }
  }, [folderContentsByRoot, reconnectPending, rightVisibleRows, selectedRootKeys, selectedRows, sessions, updateNodes]);

  // Right-panel expansion outlives the node tree, which is rebuilt whenever sessions change.
  useEffect(() => {
    for (const visibleRow of rightVisibleRows) {
      const node = nodesRef.current[visibleRow.key];
      if (!node || node.kind !== 'folder') {
        continue;
      }

      if (node.childrenLoaded) {
        requestedRightExpandedLoadKeysRef.current.delete(visibleRow.key);
        continue;
      }

      const groupKey = visibleRow.isRootSelection ? RIGHT_PANEL_TOP_LEVEL_GROUP : node.parentKey || RIGHT_PANEL_TOP_LEVEL_GROUP;
      if (rightExpandedKeyByParent[groupKey] !== visibleRow.key || node.isLoading || !sessions[node.provider]) {
        continue;
      }

      // Failed loads stay requested so a persistent error can't retrigger this effect in a loop.
      if (requestedRightExpandedLoadKeysRef.current.has(visibleRow.key)) {
        continue;
      }

      requestedRightExpandedLoadKeysRef.current.add(visibleRow.key);
      void loadChildren(visibleRow.key);
    }
  }, [loadChildren, rightExpandedKeyByParent, rightVisibleRows, sessions]);

  const reconnectNotices = (Object.keys(ROOT_LABEL) as FederatedProvider[])
    .filter((provider) => reconnectPending?.[provider])
    .map((provider) => ({ provider, folderCount: initialSelections[provider].length }));

  return (
    <section className="cloud-folder-picker" aria-label="File Sync">
      {reconnectNotices.map(({ provider, folderCount }) => (
        <div key={provider} className="alert alert-info mb-0 cloud-folder-reconnect-notice" role="status">
          Restored {folderCount} {folderCount === 1 ? 'folder' : 'folders'} from your previous {ROOT_LABEL[provider]} connection.
          Review and Apply to resume syncing.
        </div>
      ))}

      <div ref={layoutRef} className={`cloud-folder-picker-layout${isMobileStacked ? ' is-mobile-stacked' : ''}`}>
        <div
          className={`cloud-folder-picker-left${isMobileStacked && !showProvidersPane ? ' is-mobile-collapsed' : ''}`}
          style={{ flexBasis: `${splitPercent}%` }}
        >
          {isMobileStacked && (
            <button
              type="button"
              className="cloud-folder-mobile-pane-toggle"
              id="cloud-folder-providers-toggle"
              aria-expanded={showProvidersPane}
              aria-controls="cloud-folder-providers-pane"
              onClick={() => toggleMobilePane('providers')}
            >
              <span>Select Cloud Providers</span>
              <i className={`fa-solid ${showProvidersPane ? 'fa-chevron-down' : 'fa-chevron-right'}`} aria-hidden="true"></i>
            </button>
          )}

          {showProvidersPane && (
            <div
              id="cloud-folder-providers-pane"
              className="cloud-folder-picker-pane-body"
              role="region"
              aria-labelledby={isMobileStacked ? 'cloud-folder-providers-toggle' : undefined}
            >
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

              {subscriptions && (
                <ul className="cloud-folder-tree-list" aria-label="Subscriptions">
                  <li>
                    <div className="cloud-folder-tree-row no-checkbox" style={{ paddingLeft: 0 }}>
                      <button
                        type="button"
                        className="cloud-folder-tree-chevron"
                        aria-label={isSubscriptionsExpanded ? 'Collapse Subscriptions' : 'Expand Subscriptions'}
                        onClick={() => setIsSubscriptionsExpanded((current) => !current)}
                      >
                        <i className={`fa-solid ${isSubscriptionsExpanded ? 'fa-chevron-down' : 'fa-chevron-right'}`} aria-hidden="true"></i>
                      </button>
                      <div className="cloud-folder-tree-name-wrap">
                        <button
                          type="button"
                          className="cloud-folder-tree-name"
                          onClick={() => setIsSubscriptionsExpanded((current) => !current)}
                        >
                          Subscriptions
                        </button>
                        <button
                          type="button"
                          className="btn btn-link btn-sm cloud-folder-tree-connect-link"
                          aria-label="Connect a subscription"
                          onClick={() => setIsConnectModalOpen(true)}
                        >
                          Connect
                        </button>
                      </div>
                    </div>
                  </li>
                  {isSubscriptionsExpanded && subscriptionLibraries.map((library) => (
                    <li key={libraryRowKey(library.key)}>
                      <div className="cloud-folder-tree-row no-checkbox" style={{ paddingLeft: '0.55rem' }}>
                        <span className="cloud-folder-tree-chevron-spacer" aria-hidden="true"></span>
                        <div className="cloud-folder-tree-name-wrap">
                          <button
                            type="button"
                            className="cloud-folder-tree-name"
                            title={library.isBuiltIn ? undefined : library.key}
                            onClick={() => setPendingSubscriptionReveal({ libraryKey: library.key, flash: true })}
                          >
                            {library.name}
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <WorkspaceDivider
          orientation="vertical"
          onPointerDown={handleDividerPointerDown}
          onKeyDown={handleDividerKeyDown}
        />

        <div
          className={`cloud-folder-picker-right${isMobileStacked && !showFilesPane ? ' is-mobile-collapsed' : ''}`}
          style={{ flexBasis: `${selectedPanePercent}%` }}
        >
          {isMobileStacked && (
            <button
              type="button"
              className="cloud-folder-mobile-pane-toggle"
              id="cloud-folder-files-toggle"
              aria-expanded={showFilesPane}
              aria-controls="cloud-folder-files-pane"
              onClick={() => toggleMobilePane('files')}
            >
              <span>Select Files & Folders</span>
              <i className={`fa-solid ${showFilesPane ? 'fa-chevron-down' : 'fa-chevron-right'}`} aria-hidden="true"></i>
            </button>
          )}

          {showFilesPane && (
            <div
              id="cloud-folder-files-pane"
              className="cloud-folder-picker-pane-body"
              role="region"
              aria-labelledby={isMobileStacked ? 'cloud-folder-files-toggle' : undefined}
            >
              {!isMobileStacked && (
                <div className="cloud-folder-selected-header">
                  <span className="cloud-folder-selected-header-name">Selected Files & Folders</span>
                  <span className="cloud-folder-selected-header-size text-end" title="Shows file sync size and status. Unsupported file types are excluded.">Synchronization</span>
                </div>
              )}

              {selectedRows.length === 0 && subscriptionLibraries.length === 0 && (
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
                const isSkipped = !isFolder
                  && !visibleRow.isRootSelection
                  && !isExcluded
                  && !isCoveredByExcludedAncestor
                  && !rootSelection.includedItemIds.has(node.id)
                  && Boolean(skippedDocumentIds?.[node.provider]?.has(node.id));
                const looksUnselected = isExcluded || isSkipped;
                const isRejected = !isFolder
                  && !visibleRow.isRootSelection
                  && !isExcluded
                  && !isSkipped
                  && !isCoveredByExcludedAncestor
                  && Boolean(rejectedDocumentIds?.[node.provider]?.has(node.id));
                const failedError = !isFolder
                  && !visibleRow.isRootSelection
                  && !isExcluded
                  && !isSkipped
                  && !isCoveredByExcludedAncestor
                  && !isRejected
                  ? failedDocuments?.[node.provider]?.get(node.id)
                  : undefined;
                const isFailed = failedError !== undefined;
                const unavailableMessage = isRejected
                  ? describeLowVerseRatioRejection('This file')
                  : isFailed
                    ? describeSyncFailure(null, failedError)
                    : null;
                const unavailableAriaLabel = isRejected
                  ? describeLowVerseRatioRejection(`'${node.name}'`)
                  : isFailed
                    ? describeSyncFailure(node.name, failedError)
                    : null;
                const displayLabel = (visibleRow.isRootSelection ? rootSelection.path : node.name).replace(/\//g, '/\u200B');
                const canActivateName = visibleRow.isRootSelection && showChevron;
                const isTaggable = visibleRow.isRootSelection
                  ? providerAvailable
                  : !looksUnselected && !isCoveredByExcludedAncestor && !isRejected && !isFailed && canToggleSync && providerAvailable;
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
                        ) : isRejected || isFailed ? (
                          <button
                            type="button"
                            className="btn btn-link btn-sm p-0 cloud-folder-selected-rejected"
                            title={unavailableMessage ?? undefined}
                            aria-label={unavailableAriaLabel ?? undefined}
                            aria-disabled="true"
                            onClick={(event) => {
                              event.stopPropagation();
                              if (unavailableAriaLabel) {
                                showToast({ tone: 'info', message: unavailableAriaLabel });
                              }
                            }}
                          >
                            <i className="fa-solid fa-upload"></i>
                          </button>
                        ) : canToggleSync && providerAvailable ? (
                          <button
                            type="button"
                            className={`btn btn-link btn-sm p-0 ${looksUnselected ? 'cloud-folder-selected-restore text-warning' : 'cloud-folder-selected-remove text-info'}`}
                            style={isCoveredByExcludedAncestor ? { visibility: 'hidden' } : undefined}
                            title={looksUnselected ? 'Sync disabled. Click to resume syncing' : 'Sync enabled. Click to exclude from syncing.'}
                            aria-label={looksUnselected ? `Resume syncing ${node.path}` : `Exclude ${node.path} from sync`}
                            aria-hidden={isCoveredByExcludedAncestor}
                            disabled={isCoveredByExcludedAncestor}
                            tabIndex={isCoveredByExcludedAncestor ? -1 : undefined}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleExcluded(visibleRow.rootSelectionKey, node.id, looksUnselected);
                            }}
                          >
                            <i className={`fa-solid ${looksUnselected ? 'fa-upload' : 'fa-arrows-rotate'}`}></i>
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

              {subscriptions && (
                <SubscriptionsPanel
                  ref={subscriptionsPanelRef}
                  binding={subscriptions}
                  staging={subscriptionStaging}
                />
              )}
            </div>
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

            setTagModalTarget(null);
          }}
          onClose={() => setTagModalTarget(null)}
        />
      )}

      {subscriptions && isConnectModalOpen && (
        <SubscriptionConnectModal
          sourceUrls={subscriptions.sourceUrls}
          onAddSourceUrl={subscriptions.onAddSourceUrl}
          onRequestGitHubAuth={subscriptions.onRequestGitHubAuth}
          onConnected={(url) => {
            setIsConnectModalOpen(false);
            setIsSubscriptionsExpanded(true);
            setPendingSubscriptionReveal({ libraryKey: url, flash: true });
          }}
          onClose={() => setIsConnectModalOpen(false)}
        />
      )}
    </section>
  );
};

export default CloudFolderPicker;
