import { stemmer } from 'stemmer';

/**
 * Maps common archaic English forms to their modern equivalents.
 * Covers KJV-era pronouns, auxiliary verbs, and common irregular forms.
 * Applied before stemming so the stemmer works on recognizable roots.
 */
const ARCHAIC_EN_MAP: Record<string, string> = {
  // Pronouns
  thou: 'you',
  thee: 'you',
  thy: 'your',
  thine: 'your',
  ye: 'you',
  // Archaic auxiliary/copula verbs
  art: 'are',
  hath: 'have',
  hast: 'have',
  hadst: 'have',
  doth: 'does',
  doest: 'do',
  dost: 'do',
  shalt: 'shall',
  wilt: 'will',
  wouldst: 'would',
  couldst: 'could',
  shouldst: 'should',
  canst: 'can',
  mayst: 'may',
  mightest: 'might',
  didst: 'did',
  wast: 'was',
  wert: 'were',
  saith: 'say',
  saidst: 'said',
  spake: 'spoke',
  spakest: 'spoke',
};

/**
 * Minimal stopwords — only pure function words with no distinguishing meaning.
 * Kept intentionally small so users can still search meaningful short phrases.
 */
const EN_STOPWORDS = new Set([
  'a', 'an', 'the',
  'and', 'or', 'but', 'nor',
  'in', 'on', 'at', 'to', 'of', 'for', 'by', 'as', 'up',
  'is', 'it', 'be', 'so', 'if', 'no',
]);

/**
 * Words whose root coincidentally ends in the letters "est" or "eth" and
 * should NOT have those letters stripped as archaic suffixes.
 */
const ETH_EXCLUSIONS = new Set(['faith', 'breath', 'earth', 'death', 'health', 'wealth', 'wrath', 'length', 'strength']);
const EST_EXCLUSIONS = new Set(['best', 'rest', 'nest', 'west', 'test', 'pest', 'jest', 'zest', 'feast', 'beast', 'least', 'chest', 'crest', 'priest', 'forest', 'harvest', 'interest']);

/**
 * Strips archaic verb suffixes added in KJV/Early Modern English.
 * - "-eth" (3rd person singular present): "prospereth" → "prosper"
 * - "-est" (2nd person singular present): "knowest" → "know"
 *
 * Safety guards: minimum word length requirements and an exclusion list
 * protect real English words that happen to end in the same letters.
 */
function stripArchaicSuffix(word: string): string {
  if (word.length >= 6 && word.endsWith('eth') && !ETH_EXCLUSIONS.has(word)) {
    return word.slice(0, -3);
  }
  if (word.length >= 7 && word.endsWith('est') && !EST_EXCLUSIONS.has(word)) {
    return word.slice(0, -3);
  }
  return word;
}

/**
 * Normalizes a single English (or Middle English / enm) term:
 * 1. Lowercase
 * 2. Apply archaic pronoun/verb map
 * 3. Strip archaic verb suffixes (-eth, -est)
 * 4. Apply Porter stemmer for modern morphology
 * 5. Filter stopwords
 *
 * Returns null to signal MiniSearch to drop the token.
 */
export function normalizeEnglishTerm(term: string): string | null {
  const lower = term.toLowerCase();

  // Replace archaic form first (pre-stemming for better stem results)
  const mapped = ARCHAIC_EN_MAP[lower];
  if (mapped !== undefined) {
    const stem = stemmer(mapped);
    return EN_STOPWORDS.has(stem) ? null : stem;
  }

  // Strip archaic verb suffix, then stem
  const stripped = stripArchaicSuffix(lower);
  const stemmed = stemmer(stripped);

  if (!stemmed || EN_STOPWORDS.has(stemmed) || EN_STOPWORDS.has(lower)) {
    return null;
  }

  return stemmed;
}

/**
 * Normalizes a term for the given language code.
 * English translations (en, enm) get full archaic normalization + stemming.
 * All other languages receive lowercase normalization only (safe baseline).
 */
export function normalizeTerm(term: string, language: string | string[] | undefined): string | null {
  const raw = Array.isArray(language) ? language[0] : language;
  const lang = (raw ?? '').toLowerCase();

  if (lang === 'en' || lang === 'enm' || lang.startsWith('en-')) {
    return normalizeEnglishTerm(term);
  }

  // Baseline for non-English: just lowercase, no stemming, no stopwords
  const lower = term.toLowerCase().trim();
  return lower || null;
}
