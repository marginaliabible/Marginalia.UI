/**
 * Parses search queries for quoted literal phrases.
 *
 * `"it is written"` → require those words consecutively (case-insensitive).
 * Unquoted terms keep normal token search behavior.
 */

const QUOTED_PHRASE_RE = /"([^"]+)"|“([^”]+)”/g;
const WRAPPED_QUERY_RE = /^["“„«]([\s\S]+)["”»]$/u;

export interface ParsedSearchQuery {
  /** Trimmed original query. */
  raw: string;
  /** Query text with quote marks removed, suitable for MiniSearch. */
  indexQuery: string;
  /** Literal phrases that must appear as consecutive substrings. */
  phrases: string[];
}

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const normalizePhraseHaystack = (value: string): string =>
  value.toLowerCase().replace(/\s+/g, ' ');

/**
 * Extracts quoted phrases and builds an index query with quote characters stripped.
 */
export function parseSearchQuery(input: string): ParsedSearchQuery {
  const raw = input.trim();
  if (!raw) {
    return { raw: '', indexQuery: '', phrases: [] };
  }

  const phrases: string[] = [];
  let indexQuery = raw
    .replace(QUOTED_PHRASE_RE, (_match, straight?: string, curly?: string) => {
      const phrase = collapseWhitespace(straight ?? curly ?? '');
      if (phrase) {
        phrases.push(phrase);
      }
      return phrase ? ` ${phrase} ` : ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();

  if (phrases.length === 0) {
    const wrapped = raw.match(WRAPPED_QUERY_RE);
    if (wrapped?.[1]) {
      const phrase = collapseWhitespace(wrapped[1]);
      if (phrase) {
        phrases.push(phrase);
        indexQuery = phrase;
      }
    }
  }

  return { raw, indexQuery, phrases };
}

/** True when every literal phrase appears consecutively in `text` (case-insensitive). */
export function textContainsAllPhrases(text: string, phrases: readonly string[]): boolean {
  if (phrases.length === 0) {
    return true;
  }

  const haystack = normalizePhraseHaystack(text);
  return phrases.every((phrase) => haystack.includes(normalizePhraseHaystack(phrase)));
}
