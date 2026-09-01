#!/usr/bin/env node
/**
 * Generates public/data/library.json and public/data/translations.json from Scrollmapper listings plus local overrides.
 * - Pulls the JSON file list from the GitHub API (falls back to local caches if offline).
 * - Parses README to capture language codes and human-readable names.
 * - Overlays any local Bible payload files in public/data/bibles so local copies win.
 * Run by executing `node scripts/generate-settings.js`
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'public', 'data');
const BIBLES_DIR = path.join(ROOT, 'public', 'data', 'bibles');
const LIBRARY_PATH = path.join(DATA_DIR, 'library.json');
const TRANSLATIONS_PATH = path.join(DATA_DIR, 'translations.json');
const REMOTE_LIST_URL =
  'https://api.github.com/repos/scrollmapper/bible_databases/contents/formats/json?ref=master';
const RAW_BASE =
  'https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json/';
const README_URL =
  'https://raw.githubusercontent.com/scrollmapper/bible_databases/master/README.md';
const LOCAL_INDEX_CACHE = path.join(ROOT, 'scrollmapper.json');
const LOCAL_README_CACHE = path.join(ROOT, 'scrollmapper_readme.md');
const OFFLINE = process.argv.includes('--offline');
const EXTRA_LANGUAGE_LABELS = {
  bea: 'Beaver Indian',
  ceb: 'Cebuano',
  chr: 'Cherokee',
  'cop-sa': 'Coptic (Sahidic)',
  cu: 'Church Slavonic',
  enm: 'Middle English',
  eo: 'Esperanto',
  got: 'Gothic',
  grc: 'Ancient Greek',
  gv: 'Manx',
  hbo: 'Biblical Hebrew',
  ht: 'Haitian Creole',
  la: 'Latin',
  lzh: 'Literary Chinese',
  mg: 'Malagasy',
  mi: 'Māori',
  mlf: 'Minangkabau',
  pon: 'Pohnpeian',
  sml: 'Samali',
  syr: 'Syriac',
  tl: 'Tagalog',
  tlh: 'Klingon',
  tpi: 'Tok Pisin',
  tsg: 'Tsogo'
};

async function main() {
  const [indexEntries, readmeText] = await Promise.all([loadIndex(), loadReadme()]);
  const modifiedOn = new Date().toISOString();

  const languageMap = buildLanguageMap(readmeText);
  const remoteEntries = indexEntries
    .filter((item) => item.type === 'file' && item.name.toLowerCase().endsWith('.json'))
    .map((item) => {
      const id = item.name.replace(/\.json$/i, '');
      const langInfo = languageMap.get(id) ?? {};
      return {
        id,
        label: langInfo.label || prettifyId(id),
        language: langInfo.language || '',
        address: item.download_url || `${RAW_BASE}${item.name}`
      };
    });

  const merged = overlayLocal(remoteEntries);
  merged.sort((a, b) => a.label.localeCompare(b.label));

  const translations = {
    modifiedOn,
    translations: merged,
    extraLanguages: loadExtraLanguages()
  };

  const library = {
    name: 'Built-In',
    modifiedOn,
    source: 'translations.json'
  };

  ensureDir(DATA_DIR);
  fs.writeFileSync(LIBRARY_PATH, JSON.stringify(library, null, 2));
  fs.writeFileSync(TRANSLATIONS_PATH, JSON.stringify(translations, null, 2));
  console.log(`Wrote built-in library to ${path.relative(ROOT, LIBRARY_PATH)}`);
  console.log(`Wrote ${merged.length} entries to translations in ${path.relative(ROOT, TRANSLATIONS_PATH)}`);
}

async function loadIndex() {
  if (OFFLINE && fs.existsSync(LOCAL_INDEX_CACHE)) {
    return readJsonCache('Scrollmapper JSON index (offline)', LOCAL_INDEX_CACHE);
  }

  try {
    return await fetchJson(REMOTE_LIST_URL);
  } catch (error) {
    console.warn(`Falling back to cached scrollmapper.json (${error.message})`);
  }

  if (fs.existsSync(LOCAL_INDEX_CACHE)) {
    return readJsonCache('Scrollmapper JSON index (cache)', LOCAL_INDEX_CACHE);
  }

  throw new Error('Unable to load Scrollmapper JSON listing.');
}

async function loadReadme() {
  if (OFFLINE && fs.existsSync(LOCAL_README_CACHE)) {
    return fs.readFileSync(LOCAL_README_CACHE, 'utf8');
  }

  try {
    return await fetchText(README_URL);
  } catch (error) {
    console.warn(`Falling back to cached scrollmapper_readme.md (${error.message})`);
  }

  if (fs.existsSync(LOCAL_README_CACHE)) {
    return fs.readFileSync(LOCAL_README_CACHE, 'utf8');
  }

  throw new Error('Unable to load Scrollmapper README for metadata parsing.');
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'marginalia-settings-generator' } });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status}`);
  }
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'marginalia-settings-generator' } });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status}`);
  }
  return res.text();
}

function readJsonCache(label, cachePath) {
  const raw = fs.readFileSync(cachePath, 'utf8');
  console.log(`Using ${label} from ${path.relative(ROOT, cachePath)}`);
  return JSON.parse(raw);
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
    map.set(id, {
      language,
      label: cleanedLabel || prettifyId(id)
    });
  }
  return map;
}

function overlayLocal(remoteEntries) {
  ensureDir(BIBLES_DIR);
  const locals = fs
    .readdirSync(BIBLES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
    .map((entry) => entry.name.replace(/\.json$/i, ''));

  const remoteMap = new Map(remoteEntries.map((entry) => [entry.id, entry]));
  for (const id of locals) {
    const remote = remoteMap.get(id);
    const existing = remote ?? { id, label: prettifyId(id), language: '' };
    remoteMap.set(id, {
      ...existing,
      address: `bibles/${id}.json`
    });
  }

  return Array.from(remoteMap.values());
}

function loadExtraLanguages() {
  return Object.entries(EXTRA_LANGUAGE_LABELS)
    .map(([code, label]) => ({ code, label }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

function prettifyId(id) {
  const upper = id.toUpperCase();
  if (upper === 'KJV') {
    return 'KJV (King James Version)';
  }
  if (upper.length <= 5) {
    return upper;
  }
  return id.replace(/[-_]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
