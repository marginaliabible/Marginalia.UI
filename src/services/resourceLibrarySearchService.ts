import MiniSearch from 'minisearch';
import { normalizeEnglishTerm } from './searchNormalizer';
import { buildDocumentPageUrl, isPlainObject, readResourceLibraryConnection, readString } from '../utils/resourceLibraryConfig';

const SEARCH_LIMIT = 5000;
const DEFAULT_SETTINGS_PATH = 'data/bibles/_settings.json';

export interface ResourceDocumentTitleSearchMatch {
  id: string;
  libraryId: string;
  libraryLabel: string;
  documentId: string;
  title: string;
  tags: string[];
  url: string;
}

export interface ResourceDocumentTitleSearchResultSet {
  query: string;
  matches: ResourceDocumentTitleSearchMatch[];
  total: number;
  limited: boolean;
}

interface ResourceLibraryCandidate {
  id: string;
  label: string;
  configUrl: string;
}

interface ResourceLibraryConfigPayload {
  source?: unknown;
  baseUrl?: unknown;
  documentUrlTemplate?: unknown;
  label?: unknown;
  id?: unknown;
}

interface ResourceLibraryDocumentEntry {
  documentId?: unknown;
  title?: unknown;
  tags?: unknown;
}

interface ResourceLibraryIndexDoc {
  id: string;
  title: string;
  documentId: string;
  libraryId: string;
  libraryLabel: string;
  tags: string[];
  baseUrl: string;
  documentUrlTemplate: string;
}

export async function searchResourceDocumentTitles(
  queryInput: string,
  sourceUrls: string[] = []
): Promise<ResourceDocumentTitleSearchResultSet | null> {
  const query = queryInput.trim();
  if (!query) {
    return null;
  }

  const candidates = await loadResourceLibraryCandidates(sourceUrls);
  if (candidates.length === 0) {
    return {
      query,
      matches: [],
      total: 0,
      limited: false,
    };
  }

  const documents = await loadResourceLibraryDocuments(candidates);
  if (documents.length === 0) {
    return {
      query,
      matches: [],
      total: 0,
      limited: false,
    };
  }

  const index = new MiniSearch<ResourceLibraryIndexDoc>({
    fields: ['title'],
    storeFields: ['title', 'documentId', 'libraryId', 'libraryLabel', 'tags', 'baseUrl', 'documentUrlTemplate'],
    processTerm: (term: string) => normalizeEnglishTerm(term),
  });

  index.addAll(documents);

  let results;
  try {
    results = index.search(query, {
      fuzzy: (term: string) => (term.length >= 7 ? 0.05 : 0),
      combineWith: 'AND',
    });
  } catch {
    return {
      query,
      matches: [],
      total: 0,
      limited: false,
    };
  }

  const total = results.length;
  const matches = results.slice(0, SEARCH_LIMIT).map((result) => {
    const title = result['title'] as string;
    const documentId = result['documentId'] as string;
    const libraryId = result['libraryId'] as string;
    const libraryLabel = result['libraryLabel'] as string;
    const tags = Array.isArray(result['tags'])
      ? result['tags'].filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
      : [];
    const baseUrl = result['baseUrl'] as string;
    const documentUrlTemplate = result['documentUrlTemplate'] as string;

    return {
      id: `${libraryId}-${documentId}`,
      libraryId,
      libraryLabel,
      documentId,
      title,
      tags,
      url: buildDocumentPageUrl(documentUrlTemplate, baseUrl, documentId, 1),
    };
  });

  return {
    query,
    matches,
    total,
    limited: matches.length < total,
  };
}

async function loadResourceLibraryCandidates(sourceUrls: string[]): Promise<ResourceLibraryCandidate[]> {
  const settingsUrls = Array.from(new Set([
    DEFAULT_SETTINGS_PATH,
    ...sourceUrls.map((entry) => entry.trim()).filter((entry) => entry.length > 0),
  ])).sort();

  const settled = await Promise.allSettled(settingsUrls.map(async (settingsUrl) => {
    const response = await fetch(settingsUrl, { cache: 'no-store' });
    if (!response.ok) {
      return [] as ResourceLibraryCandidate[];
    }

    const payload = await response.json() as unknown;
    return extractResourceLibraryCandidates(payload, settingsUrl);
  }));

  const candidates = new Map<string, ResourceLibraryCandidate>();

  for (const result of settled) {
    if (result.status !== 'fulfilled') {
      continue;
    }

    for (const candidate of result.value) {
      candidates.set(candidate.configUrl, candidate);
    }
  }

  return Array.from(candidates.values());
}

