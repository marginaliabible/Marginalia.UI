/**
 * A root folder/file chosen for File Sync (cloud Drive/OneDrive or Local Folders).
 * Local roots use absolute filesystem paths as `id`/`path` and set `machineId`.
 */
export interface FolderSelectionTarget {
  id: string;
  /** Local Folders (Watchman) machine this target lives on; never set for Google/Microsoft targets. */
  machineId?: string;
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

/** CCS / Watchman folderTags entry for one selected root. */
export interface FolderTagsEntry {
  tags: string[];
  itemTags: Record<string, string[]>;
  itemTagExclusions: Record<string, string[]>;
}

export interface LocalFolderSelectionFlat {
  selectedFolders: string[];
  excluded: string[];
  included: string[];
  folderTags: Record<string, FolderTagsEntry>;
}

function normalizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(value.map((entry) => String(entry ?? '').trim()).filter(Boolean)));
}

function normalizeTagMap(value: unknown): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  if (!value || typeof value !== 'object') {
    return map;
  }
  for (const [itemId, tags] of Object.entries(value as Record<string, unknown>)) {
    const key = String(itemId ?? '').trim();
    const list = normalizeIdList(tags);
    if (key && list.length > 0) {
      map[key] = list;
    }
  }
  return map;
}

function isPathUnder(path: string, ancestor: string): boolean {
  return path.startsWith(`${ancestor}/`) || path.startsWith(`${ancestor}\\`);
}

function basenamePath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || path;
}

/**
 * Flattens Local FolderSelectionTarget rows into the selection shape CCS / Watchman enumerate uses
 * (same semantics as selectionFromCloudConfig for cloud providers).
 */
export function selectionFromLocalTargets(targets: readonly FolderSelectionTarget[]): LocalFolderSelectionFlat {
  const selectedFolders: string[] = [];
  const excluded: string[] = [];
  const included: string[] = [];
  const folderTags: Record<string, FolderTagsEntry> = {};

  for (const entry of targets) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const id = String(entry.id ?? entry.path ?? '').trim();
    if (!id) {
      continue;
    }
    selectedFolders.push(id);
    folderTags[id] = {
      tags: normalizeIdList(entry.tags),
      itemTags: normalizeTagMap(entry.itemTags),
      itemTagExclusions: normalizeTagMap(entry.itemTagExclusions),
    };
    for (const excludedId of normalizeIdList(entry.excludedItemIds)) {
      excluded.push(excludedId);
    }
    for (const includedId of normalizeIdList(entry.includedItemIds)) {
      included.push(includedId);
    }
  }

  return {
    selectedFolders: normalizeIdList(selectedFolders),
    excluded: normalizeIdList(excluded),
    included: normalizeIdList(included),
    folderTags,
  };
}

/**
 * Rebuilds rich Local targets from the flat CCS / Watchman selection snapshot
 * (folder-selection.json, pending-sync, or selection.json).
 */
export function localTargetsFromFlatSelection(
  machineId: string,
  flat: Partial<LocalFolderSelectionFlat> | null | undefined
): FolderSelectionTarget[] {
  const selectedFolders = normalizeIdList(flat?.selectedFolders);
  const excluded = normalizeIdList(flat?.excluded);
  const included = normalizeIdList(flat?.included);
  const folderTags = flat?.folderTags && typeof flat.folderTags === 'object'
    ? flat.folderTags as Record<string, Partial<FolderTagsEntry>>
    : {};

  return selectedFolders.map((id) => {
    const tagsEntry = folderTags[id] || {};
    const excludedItemIds = excluded.filter((path) => path === id || isPathUnder(path, id));
    const includedItemIds = included.filter((path) => path === id || isPathUnder(path, id));
    const tags = normalizeIdList(tagsEntry.tags);
    const itemTags = normalizeTagMap(tagsEntry.itemTags);
    const itemTagExclusions = normalizeTagMap(tagsEntry.itemTagExclusions);
    const base = basenamePath(id);
    // Flat CCS selection only stores paths; treat supported markup extensions as file roots.
    const kind: 'folder' | 'file' = /\.(pdf|docx?|pptx?|xlsx?|od[tspg]|rtf|txt|html?|csv|png|jpe?g|gif|bmp|webp|tiff?)$/i.test(base)
      ? 'file'
      : 'folder';
    return {
      id,
      machineId,
      kind,
      path: id,
      name: base,
      ...(excludedItemIds.length > 0 ? { excludedItemIds } : {}),
      ...(includedItemIds.length > 0 ? { includedItemIds } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      ...(Object.keys(itemTags).length > 0 ? { itemTags } : {}),
      ...(Object.keys(itemTagExclusions).length > 0 ? { itemTagExclusions } : {}),
    };
  });
}

/** Node key for a Local Folders selection / tree node in CloudFolderPicker. */
export function makeLocalNodeKey(machineId: string, path: string): string {
  return `local:${machineId}:${path}`;
}

export function parseLocalNodeKey(key: string): { machineId: string; path: string } | null {
  if (!key.startsWith('local:')) {
    return null;
  }
  const rest = key.slice('local:'.length);
  const sep = rest.indexOf(':');
  if (sep <= 0) {
    return null;
  }
  const machineId = rest.slice(0, sep);
  const path = rest.slice(sep + 1);
  if (!machineId || !path) {
    return null;
  }
  return { machineId, path };
}
