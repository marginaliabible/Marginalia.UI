import MiniSearch from 'minisearch';
import type { HelpSearchDocument, HelpSearchIndex } from '../models/help';
import { parseSearchQuery, textContainsAllPhrases, type ParsedSearchQuery } from './searchQueryParser';

export interface HelpSearchHit {
  id: string;
  title: string;
  section: string;
  snippet: string;
  headingSlug?: string;
}

const SNIPPET_RADIUS = 60;

function collectMatchNeedles(parsed: ParsedSearchQuery): string[] {
  if (parsed.phrases.length > 0) {
    return parsed.phrases.map((phrase) => phrase.toLowerCase());
  }

  return parsed.indexQuery
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function buildSnippet(body: string, parsed: ParsedSearchQuery): string {
  const normalizedBody = body.replace(/\s+/g, ' ').trim();
  if (!normalizedBody) {
    return '';
  }

  const needles = collectMatchNeedles(parsed);
  const lower = normalizedBody.toLowerCase();
  let matchIndex = -1;
  for (const needle of needles) {
    const index = lower.indexOf(needle);
    if (index >= 0) {
      matchIndex = index;
      break;
    }
  }

  if (matchIndex < 0) {
    return normalizedBody.slice(0, SNIPPET_RADIUS * 2).trim();
  }

  const start = Math.max(0, matchIndex - SNIPPET_RADIUS);
  const end = Math.min(normalizedBody.length, matchIndex + SNIPPET_RADIUS);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < normalizedBody.length ? '…' : '';
  return `${prefix}${normalizedBody.slice(start, end).trim()}${suffix}`;
}

function matchHeadingSlug(doc: HelpSearchDocument, parsed: ParsedSearchQuery): string | undefined {
  const needles = collectMatchNeedles(parsed);
  if (needles.length === 0) {
    return undefined;
  }

  for (let index = 0; index < doc.headings.length; index += 1) {
    const heading = doc.headings[index] ?? '';
    if (parsed.phrases.length > 0) {
      if (textContainsAllPhrases(heading, parsed.phrases)) {
        return doc.headingSlugs?.[index];
      }
      continue;
    }

    const lowerHeading = heading.toLowerCase();
    if (needles.some((needle) => lowerHeading.includes(needle))) {
      return doc.headingSlugs?.[index];
    }
  }
  return undefined;
}

function documentContainsPhrases(doc: HelpSearchDocument, phrases: readonly string[]): boolean {
  if (textContainsAllPhrases(doc.title, phrases)) {
    return true;
  }
  if (textContainsAllPhrases(doc.section, phrases)) {
    return true;
  }
  if (doc.headings.some((heading) => textContainsAllPhrases(heading, phrases))) {
    return true;
  }
  return textContainsAllPhrases(doc.body, phrases);
}

class HelpSearchService {
  private index: MiniSearch<HelpSearchDocument> | null = null;
  private documentsById = new Map<string, HelpSearchDocument>();

  load(searchIndex: HelpSearchIndex): void {
    const index = new MiniSearch<HelpSearchDocument>({
      fields: ['title', 'section', 'headings', 'body'],
      storeFields: ['title', 'section', 'headings', 'headingSlugs', 'body'],
      searchOptions: {
        boost: { title: 4, headings: 2, section: 1.5, body: 1 },
        // Require every query term so multi-word searches stay on-topic.
        combineWith: 'AND',
        prefix: true,
        // Fuzzy only for longer tokens — short fuzzy matches (e.g. processing→pressing) are noisy.
        fuzzy: (term) => (term.length >= 7 ? 0.15 : 0),
      },
    });

    index.addAll(searchIndex.documents);
    this.index = index;
    this.documentsById = new Map(searchIndex.documents.map((doc) => [doc.id, doc]));
  }

  clear(): void {
    this.index = null;
    this.documentsById.clear();
  }

  isReady(): boolean {
    return this.index !== null;
  }

  search(queryInput: string, limit = 20): HelpSearchHit[] {
    const parsed = parseSearchQuery(queryInput);
    if (!parsed.indexQuery || !this.index) {
      return [];
    }

    const hasPhrases = parsed.phrases.length > 0;
    let results;
    try {
      results = this.index.search(parsed.indexQuery, {
        // Phrase queries need exact consecutive text; skip fuzzy/prefix expansion.
        ...(hasPhrases ? { fuzzy: 0, prefix: false } : {}),
        ...(hasPhrases
          ? {
              filter: (result) => {
                const doc = this.documentsById.get(String(result.id));
                return doc ? documentContainsPhrases(doc, parsed.phrases) : false;
              },
            }
          : {}),
      });
    } catch {
      // MiniSearch throws when all query tokens are filtered out.
      results = [];
    }

    // Help corpora are small: if a quoted phrase yields no indexed hits, scan docs
    // so literal substrings still match (punctuation / tokenization edge cases).
    if (hasPhrases && results.length === 0) {
      return [...this.documentsById.values()]
        .filter((doc) => documentContainsPhrases(doc, parsed.phrases))
        .slice(0, limit)
        .map((doc) => ({
          id: doc.id,
          title: doc.title,
          section: doc.section,
          snippet: buildSnippet(doc.body, parsed),
          headingSlug: matchHeadingSlug(doc, parsed),
        }));
    }

    return results.slice(0, limit).flatMap((result) => {
      const doc = this.documentsById.get(String(result.id));
      if (!doc) {
        return [];
      }
      return [{
        id: doc.id,
        title: doc.title,
        section: doc.section,
        snippet: buildSnippet(doc.body, parsed),
        headingSlug: matchHeadingSlug(doc, parsed),
      }];
    });
  }
}

export const helpSearchService = new HelpSearchService();
