#!/usr/bin/env node
/**
 * Compare built-in translation payloads for near-duplicates (human review).
 *
 * - Detects Apocrypha-bearing editions that have a same-language non-Apocrypha
 *   counterpart with highly similar shared (canonical) text → removal candidates.
 * - Reports same-language pairs with high normalized-text identity for merge review.
 *
 * Does not modify the remote fork. After review, add rejected IDs to
 * scripts/translation-blocklist.json and re-run `npm run generate:scrollmapper`.
 *
 * Usage:
 *   node scripts/find-near-duplicate-translations.js
 *   node scripts/find-near-duplicate-translations.js --min-identical=0.92 --concurrency=4
 *   node scripts/find-near-duplicate-translations.js --language=en --limit=20
 *   node scripts/find-near-duplicate-translations.js --extra-catalog=../Marginalia.Translations/licensed/translations.json
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'public', 'data');
const BIBLES_DIR = path.join(DATA_DIR, 'bibles');
const TRANSLATIONS_PATH = path.join(DATA_DIR, 'translations.json');
const BLOCKLIST_PATH = path.join(__dirname, 'translation-blocklist.json');
const CACHE_DIR = path.join(__dirname, '.bible-cache');
const REPORT_PATH = path.join(__dirname, 'near-duplicate-report.json');
const REMOTE_LIST_URL =
  'https://api.github.com/repos/grinn/scrollmapper_bible_databases/contents/formats/json?ref=master';
const RAW_BASE =
  'https://raw.githubusercontent.com/grinn/scrollmapper_bible_databases/master/formats/json/';
const README_URL =
  'https://raw.githubusercontent.com/grinn/scrollmapper_bible_databases/master/README.md';
const LOCAL_INDEX_CACHE = path.join(ROOT, 'scrollmapper.json');
const LOCAL_README_CACHE = path.join(ROOT, 'scrollmapper_readme.md');

const APOCRYPHA_BOOK_ALIASES = new Set(
  [
    'tobit',
    'judith',
    'wisdom',
    'wisdom of solomon',
    'ecclesiasticus',
    'sirach',
    'wisdom of jesus son of sirach',
    'baruch',
    'letter of jeremiah',
    'epistle of jeremy',
    'prayer of azariah',
    'song of the three children',
    'song of the three holy children',
    'susanna',
    'bel and the dragon',
    '1 maccabees',
    '2 maccabees',
    '3 maccabees',
    '4 maccabees',
    'i maccabees',
    'ii maccabees',
    'iii maccabees',
    'iv maccabees',
    '1 esdras',
    '2 esdras',
    'i esdras',
    'ii esdras',
    'prayer of manasseh',
    'additions to esther',
    'additions to daniel',
    'rest of esther',
    'psalm 151',
    '1 enoch',
    'enos',
    'jubilees'
  ].map(normalizeBookName)
);

const args = parseArgs(process.argv.slice(2));
const MIN_IDENTICAL = Number(args['min-identical'] ?? 0.9);
const MIN_OVERLAP = Number(args['min-overlap'] ?? 0.5);
const CONCURRENCY = Math.max(1, Number(args.concurrency ?? 4));
const LANGUAGE_FILTER = args.language ? String(args.language) : null;
const LIMIT = args.limit ? Number(args.limit) : null;
const SAMPLE_DIFFS = Math.max(0, Number(args['sample-diffs'] ?? 25));
const INCLUDE_BLOCKLISTED = Boolean(args['include-blocklisted']);
const EXTRA_CATALOG = args['extra-catalog'] ? String(args['extra-catalog']) : null;

async function main() {
  const blocklist = loadBlocklist();
  // Prefer a fresh remote listing so editions already dropped from translations.json
  // (e.g. Apocrypha) are still compared and can be suggested for the blocklist.
  let entries = await loadComparisonEntries();
  if (EXTRA_CATALOG) {
    const extra = loadExtraCatalog(EXTRA_CATALOG);
    console.log(`Loaded ${extra.length} extra catalog entries from ${EXTRA_CATALOG}`);
    entries = entries.concat(extra);
  }
  if (!INCLUDE_BLOCKLISTED) {
    entries = entries.filter((entry) => !blocklist.has(entry.id));
  }
  if (LANGUAGE_FILTER) {
    entries = entries.filter((entry) => entry.language === LANGUAGE_FILTER);
  }
  if (LIMIT != null && Number.isFinite(LIMIT)) {
    entries = entries.slice(0, LIMIT);
  }

  ensureDir(CACHE_DIR);
  console.log(`Loading ${entries.length} translation payloads (concurrency ${CONCURRENCY})…`);
  const loaded = await mapPool(entries, CONCURRENCY, async (entry, index) => {
    process.stdout.write(`\r  [${index + 1}/${entries.length}] ${entry.id}`.padEnd(60));
    const bible = await loadBible(entry);
    return indexBible(entry, bible);
  });
  process.stdout.write('\n');

  const byLanguage = groupBy(loaded, (item) => item.language || 'unknown');
  const apocryphaRemovals = [];
  const nearDuplicates = [];

  for (const [language, group] of Object.entries(byLanguage)) {
    if (group.length < 2) {
      continue;
    }
    console.log(`Comparing ${group.length} ${language} translations…`);

    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const left = group[i];
        const right = group[j];
        const comparison = compareIndexed(left, right);
        if (comparison.sharedVerses === 0) {
          continue;
        }

        const overlap = comparison.sharedVerses / Math.min(left.verseCount, right.verseCount);
        const identical = comparison.identicalShare;

        if (
          (left.hasApocrypha !== right.hasApocrypha) &&
          identical >= MIN_IDENTICAL &&
          overlap >= MIN_OVERLAP
        ) {
          const withApoc = left.hasApocrypha ? left : right;
          const withoutApoc = left.hasApocrypha ? right : left;
          apocryphaRemovals.push({
            removeId: withApoc.id,
            keepId: withoutApoc.id,
            language,
            reason:
              'Apocrypha edition with a non-Apocrypha counterpart; Marginalia does not support Apocrypha',
            apocryphaBooks: withApoc.apocryphaBooks,
            identicalShare: round4(identical),
            overlapShare: round4(overlap),
            sharedVerses: comparison.sharedVerses,
            differingVerses: comparison.differingVerses,
            avgEditSimilarityOnDiffs: comparison.avgEditSimilarityOnDiffs,
            sampleDiffs: comparison.sampleDiffs
          });
        }

        if (identical >= MIN_IDENTICAL && overlap >= MIN_OVERLAP) {
          nearDuplicates.push({
            a: left.id,
            b: right.id,
            language,
            labels: { [left.id]: left.label, [right.id]: right.label },
            identicalShare: round4(identical),
            overlapShare: round4(overlap),
            sharedVerses: comparison.sharedVerses,
            differingVerses: comparison.differingVerses,
            avgEditSimilarityOnDiffs: comparison.avgEditSimilarityOnDiffs,
            leftOnlyVerses: comparison.leftOnlyVerses,
            rightOnlyVerses: comparison.rightOnlyVerses,
            leftHasApocrypha: left.hasApocrypha,
            rightHasApocrypha: right.hasApocrypha,
            sampleDiffs: comparison.sampleDiffs
          });
        }
      }
    }
  }

  apocryphaRemovals.sort((a, b) => b.identicalShare - a.identicalShare || a.removeId.localeCompare(b.removeId));
  nearDuplicates.sort((a, b) => b.identicalShare - a.identicalShare || a.a.localeCompare(b.a));

  const withApocrypha = loaded
    .filter((item) => item.hasApocrypha)
    .map((item) => ({
      id: item.id,
      label: item.label,
      language: item.language,
      apocryphaBooks: item.apocryphaBooks,
      verseCount: item.verseCount,
      bookCount: item.bookCount
    }));

  const report = {
    generatedOn: new Date().toISOString(),
    thresholds: {
      minIdentical: MIN_IDENTICAL,
      minOverlap: MIN_OVERLAP,
      sampleDiffs: SAMPLE_DIFFS
    },
    summary: {
      translationsCompared: loaded.length,
      languages: Object.keys(byLanguage).length,
      withApocrypha: withApocrypha.length,
      apocryphaRemovalCandidates: apocryphaRemovals.length,
      nearDuplicatePairs: nearDuplicates.length
    },
    suggestedBlocklistIds: [...new Set(apocryphaRemovals.map((item) => item.removeId))].sort(),
    withApocrypha,
    apocryphaRemovalCandidates: apocryphaRemovals,
    nearDuplicates
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  printSummary(report);
  console.log(`\nWrote report to ${path.relative(ROOT, REPORT_PATH)}`);
  console.log(
    'After review, add rejected IDs to scripts/translation-blocklist.json and run npm run generate:scrollmapper.'
  );
}

async function loadComparisonEntries() {
  try {
    const [indexEntries, readmeText] = await Promise.all([loadIndex(), loadReadme()]);
    const languageMap = buildLanguageMap(readmeText);
    const remoteEntries = indexEntries
      .filter((item) => item.type === 'file' && item.name.toLowerCase().endsWith('.json'))
      .map((item) => {
        const id = item.name.replace(/\.json$/i, '');
        const langInfo = languageMap.get(id) ?? {};
        return {
          id,
          label: langInfo.label || id,
          language: langInfo.language || '',
          address: item.download_url || `${RAW_BASE}${item.name}`
        };
      });
    return overlayLocal(remoteEntries);
  } catch (error) {
    console.warn(`Remote listing unavailable (${error.message}); falling back to translations.json`);
    if (!fs.existsSync(TRANSLATIONS_PATH)) {
      throw error;
    }
    const catalog = JSON.parse(fs.readFileSync(TRANSLATIONS_PATH, 'utf8'));
    return catalog.translations ?? [];
  }
}

async function loadIndex() {
  try {
    return await fetchJson(REMOTE_LIST_URL);
  } catch (error) {
    if (fs.existsSync(LOCAL_INDEX_CACHE)) {
      console.warn(`Using cached scrollmapper.json (${error.message})`);
      return JSON.parse(fs.readFileSync(LOCAL_INDEX_CACHE, 'utf8'));
    }
    throw error;
  }
}

async function loadReadme() {
  try {
    return await fetchText(README_URL);
  } catch (error) {
    if (fs.existsSync(LOCAL_README_CACHE)) {
      console.warn(`Using cached scrollmapper_readme.md (${error.message})`);
      return fs.readFileSync(LOCAL_README_CACHE, 'utf8');
    }
    throw error;
  }
}

function buildLanguageMap(readme) {
  const map = new Map();
  const lineRegex = /-\s+\*\*([^(]+?)\s+\(([^)]+)\)\*\*:\s*([^\n]+)/g;
  let match;
  while ((match = lineRegex.exec(readme)) !== null) {
    const [, rawId, lang, rawLabel] = match;
    const id = rawId.trim();
    const language = lang.trim();
    const cleanedLabel = rawLabel.trim().replace(new RegExp(`^${escapeRegex(id)}\\s*:\\s*`, 'i'), '');
    map.set(id, { language, label: cleanedLabel || id });
  }
  return map;
}

function overlayLocal(remoteEntries) {
  if (!fs.existsSync(BIBLES_DIR)) {
    return remoteEntries;
  }
  const locals = fs
    .readdirSync(BIBLES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .map((entry) => entry.name.replace(/\.json$/i, ''));

  const remoteMap = new Map(remoteEntries.map((entry) => [entry.id, entry]));
  for (const id of locals) {
    const remote = remoteMap.get(id);
    const existing = remote ?? { id, label: id, language: '' };
    remoteMap.set(id, { ...existing, address: `bibles/${id}.json` });
  }
  return Array.from(remoteMap.values());
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'marginalia-near-duplicate-finder' } });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status}`);
  }
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'marginalia-near-duplicate-finder' } });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status}`);
  }
  return res.text();
}

function loadExtraCatalog(catalogPath) {
  const resolved = path.resolve(ROOT, catalogPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Extra catalog not found: ${resolved}`);
  }
  const catalog = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  const baseDir = path.dirname(resolved);
  return (catalog.translations ?? []).map((entry) => ({
    ...entry,
    cacheKey: `extra-${entry.id}`,
    resolveBaseDir: baseDir
  }));
}

async function loadBible(entry) {
  const cacheKey = entry.cacheKey || entry.id;
  const cachePath = path.join(CACHE_DIR, `${cacheKey}.json`);
  if (fs.existsSync(cachePath)) {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  }

  const address = entry.address;
  let raw;
  if (/^https?:\/\//i.test(address)) {
    const res = await fetch(address, { headers: { 'User-Agent': 'marginalia-near-duplicate-finder' } });
    if (!res.ok) {
      throw new Error(`Failed to fetch ${entry.id} from ${address}: ${res.status}`);
    }
    raw = await res.text();
  } else {
    const localPath = entry.resolveBaseDir
      ? path.resolve(entry.resolveBaseDir, address)
      : path.join(ROOT, 'public', 'data', address.replace(/^\//, ''));
    raw = fs.readFileSync(localPath, 'utf8');
  }

  fs.writeFileSync(cachePath, raw);
  return JSON.parse(raw);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function indexBible(entry, bible) {
  const verses = new Map();
  const books = [];
  const apocryphaBooks = [];

  for (const book of bible.books ?? []) {
    const bookName = String(book.name ?? '');
    const normalizedBook = normalizeBookName(bookName);
    books.push(bookName);
    if (APOCRYPHA_BOOK_ALIASES.has(normalizedBook) || looksLikeApocrypha(normalizedBook)) {
      apocryphaBooks.push(bookName);
    }

    for (const chapter of book.chapters ?? []) {
      const chapterNum = Number(chapter.chapter);
      for (const verse of chapter.verses ?? []) {
        const verseNum = Number(verse.verse);
        const key = `${normalizedBook}|${chapterNum}|${verseNum}`;
        verses.set(key, normalizeText(String(verse.text ?? '')));
      }
    }
  }

  return {
    id: entry.id,
    label: entry.label,
    language: entry.language || '',
    verses,
    verseCount: verses.size,
    bookCount: books.length,
    apocryphaBooks,
    hasApocrypha: apocryphaBooks.length > 0 || /apocryph|apocrief|deuterocanon/i.test(entry.label || '')
  };
}

function compareIndexed(left, right) {
  let shared = 0;
  let identical = 0;
  let leftOnly = 0;
  const diffs = [];

  for (const [key, leftText] of left.verses) {
    if (!right.verses.has(key)) {
      leftOnly += 1;
      continue;
    }
    shared += 1;
    const rightText = right.verses.get(key);
    if (leftText === rightText) {
      identical += 1;
    } else if (diffs.length < SAMPLE_DIFFS) {
      diffs.push({
        key,
        a: leftText.slice(0, 160),
        b: rightText.slice(0, 160),
        editSimilarity: round4(editSimilarity(leftText, rightText))
      });
    }
  }

  let rightOnly = 0;
  for (const key of right.verses.keys()) {
    if (!left.verses.has(key)) {
      rightOnly += 1;
    }
  }

  const sampleDiffs = diffs.filter(Boolean);
  const avgEditSimilarityOnDiffs =
    sampleDiffs.length === 0
      ? 1
      : round4(sampleDiffs.reduce((sum, item) => sum + item.editSimilarity, 0) / sampleDiffs.length);

  return {
    sharedVerses: shared,
    identicalShare: shared === 0 ? 0 : identical / shared,
    differingVerses: shared - identical,
    leftOnlyVerses: leftOnly,
    rightOnlyVerses: rightOnly,
    avgEditSimilarityOnDiffs,
    sampleDiffs
  };
}

function looksLikeApocrypha(normalizedBook) {
  return (
    /\bmaccabees\b/.test(normalizedBook) ||
    /\besdras\b/.test(normalizedBook) ||
    /\bsirach\b/.test(normalizedBook) ||
    /\becclesiasticus\b/.test(normalizedBook) ||
    normalizedBook.startsWith('addition') ||
    normalizedBook.includes('bel and')
  );
}

function normalizeBookName(name) {
  return String(name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(i|ii|iii|iv)\b/g, (roman) => ({ i: '1', ii: '2', iii: '3', iv: '4' })[roman])
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeText(text) {
  return String(text)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\[\]#]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function editSimilarity(a, b) {
  if (a === b) {
    return 1;
  }
  if (!a.length && !b.length) {
    return 1;
  }
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) {
    return 1;
  }
  // Cap expensive pairwise edits on very long strings.
  const left = a.length > 400 ? a.slice(0, 400) : a;
  const right = b.length > 400 ? b.slice(0, 400) : b;
  const distance = levenshtein(left, right);
  return 1 - distance / Math.max(left.length, right.length, 1);
}

function levenshtein(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prev = new Array(cols);
  let curr = new Array(cols);
  for (let j = 0; j < cols; j += 1) {
    prev[j] = j;
  }
  for (let i = 1; i < rows; i += 1) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j < cols; j += 1) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** @returns {Map<string, string>} id → translation name */
