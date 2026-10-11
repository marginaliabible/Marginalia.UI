import { useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import {
  assignResourceTagColors,
  getResourceTagColors,
  subscribeResourceTagColors,
  type ResourceTagColors,
} from '../utils/resourceTagColors';

const EMPTY_TAG_COLORS: ResourceTagColors = {};

export function useResourceTagColorEntries(): ResourceTagColors {
  return useSyncExternalStore(subscribeResourceTagColors, getResourceTagColors, () => EMPTY_TAG_COLORS);
}

/** Tag -> color for every colored tag, first giving any of `tags` without a color one. Pass a stable `tags` array. */
export function useResourceTagColors(tags?: readonly string[]): ReadonlyMap<string, string> {
  const entries = useResourceTagColorEntries();

  // Re-checked when the colors change too, so a tag dropped by another window's concurrent write is re-colored.
  useLayoutEffect(() => {
    if (tags && tags.length > 0) {
      assignResourceTagColors(tags);
    }
  }, [tags, entries]);

  return useMemo(
    () => new Map(Object.entries(entries).map(([tag, entry]) => [tag, entry.color])),
    [entries]
  );
}
