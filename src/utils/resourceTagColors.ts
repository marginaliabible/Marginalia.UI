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

// Read-only snapshot of the shared tag->color map, without assigning colors to any new tags.
export function getStoredResourceTagColors(): Map<string, string> {
  return readStoredTagColors();
}

function generateFallbackColor(index: number): string {
  const hue = (index * 137.508) % 360;
  return `hsl(${hue.toFixed(0)} 70% 52%)`;
}

export function getOrAssignResourceTagColors(tags: string[]): Map<string, string> {
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