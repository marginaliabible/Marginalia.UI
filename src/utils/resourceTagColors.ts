const TAG_COLOR_STORAGE_KEY = 'marginalia:resource-tag-colors';
const TAG_COLOR_PALETTE = [
  '#0aa7a0', '#f1c40f', '#e84393', '#16a085', '#2ecc71', '#f39c12', '#e67e22', '#2980b9',
  '#1abc9c', '#c0392b', '#27ae60', '#8e44ad', '#d35400', '#3498db', '#7f8c8d', '#9b59b6',
  '#00b894', '#fdcb6e', '#0984e3', '#6c5ce7', '#e17055', '#00cec9', '#55efc4', '#fab1a0',
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