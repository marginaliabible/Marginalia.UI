import MiniSearch from 'minisearch';
import type { FederatedProvider } from '../models/bible';
import { normalizeEnglishTerm } from './searchNormalizer';
import {
  DEFAULT_DOCUMENT_STORE_ADDRESS,
  buildDocumentStorePageUrl,
  buildFetchUrlCandidates,
  inferSourceFileKindFromPayload,
  inferSourceFileKindFromUrl,
  readCloudSyncProviderFromResourcesUrl,
  readDocumentViewerKind,
  readLibrarySourceAddresses,
  readResourceDocumentEntry,
  readString,
  resolveAddress,
  validateDocumentsFile,
  validateLibraryFile,
  validateResourcesFile,
  type DocumentViewerKind,
  type LibraryFileLike,
  type ResourceDocumentEntry,
  type ResourcesFileLike,
} from '../utils/resourceLibraryConfig';
import { fetchStorageAware } from './storageAuthenticatedFetch';

const SEARCH_LIMIT = 5000;
const DEFAULT_LIBRARY_PATH = 'data/library.json';
const SEARCH_SNAPSHOT_STORAGE_PREFIX = 'marginalia:resource-library-search:';

export interface ResourceDocumentTitleSearchMatch {
  id: string;
  libraryId: string;
  libraryLabel: string;
  documentId: string;
  cloudProvider: FederatedProvider | null;
  title: string;
  tags: string[];
  url: string;
  viewer: DocumentViewerKind;
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
  resourcesUrl: string;
  documentManifestAddress: string;
  documentStoreAddress: string;
  documentViewer: DocumentViewerKind | null;
  documents?: ResourceLibraryIndexDoc[];
}

interface ResourceLibraryIndexDoc extends ResourceDocumentEntry {
  id: string;
  libraryId: string;
  libraryLabel: string;
  resourcesUrl: string;
  documentStoreAddress: string;
  documentViewer: DocumentViewerKind | null;
}

interface ResourceLibrarySearchSnapshot {
  modifiedOn: string;
  candidates: ResourceLibraryCandidate[];
}

