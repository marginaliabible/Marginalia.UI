import MiniSearch from 'minisearch';
import type { HelpSearchDocument, HelpSearchIndex } from '../models/help';

export interface HelpSearchHit {
  id: string;
  title: string;
  section: string;
  snippet: string;
  headingSlug?: string;
}

const SNIPPET_RADIUS = 60;

function buildSnippet(body: string, query: string): string {
  const normalizedBody = body.replace(/\s+/g, ' ').trim();
  if (!normalizedBody) {
    return '';
  }

  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);

  const lower = normalizedBody.toLowerCase();
  let matchIndex = -1;
  for (const term of terms) {
    const index = lower.indexOf(term);
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

function matchHeadingSlug(doc: HelpSearchDocument, query: string): string | undefined {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return undefined;
  }

  for (let index = 0; index < doc.headings.length; index += 1) {
    const heading = doc.headings[index]?.toLowerCase() ?? '';
    if (terms.some((term) => heading.includes(term))) {
      return doc.headingSlugs?.[index];
    }
  }
  return undefined;
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
        prefix: true,
        fuzzy: 0.15,
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
    const query = queryInput.trim();
    if (!query || !this.index) {
      return [];
    }

    const results = this.index.search(query);
    return results.slice(0, limit).flatMap((result) => {
      const doc = this.documentsById.get(String(result.id));
      if (!doc) {
        return [];
      }
      return [{
        id: doc.id,
        title: doc.title,
        section: doc.section,
        snippet: buildSnippet(doc.body, query),
        headingSlug: matchHeadingSlug(doc, query),
      }];
    });
  }
}

export const helpSearchService = new HelpSearchService();
