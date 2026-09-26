#!/usr/bin/env node
/**
 * Download farskipper KJV 1769 verses and write nested public/data/bibles/KJV.json.
 * Preserves # paragraph marks and [bracket] italics markers; sets opt-in flags.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_URL = 'https://raw.githubusercontent.com/farskipper/kjv/master/json/verses-1769.json';

const BOOK_NAME_MAP = {
  '1 Samuel': 'I Samuel',
  '2 Samuel': 'II Samuel',
  '1 Kings': 'I Kings',
  '2 Kings': 'II Kings',
  '1 Chronicles': 'I Chronicles',
  '2 Chronicles': 'II Chronicles',
  "Solomon's Song": 'Song of Solomon',
  '1 Corinthians': 'I Corinthians',
  '2 Corinthians': 'II Corinthians',
  '1 Thessalonians': 'I Thessalonians',
  '2 Thessalonians': 'II Thessalonians',
  '1 Timothy': 'I Timothy',
  '2 Timothy': 'II Timothy',
  '1 Peter': 'I Peter',
  '2 Peter': 'II Peter',
  '1 John': 'I John',
  '2 John': 'II John',
  '3 John': 'III John',
};

const KEY_PATTERN = /^(.+) (\d+):(\d+)$/;

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, '..', 'public', 'data', 'bibles', 'KJV.json');

const response = await fetch(SOURCE_URL);
if (!response.ok) {
  throw new Error(`Failed to download ${SOURCE_URL}: ${response.status} ${response.statusText}`);
}

/** @type {Record<string, string>} */
const flat = await response.json();

/** @type {Map<string, Map<number, Map<number, string>>>} */
const byBook = new Map();
const bookOrder = [];

for (const [key, text] of Object.entries(flat)) {
  const match = KEY_PATTERN.exec(key);
  if (!match) {
    throw new Error(`Unrecognized verse key: ${key}`);
  }

  const remoteBook = match[1];
  const chapter = Number(match[2]);
  const verse = Number(match[3]);
  const book = BOOK_NAME_MAP[remoteBook] ?? remoteBook;

  if (!byBook.has(book)) {
    byBook.set(book, new Map());
    bookOrder.push(book);
  }

  const chapters = byBook.get(book);
  if (!chapters.has(chapter)) {
    chapters.set(chapter, new Map());
  }

  chapters.get(chapter).set(verse, text);
}

const bible = {
  translation: 'King James Version (1769)',
  italiciseBrackets: true,
  paragraphMarks: true,
  books: bookOrder.map((name) => {
    const chapters = byBook.get(name);
    const chapterNumbers = Array.from(chapters.keys()).sort((a, b) => a - b);
    return {
      name,
      chapters: chapterNumbers.map((chapter) => {
        const verses = chapters.get(chapter);
        const verseNumbers = Array.from(verses.keys()).sort((a, b) => a - b);
        return {
          chapter,
          verses: verseNumbers.map((verse) => ({
            verse,
            text: verses.get(verse),
          })),
        };
      }),
    };
  }),
};

const verseCount = bible.books.reduce(
  (sum, book) => sum + book.chapters.reduce((inner, ch) => inner + ch.verses.length, 0),
  0
);

writeFileSync(outPath, `${JSON.stringify(bible)}\n`, 'utf8');
console.log(`Wrote ${outPath} (${bible.books.length} books, ${verseCount} verses)`);