const librarySearchSnapshots = new Map<string, ResourceLibrarySearchSnapshot>();

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
    storeFields: ['title', 'documentId', 'libraryId', 'libraryLabel', 'tags', 'resourcesUrl', 'documentStoreAddress', 'documentViewer', 'hash'],
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

  // Cloud-synced documents are listed before processing assigns a hash; hash-addressed stores can't open them yet.
  const openableResults = results.filter((result) =>
    typeof result['hash'] === 'string' || !/\{\{?hash\b/.test(result['documentStoreAddress'] as string)
  );
  const total = openableResults.length;
  const matches = openableResults.slice(0, SEARCH_LIMIT).map((result): ResourceDocumentTitleSearchMatch => {
    const title = result['title'] as string;
    const documentId = result['documentId'] as string;
    const libraryId = result['libraryId'] as string;
    const libraryLabel = result['libraryLabel'] as string;
    const tags = Array.isArray(result['tags'])
      ? result['tags'].filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
      : [];
    const resourcesUrl = result['resourcesUrl'] as string;
    const documentStoreAddress = result['documentStoreAddress'] as string;
    const hash = typeof result['hash'] === 'string' ? (result['hash'] as string) : undefined;
    const viewer = readDocumentViewerKind(result['documentViewer']) ?? 'pdf';

    return {
      id: `${libraryId}-${documentId}`,
      libraryId,
      libraryLabel,
      documentId,
      cloudProvider: readCloudSyncProviderFromResourcesUrl(resourcesUrl),
      title,
      tags,
      url: buildDocumentStorePageUrl(documentStoreAddress, resourcesUrl, { documentId, hash }, 1),
      viewer,
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
  const libraryUrls = Array.from(new Set([
    DEFAULT_LIBRARY_PATH,
    ...sourceUrls.map((entry) => entry.trim()).filter((entry) => entry.length > 0),
  ])).sort();

  const settled = await Promise.allSettled(libraryUrls.map(async (libraryUrl) => {
    const payload = await fetchJsonPayload(libraryUrl);
    return await extractResourceLibraryCandidates(payload, libraryUrl);
  }));

  const candidates = new Map<string, ResourceLibraryCandidate>();

  for (const result of settled) {
    if (result.status !== 'fulfilled') {
      continue;
    }

    for (const candidate of result.value) {
      candidates.set(candidate.resourcesUrl, candidate);
    }
  }

  return Array.from(candidates.values());
}

async function loadResourceLibraryDocuments(candidates: ResourceLibraryCandidate[]): Promise<ResourceLibraryIndexDoc[]> {
  const settled = await Promise.allSettled(candidates.map(async (candidate) => {
    if (candidate.documents) {
      return candidate.documents;
    }

    return await loadCandidateDocuments(candidate);
  }));

  const documents: ResourceLibraryIndexDoc[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      documents.push(...result.value);
    }
  }

  return documents;
}

async function extractResourceLibraryCandidates(payload: unknown, sourceUrl: string): Promise<ResourceLibraryCandidate[]> {
  const filenameKind = inferSourceFileKindFromUrl(sourceUrl);
  const kind = filenameKind ?? inferSourceFileKindFromPayload(payload);

  if (kind === 'resources') {
    const resources = validateResourcesFile(payload, sourceUrl);
    return [buildCandidate(sourceUrl, resources, undefined)];
  }

  if (kind !== 'library') {
    return [];
  }

  const library = validateLibraryFile(payload, sourceUrl);
  const explicitSources = readLibrarySourceAddresses(library);
  const sourceAddresses = explicitSources.length > 0 ? explicitSources : ['resources.json', 'translations.json'];

  const children = await Promise.all(sourceAddresses.map(async (address) => {
    const childUrl = resolveAddress(address, sourceUrl);
    const childPayload = await fetchJsonPayload(childUrl).catch(() => null);
    if (childPayload === null) {
      return null;
    }

    const childKind = inferSourceFileKindFromUrl(childUrl) ?? inferSourceFileKindFromPayload(childPayload);
    if (childKind !== 'resources') {
      return null;
    }

    const resources = validateResourcesFile(childPayload, childUrl);
    return { candidate: buildCandidate(childUrl, resources, library), modifiedOn: readString(resources.modifiedOn) ?? '' };
  }));
  const resolvedChildren = children.filter((child): child is NonNullable<typeof child> => child !== null);
  const candidates = resolvedChildren.map((child) => child.candidate);

  // Cloud sync rewrites documents.json and resources.json (e.g. filling in hashes) without touching
  // library.json, so the snapshot must also track each child resources.json modifiedOn.
  const libraryModifiedOn = readString(library.modifiedOn);
  const modifiedOn = libraryModifiedOn
    ? [libraryModifiedOn, ...resolvedChildren.map((child) => `${child.candidate.resourcesUrl}@${child.modifiedOn}`)].join('|')
    : undefined;
  const cached = modifiedOn
    ? librarySearchSnapshots.get(sourceUrl) ?? readLibrarySearchSnapshot(sourceUrl)
    : undefined;
  if (cached && cached.modifiedOn === modifiedOn) {
    librarySearchSnapshots.set(sourceUrl, cached);
    return cached.candidates;
  }

  const candidatesWithDocuments = await Promise.all(candidates.map(async (candidate) => ({
    ...candidate,
    documents: await loadCandidateDocuments(candidate),
  })));

  if (modifiedOn) {
    const snapshot = { modifiedOn, candidates: candidatesWithDocuments };
    librarySearchSnapshots.set(sourceUrl, snapshot);
    writeLibrarySearchSnapshot(sourceUrl, snapshot);
  }

  return candidatesWithDocuments;
}

function readLibrarySearchSnapshot(sourceUrl: string): ResourceLibrarySearchSnapshot | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(buildLibrarySearchSnapshotKey(sourceUrl));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as ResourceLibrarySearchSnapshot;
    if (!parsed || typeof parsed.modifiedOn !== 'string' || !Array.isArray(parsed.candidates)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function writeLibrarySearchSnapshot(sourceUrl: string, snapshot: ResourceLibrarySearchSnapshot): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(buildLibrarySearchSnapshotKey(sourceUrl), JSON.stringify(snapshot));
  } catch {
    // Search can still work without persisted title metadata.
  }
}

function buildLibrarySearchSnapshotKey(sourceUrl: string): string {
  return `${SEARCH_SNAPSHOT_STORAGE_PREFIX}${hashText(sourceUrl)}`;
}

async function loadCandidateDocuments(candidate: ResourceLibraryCandidate): Promise<ResourceLibraryIndexDoc[]> {
  const documentsPayload = await fetchJsonPayload(candidate.documentManifestAddress);
  const documentsFile = validateDocumentsFile(documentsPayload, candidate.documentManifestAddress);
  const documents: ResourceLibraryIndexDoc[] = [];

  for (const item of documentsFile.documents) {
    const entry = readResourceDocumentEntry(item);
    if (!entry) {
      continue;
    }

    documents.push({
      ...entry,
      id: `${candidate.id}\x00${entry.documentId}`,
      libraryId: candidate.id,
      libraryLabel: candidate.label,
      resourcesUrl: candidate.resourcesUrl,
      documentStoreAddress: candidate.documentStoreAddress,
      documentViewer: candidate.documentViewer,
    });
  }

  return documents;
}

function buildCandidate(resourcesUrl: string, resources: ResourcesFileLike, library: LibraryFileLike | undefined): ResourceLibraryCandidate {
  const label = readString(resources.name) ?? readString(library?.name) ?? prettifyLabel(resourcesUrl) ?? 'Resource Library';
  const id = slugify(`${label}-${hashText(resourcesUrl).slice(0, 8)}`) || hashText(resourcesUrl).slice(0, 8);
  const documentManifestAddress = resolveAddress(readString(resources.documentManifestAddress) ?? 'documents.json', resourcesUrl);
  const documentStoreAddress = readString(resources.documentStoreAddress)
    ?? readString(library?.documentStoreAddress)
    ?? DEFAULT_DOCUMENT_STORE_ADDRESS;
  const documentViewer = readDocumentViewerKind(resources.documentViewer)
    ?? readDocumentViewerKind(library?.documentViewer);

  return { id, label, resourcesUrl, documentManifestAddress, documentStoreAddress, documentViewer };
}

async function fetchJsonPayload(sourceUrl: string): Promise<unknown> {
  const failures: string[] = [];

  for (const candidate of buildFetchUrlCandidates(sourceUrl)) {
    try {
      const response = await fetchStorageAware(candidate, { cache: 'no-store' });
      if (!response.ok) {
        failures.push(`${candidate} -> ${response.status}`);
        continue;
      }

      return (await response.json()) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      failures.push(`${candidate} -> ${message}`);
    }
  }

  throw new Error(`Resource JSON unavailable at ${sourceUrl}: ${failures.join('; ')}`);
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