async function loadResourceLibraryDocuments(candidates: ResourceLibraryCandidate[]): Promise<ResourceLibraryIndexDoc[]> {
  const settled = await Promise.allSettled(candidates.map(async (candidate) => {
    const configResponse = await fetch(candidate.configUrl, { cache: 'no-store' });
    if (!configResponse.ok) {
      return [] as ResourceLibraryIndexDoc[];
    }

    const configPayload = await configResponse.json() as unknown;
    if (!isPlainObject(configPayload)) {
      return [] as ResourceLibraryIndexDoc[];
    }

    const config = configPayload as ResourceLibraryConfigPayload;
    const { baseUrl, documentUrlTemplate } = readResourceLibraryConnection(config, candidate.configUrl);

    const documentsResponse = await fetch(new URL('documents.json', candidate.configUrl).toString(), { cache: 'no-store' });
    if (!documentsResponse.ok) {
      return [] as ResourceLibraryIndexDoc[];
    }

    const documentsPayload = await documentsResponse.json() as unknown;
    if (!Array.isArray(documentsPayload)) {
      return [] as ResourceLibraryIndexDoc[];
    }

    const documents: ResourceLibraryIndexDoc[] = [];
    for (const item of documentsPayload) {
      if (!isPlainObject(item)) {
        continue;
      }

      const entry = item as ResourceLibraryDocumentEntry;
      const documentId = readString(entry.documentId);
      if (!documentId) {
        continue;
      }

      const tags = Array.isArray(entry.tags)
        ? entry.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
        : [];

      documents.push({
        id: `${candidate.id}\x00${documentId}`,
        title: readString(entry.title) ?? documentId,
        documentId,
        libraryId: candidate.id,
        libraryLabel: candidate.label,
        tags: Array.from(new Set(tags)),
        baseUrl,
        documentUrlTemplate,
      });
    }

    return documents;
  }));

  const documents: ResourceLibraryIndexDoc[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      documents.push(...result.value);
    }
  }

  return documents;
}

function extractResourceLibraryCandidates(payload: unknown, settingsUrl: string): ResourceLibraryCandidate[] {
  if (!isPlainObject(payload)) {
    return [];
  }

  const directConfig = isResourceLibraryConfigPayload(payload);
  if (directConfig) {
    return [buildCandidate(settingsUrl, settingsUrl, payload)];
  }

  const candidates: ResourceLibraryCandidate[] = [];
  for (const entry of collectEntryObjects(payload['resourceLibraries'])) {
    candidates.push(...buildCandidatesFromEntry(entry, settingsUrl));
  }

  for (const entry of collectEntryObjects(payload['artifacts'])) {
    candidates.push(...buildCandidatesFromEntry(entry, settingsUrl));
  }

  return candidates;
}

function buildCandidatesFromEntry(entry: Record<string, unknown>, settingsUrl: string): ResourceLibraryCandidate[] {
  const artifactType = readString(entry['artifactType'])?.toLowerCase();
  if (artifactType && artifactType !== 'resource-library') {
    return [];
  }

  const sourceUrl = readString(entry['location']) ?? readString(entry['source']) ?? readString(entry['url']);
  if (!sourceUrl) {
    return [];
  }

  return [buildCandidate(readString(entry['id']) ?? sourceUrl, resolveRelativeUrl(sourceUrl, settingsUrl), entry)];
}

function buildCandidate(idSeed: string, configUrl: string, entry: Record<string, unknown> | ResourceLibraryConfigPayload): ResourceLibraryCandidate {
  const label = readString((entry as Record<string, unknown>)['label']) ?? prettifyLabel(idSeed) ?? 'Resource Library';
  const id = readString(idSeed) ?? slugify(label) ?? hashText(configUrl).slice(0, 8);
  return { id, label, configUrl };
}

function collectEntryObjects(entries: unknown): Array<Record<string, unknown>> {
  if (!entries) {
    return [];
  }

  if (Array.isArray(entries)) {
    return entries.filter(isPlainObject);
  }

  if (isPlainObject(entries)) {
    return Object.entries(entries).flatMap(([id, raw]) => {
      if (!isPlainObject(raw)) {
        return [];
      }

      return [{ id, ...raw } as Record<string, unknown>];
    });
  }

  return [];
}

function resolveRelativeUrl(value: string, settingsUrl: string): string {
  try {
    return new URL(value, settingsUrl).toString();
  } catch {
    return value;
  }
}

function isResourceLibraryConfigPayload(value: unknown): value is ResourceLibraryConfigPayload {
  if (!isPlainObject(value)) {
    return false;
  }

  return (
    Object.prototype.hasOwnProperty.call(value, 'source')
    || Object.prototype.hasOwnProperty.call(value, 'baseUrl')
    || Object.prototype.hasOwnProperty.call(value, 'documentUrlTemplate')
  );
}

function prettifyLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  try {
    const parsed = new URL(trimmed);
    const filename = parsed.pathname.split('/').filter(Boolean).pop() ?? '';
    const stem = filename.replace(/\.[^.]+$/, '');
    if (stem) {
      return stem
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());
    }

    return parsed.hostname;
  } catch {
    return trimmed
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function hashText(value: string): string {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}