interface AliasConfig {
  readonly [book: string]: readonly string[];
}

export const BOOK_ALIAS_CONFIG: AliasConfig = {
  'Genesis': ['genesis', 'gen', 'ge', 'gn'],
  'Exodus': ['exodus', 'exo', 'exod', 'ex'],
  'Leviticus': ['leviticus', 'lev', 'lv'],
  'Numbers': ['numbers', 'num', 'nm', 'nb'],
  'Deuteronomy': ['deuteronomy', 'deut', 'dt', 'deu'],
  'Joshua': ['joshua', 'josh', 'jos'],
  'Judges': ['judges', 'judg', 'jdg', 'jg'],
  'Ruth': ['ruth', 'ru'],
  'I Samuel': ['1 samuel', '1 sam', '1sa', 'i samuel', 'i sam', 'first samuel', '1st samuel'],
  'II Samuel': ['2 samuel', '2 sam', '2sa', 'ii samuel', 'ii sam', 'second samuel', '2nd samuel'],
  'I Kings': ['1 kings', '1 ki', '1kgs', 'i kings', 'i ki', 'first kings', '1st kings'],
  'II Kings': ['2 kings', '2 ki', '2kgs', 'ii kings', 'ii ki', 'second kings', '2nd kings'],
  'I Chronicles': ['1 chronicles', '1 chr', '1 ch', 'i chronicles', 'i chr', 'first chronicles', '1st chronicles'],
  'II Chronicles': ['2 chronicles', '2 chr', '2 ch', 'ii chronicles', 'ii chr', 'second chronicles', '2nd chronicles'],
  'Ezra': ['ezra', 'ezr'],
  'Nehemiah': ['nehemiah', 'neh', 'ne'],
  'Esther': ['esther', 'est', 'es'],
  'Job': ['job', 'jb'],
  'Psalms': ['psalms', 'psalm', 'ps', 'psa', 'psm', 'pslm'],
  'Proverbs': ['proverbs', 'prov', 'pr', 'prv'],
  'Ecclesiastes': ['ecclesiastes', 'eccl', 'ecc', 'ec'],
  'Song of Solomon': ['song of solomon', 'song of songs', 'song', 'sos', 'canticles', 'cant'],
  'Isaiah': ['isaiah', 'isa', 'is'],
  'Jeremiah': ['jeremiah', 'jer', 'je'],
  'Lamentations': ['lamentations', 'lam', 'la'],
  'Ezekiel': ['ezekiel', 'ezek', 'eze', 'ez'],
  'Daniel': ['daniel', 'dan', 'dn'],
  'Hosea': ['hosea', 'hos', 'ho'],
  'Joel': ['joel', 'jl'],
  'Amos': ['amos', 'am'],
  'Obadiah': ['obadiah', 'obad', 'ob'],
  'Jonah': ['jonah', 'jon', 'jh'],
  'Micah': ['micah', 'mic', 'mi'],
  'Nahum': ['nahum', 'nah', 'na'],
  'Habakkuk': ['habakkuk', 'hab', 'hb'],
  'Zephaniah': ['zephaniah', 'zeph', 'zep', 'zp'],
  'Haggai': ['haggai', 'hag', 'hg'],
  'Zechariah': ['zechariah', 'zech', 'zec', 'zc'],
  'Malachi': ['malachi', 'mal', 'ml'],
  'Matthew': ['matthew', 'matt', 'mt', 'mat'],
  'Mark': ['mark', 'mk', 'mrk'],
  'Luke': ['luke', 'lk', 'luk'],
  'John': ['john', 'jn', 'jhn'],
  'Acts': ['acts', 'ac'],
  'Romans': ['romans', 'rom', 'ro', 'rm'],
  'I Corinthians': ['1 corinthians', '1 cor', '1co', 'i corinthians', 'i cor', 'first corinthians', '1st corinthians'],
  'II Corinthians': ['2 corinthians', '2 cor', '2co', 'ii corinthians', 'ii cor', 'second corinthians', '2nd corinthians'],
  'Galatians': ['galatians', 'gal', 'ga'],
  'Ephesians': ['ephesians', 'eph', 'ep'],
  'Philippians': ['philippians', 'phil', 'php', 'ph'],
  'Colossians': ['colossians', 'col', 'co'],
  'I Thessalonians': ['1 thessalonians', '1 thes', '1 th', '1th', 'i thessalonians', 'i thes', 'first thessalonians', '1st thessalonians'],
  'II Thessalonians': ['2 thessalonians', '2 thes', '2 th', '2th', 'ii thessalonians', 'ii thes', 'second thessalonians', '2nd thessalonians'],
  'I Timothy': ['1 timothy', '1 tim', '1ti', 'i timothy', 'i tim', 'first timothy', '1st timothy'],
  'II Timothy': ['2 timothy', '2 tim', '2ti', 'ii timothy', 'ii tim', 'second timothy', '2nd timothy'],
  'Titus': ['titus', 'tit', 'ti'],
  'Philemon': ['philemon', 'philem', 'phm', 'phile'],
  'Hebrews': ['hebrews', 'heb', 'he'],
  'James': ['james', 'jas', 'jm'],
  'I Peter': ['1 peter', '1 pet', '1pe', 'i peter', 'i pet', 'first peter', '1st peter'],
  'II Peter': ['2 peter', '2 pet', '2pe', 'ii peter', 'ii pet', 'second peter', '2nd peter'],
  'I John': ['1 john', '1 jn', '1jo', 'i john', 'i jn', 'first john', '1st john'],
  'II John': ['2 john', '2 jn', '2jo', 'ii john', 'ii jn', 'second john', '2nd john'],
  'III John': ['3 john', '3 jn', '3jo', 'iii john', 'iii jn', 'third john', '3rd john'],
  'Jude': ['jude', 'jud'],
  'Revelation': ['revelation', 'rev', 're', 'revelations', 'apocalypse']
};

