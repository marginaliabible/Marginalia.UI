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
  '1 Samuel': ['1 samuel', '1 sam', '1sa', 'i samuel', 'i sam', 'first samuel', '1st samuel'],
  '2 Samuel': ['2 samuel', '2 sam', '2sa', 'ii samuel', 'ii sam', 'second samuel', '2nd samuel'],
  '1 Kings': ['1 kings', '1 ki', '1kgs', 'i kings', 'first kings', '1st kings'],
  '2 Kings': ['2 kings', '2 ki', '2kgs', 'ii kings', 'second kings', '2nd kings'],
  '1 Chronicles': ['1 chronicles', '1 chr', '1 ch', 'i chronicles', 'first chronicles', '1st chronicles'],
  '2 Chronicles': ['2 chronicles', '2 chr', '2 ch', 'ii chronicles', 'second chronicles', '2nd chronicles'],
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
  '1 Corinthians': ['1 corinthians', '1 cor', '1co', 'i corinthians', 'first corinthians', '1st corinthians'],
  '2 Corinthians': ['2 corinthians', '2 cor', '2co', 'ii corinthians', 'second corinthians', '2nd corinthians'],
  'Galatians': ['galatians', 'gal', 'ga'],
  'Ephesians': ['ephesians', 'eph', 'ep'],
  'Philippians': ['philippians', 'phil', 'php', 'ph'],
  'Colossians': ['colossians', 'col', 'co'],
  '1 Thessalonians': ['1 thessalonians', '1 thes', '1 th', '1th', 'i thessalonians', 'first thessalonians', '1st thessalonians'],
  '2 Thessalonians': ['2 thessalonians', '2 thes', '2 th', '2th', 'ii thessalonians', 'second thessalonians', '2nd thessalonians'],
  '1 Timothy': ['1 timothy', '1 tim', '1ti', 'i timothy', 'first timothy', '1st timothy'],
  '2 Timothy': ['2 timothy', '2 tim', '2ti', 'ii timothy', 'second timothy', '2nd timothy'],
  'Titus': ['titus', 'tit', 'ti'],
  'Philemon': ['philemon', 'philem', 'phm', 'phile'],
  'Hebrews': ['hebrews', 'heb', 'he'],
  'James': ['james', 'jas', 'jm'],
  '1 Peter': ['1 peter', '1 pet', '1pe', 'i peter', 'first peter', '1st peter'],
  '2 Peter': ['2 peter', '2 pet', '2pe', 'ii peter', 'second peter', '2nd peter'],
  '1 John': ['1 john', '1 jn', '1jo', 'i john', 'first john', '1st john'],
  '2 John': ['2 john', '2 jn', '2jo', 'ii john', 'second john', '2nd john'],
  '3 John': ['3 john', '3 jn', '3jo', 'iii john', 'third john', '3rd john'],
  'Jude': ['jude', 'jud'],
  'Revelation': ['revelation', 'rev', 're', 'revelations', 'apocalypse']
};

export interface BookAliasMatcher {
  readonly book: string;
  readonly regex: RegExp;
  readonly rawAlias: string;
}

const boundarySuffix = '(?=[\s\d:;-]|$)';

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
        regex: new RegExp(`^${pattern}${boundarySuffix}`, 'i')
      } satisfies BookAliasMatcher;
    })
  )
  .sort((a, b) => b.rawAlias.replace(/\s+/g, '').length - a.rawAlias.replace(/\s+/g, '').length);

export const BOOK_ALIAS_MATCHERS: readonly BookAliasMatcher[] = aliasMatchers;

export function normalizeBookName(name: string): string {
  return name.trim().toLowerCase();
}
