import { bibleService } from '../services/bibleService';
import type { SourcePreferences } from '../utils/sourceSubscriptions';
import { hasLinkedCloudProvider } from './linkedCloudProviders';

export type ResourcesPanelTourGateResult =
  | { status: 'ready'; reference: { book: string; chapter: number; verse: number } }
  | { status: 'blocked'; message: string };

const NO_PROVIDER_MESSAGE =
  'The Resources panel requires you to connect to a cloud provider. Please do so via [Account Sync](account-sync) before continuing.';

const NO_RESOURCE_MESSAGE =
  'The Resources panel requires at least one resource in order to be used. Follow the steps in the [Account Sync Help Topic](account-sync) to connect to your notes or ministry\'s resources.';


const NON_EMPTY_DONUT_SELECTOR = '.verse-resource-donut-wrap .verse-resource-donut:not(.is-empty)';

export function getNonEmptyResourceDonutSelector(): string {
  return NON_EMPTY_DONUT_SELECTOR;
}

export async function chapterHasResourceMarkers(options: {
  book: string;
  chapter: number;
  verseNumbers: number[];
  sourceUrls: string[];
  preferences?: SourcePreferences;
}): Promise<boolean> {
  const { book, chapter, verseNumbers, sourceUrls, preferences } = options;
  for (const verse of verseNumbers) {
    const payload = await bibleService.getResourcesForVerse(
      book,
      chapter,
      verse,
      sourceUrls,
      preferences
    );
    // Donuts render only when a verse has tags (same rule as VerseDisplay).
    if (payload.tags.length > 0) {
      return true;
    }
  }
  return false;
}

export async function waitForNonEmptyResourceDonut(timeoutMs = 8000): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (document.querySelector(NON_EMPTY_DONUT_SELECTOR)) {
      return true;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  return Boolean(document.querySelector(NON_EMPTY_DONUT_SELECTOR));
}

/**
 * Quiet prerequisites for the resources-panel tour:
 * 1) at least one linked cloud provider
 * 2) current chapter has a non-empty resource donut, else navigate to the first chapter that does
 */
export async function ensureResourcesPanelTourReady(options: {
  selectedBook: string | null;
  selectedChapter: number;
  availableBooks: Array<{ name: string; chapters: Array<{ chapter: number; verses: Array<{ verse: number }> }> }>;
  sourceUrls: string[];
  preferences?: SourcePreferences;
  goToReference: (target: { book: string; chapter: number; verse: number }) => Promise<void>;
}): Promise<ResourcesPanelTourGateResult> {
  if (!hasLinkedCloudProvider()) {
    return { status: 'blocked', message: NO_PROVIDER_MESSAGE };
  }

  const { selectedBook, selectedChapter, availableBooks, sourceUrls, preferences, goToReference } = options;
  const currentBook = availableBooks.find((book) => book.name === selectedBook) ?? null;
  const currentChapter = currentBook?.chapters.find((entry) => entry.chapter === selectedChapter) ?? null;
  const currentVerses = currentChapter?.verses.map((entry) => entry.verse) ?? [];

  if (
    selectedBook
    && currentVerses.length > 0
    && await chapterHasResourceMarkers({
      book: selectedBook,
      chapter: selectedChapter,
      verseNumbers: currentVerses,
      sourceUrls,
      preferences,
    })
  ) {
    const verse = currentVerses[0] ?? 1;
    await waitForNonEmptyResourceDonut();
    return {
      status: 'ready',
      reference: { book: selectedBook, chapter: selectedChapter, verse },
    };
  }

  const first = await bibleService.findFirstReferenceWithResources(
    availableBooks.map((book) => book.name),
    sourceUrls,
    preferences
  );

  if (!first) {
    return { status: 'blocked', message: NO_RESOURCE_MESSAGE };
  }

  await goToReference(first);
  const ready = await waitForNonEmptyResourceDonut();
  if (!ready) {
    return { status: 'blocked', message: NO_RESOURCE_MESSAGE };
  }

  return { status: 'ready', reference: first };
}
