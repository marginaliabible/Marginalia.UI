import MiniSearch, { type SearchOptions } from 'minisearch';
import type { BibleData } from '../models/bible';
import { SearchMatch } from '../models/bible';
import { markupFlagsFromBible, stripVerseMarkers } from '../utils/verseMarkup';
import { normalizeTerm } from './searchNormalizer';
import { parseSearchQuery, textContainsAllPhrases } from './searchQueryParser';

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
const DEFAULT_CACHED_INDEXES = 2;

/**
 * Fractional fuzzy tolerance for longer single-word queries.
 *
 * MiniSearch rounds fractional edit-distance to the nearest integer, so we
 * pair this with a short-term cutoff to avoid broad 1-character substitutions
 * on words like "ponder" -> "yonder".
 */
const FUZZY_TOLERANCE = 0.05;
const MIN_FUZZY_TERM_LENGTH = 7;

/** True when at least one query token survives language-specific normalization. */
function hasSearchableTokens(indexQuery: string, language?: string | string[]): boolean {
  const tokens = indexQuery.toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean);
  return tokens.some((token) => normalizeTerm(token, language) !== null);
}

class SearchIndexService {
  private readonly indexes = new Map<string, MiniSearch<VerseDocument>>();
  private indexCacheLimit = DEFAULT_CACHED_INDEXES;

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

    const markupFlags = markupFlagsFromBible(bible);
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
              text: stripVerseMarkers(verse.text, markupFlags),
            });
          }
        }
      }
    }

    index.addAll(docs);
    this.touchIndex(translationId, index);
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
    const parsed = parseSearchQuery(query);
    if (!parsed.indexQuery) {
      return null;
    }

    const hasPhrases = parsed.phrases.length > 0;
    // Stopword-only phrases (e.g. "it is") leave MiniSearch with no tokens.
    // Return null so the caller can fall back to literal substring search.
    if (hasPhrases && !hasSearchableTokens(parsed.indexQuery, language)) {
      return null;
    }

    if (!this.hasIndex(translationId)) {
      this.buildIndex(translationId, bible, language);
    }

    const index = this.indexes.get(translationId);
    if (!index) {
      return null;
    }
    this.touchIndex(translationId, index);

    const searchOptions: SearchOptions = {
      // Phrase queries need exact consecutive text; skip fuzzy candidate expansion.
      fuzzy: hasPhrases
        ? 0
        : (term) => (term.length >= MIN_FUZZY_TERM_LENGTH ? FUZZY_TOLERANCE : 0),
      combineWith: 'AND',
      ...(hasPhrases
        ? {
            filter: (result) =>
              textContainsAllPhrases(String(result['text'] ?? ''), parsed.phrases),
          }
        : {}),
    };

    let results;
    try {
      results = index.search(parsed.indexQuery, searchOptions);
    } catch {
      // MiniSearch throws when all query tokens are filtered out
      // (e.g. stopword-only phrases). Let the caller use substring fallback.
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

  setIndexCacheLimit(limit: number): void {
    this.indexCacheLimit = Math.max(1, Math.floor(limit) || 1);
    this.pruneIndexes();
  }

  private touchIndex(translationId: string, index: MiniSearch<VerseDocument>): void {
    if (this.indexes.has(translationId)) {
      this.indexes.delete(translationId);
    }

    this.indexes.set(translationId, index);

    this.pruneIndexes();
  }

  private pruneIndexes(): void {
    while (this.indexes.size > this.indexCacheLimit) {
      const oldestId = this.indexes.keys().next().value as string | undefined;
      if (!oldestId) {
        break;
      }
      this.indexes.delete(oldestId);
    }
  }
}

export const searchIndexService = new SearchIndexService();
