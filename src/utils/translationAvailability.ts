export const TRANSLATION_NOT_YET_LOADED = 'This translation has not yet loaded.';
export const VERSE_NOT_AVAILABLE = 'This verse is not available in this translation';
export const VERSES_NOT_AVAILABLE = 'These verses are not available in this translation';
export const VERSE_NOT_AVAILABLE_LABEL = 'Not available in this translation';

export function isTranslationChapterLoaded(
  chaptersByTranslation: Record<string, unknown>,
  translationId: string
): boolean {
  return chaptersByTranslation[translationId] !== undefined;
}

export function missingVerseNotice(isTranslationLoaded: boolean, verseCount = 1): string {
  if (!isTranslationLoaded) {
    return TRANSLATION_NOT_YET_LOADED;
  }

  return verseCount > 1 ? VERSES_NOT_AVAILABLE : VERSE_NOT_AVAILABLE;
}

export function missingVerseLabel(isTranslationLoaded: boolean): string {
  if (!isTranslationLoaded) {
    return TRANSLATION_NOT_YET_LOADED;
  }

  return VERSE_NOT_AVAILABLE_LABEL;
}
