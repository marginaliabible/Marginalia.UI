export const TAG_COLOR_STORAGE_KEY = 'marginalia:resource-tag-colors';
export const TAG_COLOR_PALETTE = [
  '#0aa7a0', 
  '#f1c40f', 
  '#e84393', 
  '#16a085', 
  '#f39c12', 
  '#6c5ce7', 
  '#c0392b', 
  '#2ecc71', 
  '#e67e22', 
  '#8e44ad', 
  '#2980b9',
  '#55efc4', 
  '#d35400', 
  '#383f3f', 
  '#9b59b6',
  '#27ae60', 
  '#fdcb6e', 
  '#3498db', 
  '#e17055', 
  '#ffffff', 
  '#1abc9c', 
  '#fab1a0',
  '#00b894', 
  '#0984e3', 
  '#00cec9', 
];

export interface ResourceTagColor {
  color: string;
  /** When a device first colored the tag; 0 for colors saved before assignments were timed. */
  assignedAt: number;
}

export type ResourceTagColors = Record<string, ResourceTagColor>;

const EMPTY_TAG_COLORS: ResourceTagColors = {};

export function normalizeResourceTagColors(value: unknown): ResourceTagColors {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const normalized: ResourceTagColors = {};
  for (const [rawTag, entry] of Object.entries(value as Record<string, unknown>)) {
    const tag = rawTag.trim();
    if (!tag) {
      continue;
    }

    // Colors saved before assignments were timed are bare strings.
    if (typeof entry === 'string') {
      if (entry.trim()) {
        normalized[tag] = { color: entry.trim(), assignedAt: 0 };
      }
      continue;
    }

    if (entry && typeof entry === 'object') {
      const { color, assignedAt } = entry as Partial<ResourceTagColor>;
      if (typeof color === 'string' && color.trim()) {
        normalized[tag] = {
          color: color.trim(),
          assignedAt: typeof assignedAt === 'number' && Number.isFinite(assignedAt) ? assignedAt : 0,
        };
      }
    }
  }

  return normalized;
}

function generateFallbackColor(index: number): string {
  const hue = (index * 137.508) % 360;
  return `hsl(${hue.toFixed(0)} 70% 52%)`;
}

function nextUnusedColor(used: ReadonlySet<string>): string {
  const paletteColor = TAG_COLOR_PALETTE.find((candidate) => !used.has(candidate));
  if (paletteColor) {
    return paletteColor;
  }

  let index = used.size;
  while (used.has(generateFallbackColor(index))) {
    index += 1;
  }
  return generateFallbackColor(index);
}

/**
 * Union of every copy's tag colors. Each tag keeps its earliest assignment (ties broken by color so
 * every device picks the same one), and a tag whose color an earlier-assigned tag already holds moves to
 * the next free color, so tags colored independently on two devices stay distinct. Commutative and idempotent.
 */
export function mergeResourceTagColors(copies: readonly unknown[]): ResourceTagColors {
  const earliest: ResourceTagColors = {};
  for (const copy of copies) {
    for (const [tag, entry] of Object.entries(normalizeResourceTagColors(copy))) {
      const current = earliest[tag];
      if (
        !current
        || entry.assignedAt < current.assignedAt
        || (entry.assignedAt === current.assignedAt && entry.color < current.color)
      ) {
        earliest[tag] = entry;
      }
    }
  }

  const ordered = Object.entries(earliest).sort(([leftTag, left], [rightTag, right]) => (
    left.assignedAt - right.assignedAt || (leftTag < rightTag ? -1 : leftTag > rightTag ? 1 : 0)
  ));
  const merged: ResourceTagColors = {};
  const used = new Set<string>();
  for (const [tag, entry] of ordered) {
    const color = used.has(entry.color) ? nextUnusedColor(used) : entry.color;
    used.add(color);
    merged[tag] = { color, assignedAt: entry.assignedAt };
  }

  return merged;
}

const listeners = new Set<() => void>();
let snapshot: { raw: string | null; colors: ResourceTagColors } | null = null;
let isListeningForStorage = false;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(TAG_COLOR_STORAGE_KEY);
  } catch {
    return null;
  }
}

function notifyListeners(): void {
  for (const listener of Array.from(listeners)) {
    listener();
  }
}

function ensureStorageListener(): void {
  if (isListeningForStorage || typeof window === 'undefined') {
    return;
  }

  isListeningForStorage = true;
  window.addEventListener('storage', (event) => {
    if (event.key === TAG_COLOR_STORAGE_KEY || event.key === null) {
      notifyListeners();
    }
  });
}

/** This device's tag colors, shared by every window. Returns the same object until they change. */
export function getResourceTagColors(): ResourceTagColors {
  if (typeof window === 'undefined') {
    return EMPTY_TAG_COLORS;
  }

  ensureStorageListener();
  const raw = readRaw();
  if (!snapshot || snapshot.raw !== raw) {
    let parsed: unknown = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    snapshot = { raw, colors: normalizeResourceTagColors(parsed) };
  }

  return snapshot.colors;
}

function writeResourceTagColors(next: ResourceTagColors): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(TAG_COLOR_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Best effort persistence; this window still sees the new colors.
  }
  snapshot = { raw: readRaw(), colors: next };
  notifyListeners();
}

export function subscribeResourceTagColors(listener: () => void): () => void {
  ensureStorageListener();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Gives each tag without a color the next unused one. */
export function assignResourceTagColors(tags: readonly string[]): void {
  const current = getResourceTagColors();
  const missing = Array.from(new Set(tags.map((tag) => tag.trim()))).filter((tag) => tag && !current[tag]);
  if (missing.length === 0) {
    return;
  }

  const next = { ...current };
  const used = new Set(Object.values(current).map((entry) => entry.color));
  const assignedAt = Date.now();
  for (const tag of missing) {
    const color = nextUnusedColor(used);
    used.add(color);
    next[tag] = { color, assignedAt };
  }

  writeResourceTagColors(next);
}

/** Folds another copy's colors (e.g. the synced account settings) into this device's. */
export function mergeIntoResourceTagColors(incoming: unknown): void {
  const current = getResourceTagColors();
  const merged = mergeResourceTagColors([current, incoming]);
  const changed = Object.keys(merged).length !== Object.keys(current).length
    || Object.entries(merged).some(([tag, entry]) => (
      current[tag]?.color !== entry.color || current[tag]?.assignedAt !== entry.assignedAt
    ));
  if (changed) {
    writeResourceTagColors(merged);
  }
}
