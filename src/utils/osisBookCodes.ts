import { getCanonicalBookName } from './book-aliases';
import type { BibleBook } from '../models/bible';

/** USFM/OSIS-style book codes used in research `ref` values (e.g. `ROM.10.9`). */
const OSIS_TO_CANONICAL: Record<string, string> = {
  GEN: 'Genesis',
  EXO: 'Exodus',
  LEV: 'Leviticus',
  NUM: 'Numbers',
  DEU: 'Deuteronomy',
  JOS: 'Joshua',
  JDG: 'Judges',
  RUT: 'Ruth',
  '1SA': 'I Samuel',
  '2SA': 'II Samuel',
  '1KI': 'I Kings',
  '2KI': 'II Kings',
  '1CH': 'I Chronicles',
  '2CH': 'II Chronicles',
  EZR: 'Ezra',
  NEH: 'Nehemiah',
  EST: 'Esther',
  JOB: 'Job',
  PSA: 'Psalms',
  PRO: 'Proverbs',
  ECC: 'Ecclesiastes',
  SNG: 'Song of Solomon',
  ISA: 'Isaiah',
  JER: 'Jeremiah',
  LAM: 'Lamentations',
  EZK: 'Ezekiel',
  DAN: 'Daniel',
  HOS: 'Hosea',
  JOL: 'Joel',
  AMO: 'Amos',
  OBA: 'Obadiah',
  JON: 'Jonah',
  MIC: 'Micah',
  NAM: 'Nahum',
  HAB: 'Habakkuk',
  ZEP: 'Zephaniah',
  HAG: 'Haggai',
  ZEC: 'Zechariah',
  MAL: 'Malachi',
  MAT: 'Matthew',
  MRK: 'Mark',
  LUK: 'Luke',
  JHN: 'John',
  ACT: 'Acts',
  ROM: 'Romans',
  '1CO': 'I Corinthians',
  '2CO': 'II Corinthians',
  GAL: 'Galatians',
  EPH: 'Ephesians',
  PHP: 'Philippians',
  COL: 'Colossians',
  '1TH': 'I Thessalonians',
  '2TH': 'II Thessalonians',
  '1TI': 'I Timothy',
  '2TI': 'II Timothy',
  TIT: 'Titus',
  PHM: 'Philemon',
  HEB: 'Hebrews',
  JAS: 'James',
  '1PE': 'I Peter',
  '2PE': 'II Peter',
  '1JN': 'I John',
  '2JN': 'II John',
  '3JN': 'III John',
  JUD: 'Jude',
  REV: 'Revelation',
};

export function canonicalBookFromRefToken(bookToken: string): string | null {
  const trimmed = bookToken.trim();
  if (!trimmed) {
    return null;
  }

  const fromOsis = OSIS_TO_CANONICAL[trimmed.toUpperCase()];
  if (fromOsis) {
    return fromOsis;
  }

  return getCanonicalBookName(trimmed);
}

/** Map a research/OSIS book token onto a loaded Bible's book name. */
export function resolveBibleBookName(bookToken: string, books: readonly BibleBook[]): string | null {
  const canonical = canonicalBookFromRefToken(bookToken);
  if (!canonical) {
    return null;
  }

  const exact = books.find((book) => book.name === canonical);
  if (exact) {
    return exact.name;
  }

  const byCanonical = books.find((book) => getCanonicalBookName(book.name) === canonical);
  return byCanonical?.name ?? null;
}