// Blue Letter Bible style three-character book codes, used for {abbr_book} hyperlink tokens.
export const BOOK_ABBREVIATIONS: { readonly [book: string]: string } = {
  'Genesis': 'gen',
  'Exodus': 'exo',
  'Leviticus': 'lev',
  'Numbers': 'num',
  'Deuteronomy': 'deu',
  'Joshua': 'jos',
  'Judges': 'jdg',
  'Ruth': 'rth',
  'I Samuel': '1sa',
  'II Samuel': '2sa',
  'I Kings': '1ki',
  'II Kings': '2ki',
  'I Chronicles': '1ch',
  'II Chronicles': '2ch',
  'Ezra': 'ezr',
  'Nehemiah': 'neh',
  'Esther': 'est',
  'Job': 'job',
  'Psalms': 'psa',
  'Proverbs': 'pro',
  'Ecclesiastes': 'ecc',
  'Song of Solomon': 'sng',
  'Isaiah': 'isa',
  'Jeremiah': 'jer',
  'Lamentations': 'lam',
  'Ezekiel': 'eze',
  'Daniel': 'dan',
  'Hosea': 'hos',
  'Joel': 'joe',
  'Amos': 'amo',
  'Obadiah': 'oba',
  'Jonah': 'jon',
  'Micah': 'mic',
  'Nahum': 'nah',
  'Habakkuk': 'hab',
  'Zephaniah': 'zep',
  'Haggai': 'hag',
  'Zechariah': 'zec',
  'Malachi': 'mal',
  'Matthew': 'mat',
  'Mark': 'mar',
  'Luke': 'luk',
  'John': 'jhn',
  'Acts': 'act',
  'Romans': 'rom',
  'I Corinthians': '1co',
  'II Corinthians': '2co',
  'Galatians': 'gal',
  'Ephesians': 'eph',
  'Philippians': 'phl',
  'Colossians': 'col',
  'I Thessalonians': '1th',
  'II Thessalonians': '2th',
  'I Timothy': '1ti',
  'II Timothy': '2ti',
  'Titus': 'tit',
  'Philemon': 'phm',
  'Hebrews': 'heb',
  'James': 'jas',
  'I Peter': '1pe',
  'II Peter': '2pe',
  'I John': '1jo',
  'II John': '2jo',
  'III John': '3jo',
  'Jude': 'jde',
  'Revelation': 'rev'
};

