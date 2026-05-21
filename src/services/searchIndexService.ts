import MiniSearch, { type SearchOptions } from 'minisearch';
import type { BibleData } from '../models/bible';
import { SearchMatch } from '../models/bible';
import { normalizeTerm } from './searchNormalizer';

interface VerseDocument {
  id: string;
  book: string;
  chapter: number;
  verse: number;
  text: string;
}

export interface IndexedSearchResult {
  matches: SearchMatch[];
  total: number;
}

const INDEX_SEARCH_LIMIT = 5000;

/**
 * Controls how aggressively MiniSearch tolerates near-stem distance between
 * indexed and query tokens. A value of 0.15 allows a difference of ~1
 * character per 7-character term, which bridges stems like "liv" vs "live"
 * that arise after suffix stripping.
 */
const FUZZY_TOLERANCE = 0.15;

class SearchIndexService {
  private readonly indexes = new Map<string, MiniSearch<VerseDocument>>();

  /**
   * Builds and caches a MiniSearch index for one translation.
   * Both indexed text and query terms are processed by the same normalizer
   * so archaic KJV forms ("thy soul prospereth") and modern equivalents
   * ("your soul prospers") reduce to identical token sets.
   */
  buildIndex(translationId: string, bible: BibleData, language?: string | string[]): void {
    const lang = language;

    const index = new MiniSearch<VerseDocument>({
      fields: ['text'],
      storeFields: ['book', 'chapter', 'verse', 'text'],
      processTerm: (term) => normalizeTerm(term, lang),
    });

    const docs: VerseDocument[] = [];
    for (const book of bible.books) {
      for (const chapter of book.chapters) {
        for (const verse of chapter.verses) {
          if (verse.text) {
            docs.push({
              id: `${translationId}\x00${book.name}\x00${chapter.chapter}\x00${verse.verse}`,
              book: book.name,
              chapter: chapter.chapter,
              verse: verse.verse,
              text: verse.text,
            });
          }
        }
      }
    }

    index.addAll(docs);
    this.indexes.set(translationId, index);
  }

  hasIndex(translationId: string): boolean {
    return this.indexes.has(translationId);
  }

  /**
   * Searches a translation by query. Lazily builds the index on first call.
   *
   * Uses AND semantics so every normalized query term must appear in a
   * matching verse. Falls back to null when the query reduces to no usable
   * tokens (e.g. stopword-only queries), allowing the caller to fall back to
   * the legacy substring search.
   */
  search(
    query: string,
    translationId: string,
    bible: BibleData,
    language?: string | string[],
  ): IndexedSearchResult | null {
    if (!this.hasIndex(translationId)) {
      this.buildIndex(translationId, bible, language);
    }

    const index = this.indexes.get(translationId);
    if (!index) {
      return null;
    }

    const searchOptions: SearchOptions = {
      fuzzy: FUZZY_TOLERANCE,
      combineWith: 'AND',
    };

    let results;
    try {
      results = index.search(query, searchOptions);
    } catch {
      // MiniSearch throws when all query tokens are filtered out
      return null;
    }

    if (results.length === 0) {
      return { matches: [], total: 0 };
    }

    const total = results.length;
    const matches = results.slice(0, INDEX_SEARCH_LIMIT).map(
      (result) =>
        new SearchMatch(
          result['book'] as string,
          result['chapter'] as number,
          result['verse'] as number,
          result['text'] as string,
        ),
    );

    return { matches, total };
  }

  /** Evicts a cached index, e.g. when a translation is reloaded. */
  evict(translationId: string): void {
    this.indexes.delete(translationId);
  }
}

export const searchIndexService = new SearchIndexService();
