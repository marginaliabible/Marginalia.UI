// Keys and helpers for Subscriptions: libraries that are built into the app or connected by URL.

export const BUILT_IN_LIBRARY_KEY = 'builtin';

export type SubscriptionDocumentType = 'translation' | 'resource' | 'hyperlink';

export const SUBSCRIPTION_DOCUMENT_TYPES: SubscriptionDocumentType[] = ['translation', 'resource', 'hyperlink'];

export interface ResourceTagOverride {
  added: string[];
  removed: string[];
}

export type ResourceTagOverrides = Record<string, ResourceTagOverride>;

export interface SourcePreferences {
  disabledSourceItems: string[];
  resourceTagOverrides: ResourceTagOverrides;
}

export const EMPTY_SOURCE_PREFERENCES: SourcePreferences = {
  disabledSourceItems: [],
  resourceTagOverrides: {},
};

/** Built-in content (the bundled library.json, KJV, bundled hyperlinks) is anything not traced to a saved URL. */
export function resolveLibraryKey(configuredSourceUrl: string | undefined, sourceUrls: string[]): string {
  const trimmed = configuredSourceUrl?.trim() ?? '';
  return trimmed && sourceUrls.includes(trimmed) ? trimmed : BUILT_IN_LIBRARY_KEY;
}

export function typeItemKey(libraryKey: string, type: SubscriptionDocumentType): string {
  return `${libraryKey}|type|${type}`;
}

export function translationItemKey(libraryKey: string, translationId: string): string {
  return `${libraryKey}|translation|${translationId}`;
}

/**
 * Resource documents are identified by their resources.json address rather than a library id, because
 * the verse lookup and title search services derive library ids differently.
 */
export function resourceDocumentKey(resourcesUrl: string, documentId: string): string {
  return `${hashText(resourcesUrl)}:${documentId}`;
}

export function resourceItemKey(libraryKey: string, resourceKey: string): string {
  return `${libraryKey}|resource|${resourceKey}`;
}

export function hyperlinkItemKey(libraryKey: string, url: string): string {
  return `${libraryKey}|hyperlink|${url}`;
}

/** Splits a disabledSourceItems key at its first kind marker; the trailing part may itself contain `|`. */
export function parseSourceItemKey(key: string): { libraryKey: string; kind: string; rest: string } | null {
  let best: { libraryKey: string; kind: string; rest: string; index: number } | null = null;
  for (const kind of ['type', ...SUBSCRIPTION_DOCUMENT_TYPES]) {
    const marker = `|${kind}|`;
    const index = key.indexOf(marker);
    if (index > 0 && (!best || index < best.index)) {
      best = { libraryKey: key.slice(0, index), kind, rest: key.slice(index + marker.length), index };
    }
  }

  return best ? { libraryKey: best.libraryKey, kind: best.kind, rest: best.rest } : null;
}

/** File Sync publishes the user's own notes as `.../users/{userId}/library.json`; that is not a subscription. */
export function isOwnLibraryUrl(url: string, userId: string | null | undefined): boolean {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url.split(/[?#]/)[0] ?? '';
  }

  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // Keep the raw path when it is not valid percent-encoding.
  }

  const match = /\/users\/([^/]+)\/library\.json$/i.exec(decoded);
  if (!match) {
    return false;
  }

  const owner = String(userId ?? '').trim().toLowerCase();
  return !owner || match[1].toLowerCase() === owner;
}

/** The same File Sync library location published for `userId`, or null if `url` is not an own-library URL. */
export function ownLibraryUrlFor(url: string, userId: string): string | null {
  const pattern = /\/users\/[^/?#]+\/library\.json(?=$|[?#])/i;
  const owner = userId.trim();
  return owner && pattern.test(url) ? url.replace(pattern, `/users/${owner}/library.json`) : null;
}

export function applyResourceTagOverride(tags: string[], override: ResourceTagOverride | undefined): string[] {
  if (!override) {
    return tags;
  }

  const removed = new Set(override.removed);
  return Array.from(new Set([...tags.filter((tag) => !removed.has(tag)), ...override.added]));
}

/** The smallest override that turns `publisherTags` into `nextTags`; null when nothing differs. */
export function buildResourceTagOverride(publisherTags: string[], nextTags: string[]): ResourceTagOverride | null {
  const publisher = new Set(publisherTags);
  const next = new Set(nextTags);
  const added = nextTags.filter((tag) => !publisher.has(tag)).sort();
  const removed = publisherTags.filter((tag) => !next.has(tag)).sort();
  return added.length > 0 || removed.length > 0 ? { added, removed } : null;
}

export function normalizeDisabledSourceItems(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(
    value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  )).sort();
}