const CANONICAL_BOOK_ORDER = Object.keys(BOOK_ALIAS_CONFIG);
const CANONICAL_BOOK_POSITION = new Map(
  CANONICAL_BOOK_ORDER.map((book, index) => [book.toLowerCase(), index])
);
const CANONICAL_BOOK_BY_ALIAS = new Map(
  CANONICAL_BOOK_ORDER.flatMap((book) => [book, ...BOOK_ALIAS_CONFIG[book]].map((alias) => [alias.toLowerCase(), book]))
);
const FIRST_NEW_TESTAMENT_BOOK_INDEX = CANONICAL_BOOK_ORDER.indexOf('Matthew');

export interface BookAliasMatcher {
  readonly book: string;
  readonly regex: RegExp;
  readonly rawAlias: string;
}

const boundarySuffix = '(?=[\\s\\d:;-]|$)';

const aliasMatchers: BookAliasMatcher[] = Object.entries(BOOK_ALIAS_CONFIG)
  .flatMap(([book, aliases]) =>
    aliases.concat(book.toLowerCase()).map((alias) => {
      const pattern = alias
        .toLowerCase()
        .replace(/\./g, '')
        .replace(/\s+/g, '\\s*');
      return {
        book,
        rawAlias: alias,
        regex: new RegExp(`^${pattern}(?:\\.)*${boundarySuffix}`, 'i')
      };
    })
  )
  .sort((a, b) => b.rawAlias.replace(/\s+/g, '').length - a.rawAlias.replace(/\s+/g, '').length);

export const BOOK_ALIAS_MATCHERS: readonly BookAliasMatcher[] = aliasMatchers;

export function normalizeBookName(name: string): string {
  return name.trim().toLowerCase();
}

export function getCanonicalBookPosition(book: string): number {
  const canonicalBook = CANONICAL_BOOK_BY_ALIAS.get(normalizeBookName(book));
  return canonicalBook
    ? CANONICAL_BOOK_POSITION.get(canonicalBook.toLowerCase()) ?? Number.MAX_SAFE_INTEGER
    : Number.MAX_SAFE_INTEGER;
}

export function getCanonicalBookName(book: string): string | null {
  return CANONICAL_BOOK_BY_ALIAS.get(normalizeBookName(book)) ?? null;
}

export function getBookAbbreviation(book: string): string {
  const canonicalBook = getCanonicalBookName(book);
  return (canonicalBook && BOOK_ABBREVIATIONS[canonicalBook]) || normalizeBookName(book);
}

// Arabic-numeral spelling used by external sites ("1 corinthians", not the canonical "I Corinthians").
export function getBookUrlName(book: string): string {
  const canonicalBook = getCanonicalBookName(book);
  return canonicalBook ? BOOK_ALIAS_CONFIG[canonicalBook][0] : normalizeBookName(book);
}

export function compareBibleReferences(
  left: { book: string; chapter: number; verse: number },
  right: { book: string; chapter: number; verse: number }
): number {
  return getCanonicalBookPosition(left.book) - getCanonicalBookPosition(right.book)
    || left.chapter - right.chapter
    || left.verse - right.verse;
}

export function isNewTestamentBook(book: string): boolean {
  const bookPosition = getCanonicalBookPosition(book);
  return bookPosition >= FIRST_NEW_TESTAMENT_BOOK_INDEX && bookPosition < CANONICAL_BOOK_ORDER.length;
}
