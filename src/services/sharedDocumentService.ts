import { getCanonicalBookName } from '../utils/book-aliases';
import { canonicalBookFromRefToken } from '../utils/osisBookCodes';
import { buildPageVersesJsonUrl, parsePageVerseEntries, parseReferenceRef } from '../utils/pageVerseReferences';
import { buildMarkupDocumentShellUrl, isPlainObject, readString } from '../utils/resourceLibraryConfig';
import { fetchStorageAware, isStorageGatewayUrl } from './storageAuthenticatedFetch';
import { getConfiguredStorageBaseUrl } from './storageEnv';

const DEFAULT_STORAGE_BASE_URL = 'https://storage.marginaliabible.com';
const SHARED_DOCUMENT_HASH_PATTERN = /^[0-9a-f]{64}$/i;
const SHARED_DOCUMENT_TITLE_MAX_LENGTH = 200;

export const SHARED_DOCUMENT_FALLBACK_TITLE = 'Shared document';

export type SharedDocumentLookup =
  | { status: 'found'; pagesUrl: string; shellUrl: string; title: string }
  /** The gateway has no rendered package for this hash (deleted, or never rendered). */
  | { status: 'not-found' }
  /** No storage session: the visitor isn't signed in, or the session couldn't be refreshed. */
  | { status: 'unauthorized' }
  | { status: 'error' };

/** Where a shared document's title comes from; swap the implementation without touching the lookup. */
export type SharedDocumentTitleResolver = (source: {
  packageUrl: string;
  shellHtml: string;
}) => Promise<string>;

/** The lowercase content hash when `doc` is a SHA-256 hex digest; storage keys are lowercase. */
export function normalizeSharedDocumentHash(doc: string): string | null {
  const trimmed = doc.trim();
  return SHARED_DOCUMENT_HASH_PATTERN.test(trimmed) ? trimmed.toLowerCase() : null;
}

/** The storage gateway the user's own libraries live on, so dev/staging gateways keep their own documents. */
export function resolveSharedDocumentStorageBaseUrl(sourceUrls: readonly string[]): string {
  for (const sourceUrl of sourceUrls) {
    if (isStorageGatewayUrl(sourceUrl)) {
      return new URL(sourceUrl).origin;
    }
  }
  return getConfiguredStorageBaseUrl() || DEFAULT_STORAGE_BASE_URL;
}

/** `documents/{hh}/{hh}/{hash}/`, the package root under the storage gateway. */
export function buildSharedDocumentPackageUrl(hash: string, storageBaseUrl: string): string {
  return `${storageBaseUrl.replace(/\/$/, '')}/documents/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}/`;
}

/**
 * Looks for a rendered document package in storage by content hash. The shell fetched here is the
 * one the viewer loads next, so the gateway's cache headers make the second fetch free.
 */
export async function findSharedDocument(
  hash: string,
  sourceUrls: readonly string[],
  resolveTitle: SharedDocumentTitleResolver = resolveSharedDocumentTitle
): Promise<SharedDocumentLookup> {
  const packageUrl = buildSharedDocumentPackageUrl(hash, resolveSharedDocumentStorageBaseUrl(sourceUrls));
  const pagesUrl = `${packageUrl}pages/`;
  const shellUrl = buildMarkupDocumentShellUrl(pagesUrl);

  let response: Response;
  try {
    response = await fetchStorageAware(shellUrl);
  } catch {
    return { status: 'error' };
  }

  if (response.status === 404) {
    return { status: 'not-found' };
  }
  if (response.status === 401 || response.status === 403) {
    return { status: 'unauthorized' };
  }
  if (!response.ok) {
    return { status: 'error' };
  }

  const shellHtml = await response.text().catch(() => '');
  const title = await resolveTitle({ packageUrl, shellHtml }).catch(() => SHARED_DOCUMENT_FALLBACK_TITLE);
  return { status: 'found', pagesUrl, shellUrl, title };
}

/** Package `meta.json` first, then whatever the rendered content names itself, else a generic title. */
export const resolveSharedDocumentTitle: SharedDocumentTitleResolver = async ({ packageUrl, shellHtml }) => (
  await readPackageMetaTitle(packageUrl)
  ?? readContentTitle(shellHtml)
  ?? SHARED_DOCUMENT_FALLBACK_TITLE
);

/** `{ "title": string, "pageCount"?: number }`; a missing file (404) is expected. */
export async function readPackageMetaTitle(packageUrl: string): Promise<string | null> {
  try {
    const response = await fetchStorageAware(`${packageUrl}meta.json`);
    if (!response.ok) {
      return null;
    }
    const payload: unknown = await response.json();
    return isPlainObject(payload) ? cleanTitle(readString(payload['title'])) : null;
  } catch {
    return null;
  }
}

/** The shell's `<title>`, else its first heading. pdf2htmlEX output usually has neither. */
export function readContentTitle(html: string): string | null {
  for (const pattern of [/<title\b[^>]*>([\s\S]*?)<\/title>/i, /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i]) {
    const title = cleanTitle(htmlToText(html.match(pattern)?.[1] ?? ''));
    if (title) {
      return title;
    }
  }
  return null;
}

function htmlToText(fragment: string): string {
  if (!fragment.trim()) {
    return '';
  }
  if (typeof DOMParser === 'undefined') {
    return fragment.replace(/<[^>]*>/g, ' ');
  }
  return new DOMParser().parseFromString(`<!DOCTYPE html><body>${fragment}</body>`, 'text/html').body.textContent ?? '';
}

/** Storage content is untrusted display text: one line, no control or bidi-override characters, length-capped. */
function cleanTitle(value: string | undefined): string | null {
  const cleaned = Array.from((value ?? '').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ').replace(/\s+/g, ' ').trim())
    .slice(0, SHARED_DOCUMENT_TITLE_MAX_LENGTH)
    .join('')
    .trim();
  return cleaned ? cleaned : null;
}

/** Citation texts on `page` that cite any of `verses` in book/chapter, from the package's `pageN.verses.json`. */
export async function findSharedDocumentPageRaws(
  pagesUrl: string,
  page: number,
  reference: { book: string; chapter: number; verses: readonly number[] }
): Promise<string[]> {
  const book = getCanonicalBookName(reference.book) ?? reference.book;
  const verses = new Set(reference.verses);

  try {
    const response = await fetchStorageAware(buildPageVersesJsonUrl(pagesUrl, page));
    if (!response.ok) {
      return [];
    }

    const raws = new Set<string>();
    for (const entry of parsePageVerseEntries(await response.json())) {
      const parsed = parseReferenceRef(entry.ref);
      if (parsed
        && parsed.chapter === reference.chapter
        && verses.has(parsed.verse)
        && canonicalBookFromRefToken(parsed.bookToken) === book) {
        raws.add(entry.raw);
      }
    }
    return Array.from(raws);
  } catch {
    return [];
  }
}
