import { stemmer } from 'stemmer';

/**
 * Modern English → archaic / Early Modern English forms found in older
 * translations such as the KJV. Used to build the archaic→modern lookup so
 * indexing and querying collapse to the same stems.
 */
const MODERN_TO_ARCHAIC: Record<string, readonly string[]> = {
  asked: ['askedst'],
  astonished: ['astonied'],
  became: ['becamest'],
  before: ['afore', 'beforetime'],
  begged: ['besought'],
  believe: ['believest'],
  believes: ['believeth'],
  belly: ['bowels'],
  between: ['betwixt'],
  branch: ['bough'],
  carried: ['carriedst'],
  cattle: ['beeves'],
  chest: ['coffer'],
  clothes: ['raiment', 'apparel', 'clothe'],
  clothing: ['raiment', 'vesture'],
  comes: ['cometh'],
  could: ['couldest', 'couldst'],
  cough: ['phthisis', 'consumption'],
  did: ['didst'],
  dies: ['dieth'],
  does: ['doeth', 'doth'],
  eats: ['eateth'],
  elders: ['ancients'],
  enough: ['enow'],
  falsehood: ['leasing'],
  famine: ['dearth'],
  food: ['victuals', 'meat'],
  forgot: ['forgat'],
  gave: ['gavest'],
  gives: ['giveth', 'givest'],
  go: ['goeth', 'goest', 'goethest'],
  has: ['hath'],
  have: ['hast'],
  hears: ['heareth'],
  heard: ['heardest', 'heardst'],
  helps: ['helpeth'],
  helped: ['holpen'],
  immediately: ['straightway', 'anon', 'forthwith'],
  joined: ['joyned'],
  knows: ['knoweth', 'knowest'],
  known: ['knowen'],
  listen: ['hearken'],
  listens: ['hearkeneth'],
  lives: ['liveth', 'livedst'],
  look: ['behold', 'lo'],
  love: ['charity'],
  makes: ['maketh', 'makest'],
  might: ['mightest', 'mightst'],
  moreover: ['furthermore'],
  near: ['nigh'],
  news: ['tidings'],
  no: ['nay'],
  only: ['onely'],
  perhaps: ['peradventure', 'perchance'],
  plaster: ['plaister'],
  plentiful: ['plenteous'],
  postpone: ['defer'],
  prevent: ['let'],
  remember: ['rememberest'],
  said: ['saidst'],
  saw: ['sawest'],
  says: ['sayeth', 'saith'],
  sees: ['seeth'],
  shall: ['shalt'],
  should: ['shouldest', 'shouldst'],
  show: ['shew'],
  showed: ['shewed'],
  shown: ['shewn'],
  shows: ['sheweth'],
  speaks: ['speaketh', 'speakest'],
  spoke: ['spake', 'spokest'],
  sponge: ['spunge'],
  stands: ['standeth'],
  stay: ['tarry', 'abide'],
  stayed: ['tarried'],
  stop: ['refrain'],
  struck: ['smote', 'stricken'],
  takes: ['taketh'],
  thoroughly: ['throughly'],
  thought: ['thoughtest'],
  took: ['tookest'],
  touches: ['toucheth'],
  troubles: ['troubleth'],
  walks: ['walketh'],
  went: ['wentest'],
  were: ['wert'],
  wherever: ['whithersoever'],
  will: ['wilt'],
  work: ['worketh'],
  would: ['wouldest', 'wouldst'],
  you: ['thou', 'thee', 'ye'],
  your: ['thy', 'thine'],
  yourself: ['thyself'],
};

/**
 * Extra archaic forms not covered by MODERN_TO_ARCHAIC (mostly auxiliary
 * verbs and alternate spellings).
 */
const EXTRA_ARCHAIC_EN_MAP: Record<string, string> = {
  art: 'are',
  hadst: 'have',
  doest: 'do',
  dost: 'do',
  canst: 'can',
  mayst: 'may',
  wast: 'was',
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
 * Builds archaic→modern lookup from MODERN_TO_ARCHAIC.
 * Skips targets that are stopwords (e.g. nay→no) so those archaic tokens
 * remain searchable as themselves rather than being dropped.
 */
function buildArchaicEnMap(): Record<string, string> {
  const map: Record<string, string> = { ...EXTRA_ARCHAIC_EN_MAP };

  for (const [modern, archaicForms] of Object.entries(MODERN_TO_ARCHAIC)) {
    if (EN_STOPWORDS.has(modern)) {
      continue;
    }
    for (const archaic of archaicForms) {
      map[archaic] = modern;
    }
  }

  return map;
}

const ARCHAIC_EN_MAP: Record<string, string> = buildArchaicEnMap();

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
 * 2. Apply archaic pronoun/verb/lexicon map
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