function loadBlocklist() {
  if (!fs.existsSync(BLOCKLIST_PATH)) {
    return new Map();
  }
  const raw = JSON.parse(fs.readFileSync(BLOCKLIST_PATH, 'utf8'));
  const blocklisted =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? raw.blocklisted : raw;
  if (!blocklisted || typeof blocklisted !== 'object' || Array.isArray(blocklisted)) {
    throw new Error(
      `Invalid blocklist format in ${path.relative(ROOT, BLOCKLIST_PATH)} (expected blocklisted: { id: name })`
    );
  }
  return new Map(
    Object.entries(blocklisted).map(([id, name]) => [String(id), String(name)])
  );
}

function printSummary(report) {
  console.log('\nSummary');
  console.log(`  Compared: ${report.summary.translationsCompared}`);
  console.log(`  With Apocrypha books: ${report.summary.withApocrypha}`);
  console.log(`  Apocrypha removal candidates: ${report.summary.apocryphaRemovalCandidates}`);
  console.log(`  Near-duplicate pairs (≥ ${report.thresholds.minIdentical}): ${report.summary.nearDuplicatePairs}`);

  if (report.suggestedBlocklistIds.length) {
    console.log('\nSuggested blocklist IDs (Apocrypha counterparts):');
    for (const id of report.suggestedBlocklistIds) {
      const item = report.apocryphaRemovalCandidates.find((entry) => entry.removeId === id);
      console.log(`  - ${id}  (keep ${item.keepId}, identical ${(item.identicalShare * 100).toFixed(1)}%)`);
    }
  }

  const top = report.nearDuplicates.slice(0, 15);
  if (top.length) {
    console.log('\nTop near-duplicate pairs:');
    for (const pair of top) {
      console.log(
        `  - ${pair.a} ↔ ${pair.b}  identical ${(pair.identicalShare * 100).toFixed(1)}%  overlap ${(pair.overlapShare * 100).toFixed(1)}%  diffs ${pair.differingVerses}`
      );
    }
  }
}

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      continue;
    }
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    if (eq === -1) {
      out[body] = true;
    } else {
      out[body.slice(0, eq)] = body.slice(eq + 1);
    }
  }
  return out;
}

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;

  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return results;
}

function groupBy(items, keyFn) {
  const map = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!map[key]) {
      map[key] = [];
    }
    map[key].push(item);
  }
  return map;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
