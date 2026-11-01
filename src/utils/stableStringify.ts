function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }

  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source)
        .filter((key) => source[key] !== undefined)
        .sort()
        .map((key) => [key, sortKeysDeep(source[key])])
    );
  }

  return value;
}

/** JSON with sorted object keys, so copies written by different devices compare equal. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value === undefined ? null : sortKeysDeep(value));
}