export function normalizeResourceTagOverrides(value: unknown): ResourceTagOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const readTags = (tags: unknown): string[] => Array.isArray(tags)
    ? Array.from(new Set(tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0))).sort()
    : [];

  const normalized: ResourceTagOverrides = {};
  for (const [key, override] of Object.entries(value as Record<string, unknown>)) {
    if (!key.trim() || !override || typeof override !== 'object') {
      continue;
    }

    const added = readTags((override as Partial<ResourceTagOverride>).added);
    const removed = readTags((override as Partial<ResourceTagOverride>).removed);
    if (added.length > 0 || removed.length > 0) {
      normalized[key] = { added, removed };
    }
  }

  return normalized;
}

export function normalizeTimestampMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const normalized: Record<string, number> = {};
  for (const [key, stamp] of Object.entries(value as Record<string, unknown>)) {
    if (key.trim() && typeof stamp === 'number' && Number.isFinite(stamp)) {
      normalized[key.trim()] = stamp;
    }
  }

  return normalized;
}

/**
 * Translation ids hidden by the user. Translations with the same id merge across libraries, so an
 * item-level disable applies to that id everywhere; a type-level disable applies to the library that
 * supplied the merged translation.
 */
export function computeDisabledTranslationIds(
  translations: Array<{ id: string; configuredSourceUrl?: string }>,
  sourceUrls: string[],
  disabledSourceItems: string[]
): Set<string> {
  const disabled = new Set<string>();
  const disabledTypeLibraries = new Set<string>();

  for (const key of disabledSourceItems) {
    const parsed = parseSourceItemKey(key);
    if (!parsed) {
      continue;
    }

    if (parsed.kind === 'translation') {
      disabled.add(parsed.rest);
    } else if (parsed.kind === 'type' && parsed.rest === 'translation') {
      disabledTypeLibraries.add(parsed.libraryKey);
    }
  }

  if (disabledTypeLibraries.size > 0) {
    for (const translation of translations) {
      if (disabledTypeLibraries.has(resolveLibraryKey(translation.configuredSourceUrl, sourceUrls))) {
        disabled.add(translation.id);
      }
    }
  }

  return disabled;
}

export function isResourceDisabled(
  disabledSet: ReadonlySet<string>,
  libraryKey: string,
  resourceKey: string
): boolean {
  return disabledSet.has(typeItemKey(libraryKey, 'resource')) || disabledSet.has(resourceItemKey(libraryKey, resourceKey));
}

export function isHyperlinkDisabled(disabledSet: ReadonlySet<string>, libraryKey: string, url: string): boolean {
  return disabledSet.has(typeItemKey(libraryKey, 'hyperlink')) || disabledSet.has(hyperlinkItemKey(libraryKey, url));
}

export function hasSourcePreferences(preferences: SourcePreferences | undefined): preferences is SourcePreferences {
  return Boolean(preferences)
    && ((preferences as SourcePreferences).disabledSourceItems.length > 0
      || Object.keys((preferences as SourcePreferences).resourceTagOverrides).length > 0);
}

export function prettifySourceUrl(urlText: string): string {
  try {
    const parsed = new URL(urlText);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const filename = segments.pop() ?? '';
    const stem = filename.replace(/\.[^.]+$/, '');
    // Generic filenames (library.json, resources.json) say less than the folder or host they live in.
    const genericStems = new Set(['library', 'resources', 'translations', 'hyperlinks', 'index']);
    const label = stem && !genericStems.has(stem.toLowerCase()) ? stem : (segments.pop() ?? parsed.hostname);
    return label
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  } catch {
    return urlText;
  }
}

function hashText(value: string): string {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}
