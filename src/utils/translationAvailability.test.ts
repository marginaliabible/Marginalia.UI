import {
  TRANSLATION_NOT_YET_LOADED,
  VERSE_NOT_AVAILABLE,
  VERSE_NOT_AVAILABLE_LABEL,
  VERSES_NOT_AVAILABLE,
  isTranslationChapterLoaded,
  missingVerseLabel,
  missingVerseNotice,
} from './translationAvailability';

describe('translationAvailability', () => {
  it('treats a missing chapter entry as not yet loaded', () => {
    expect(isTranslationChapterLoaded({}, 'ASV')).toBe(false);
  });

  it('treats a null chapter as loaded but unavailable', () => {
    expect(isTranslationChapterLoaded({ ASV: null }, 'ASV')).toBe(true);
  });

  it('treats a present chapter as loaded', () => {
    expect(isTranslationChapterLoaded({ ASV: { verses: [] } }, 'ASV')).toBe(true);
  });

  it('explains that a translation is still loading', () => {
    expect(missingVerseNotice(false)).toBe(TRANSLATION_NOT_YET_LOADED);
    expect(missingVerseLabel(false)).toBe(TRANSLATION_NOT_YET_LOADED);
  });

  it('explains that a loaded translation is missing the verse', () => {
    expect(missingVerseNotice(true)).toBe(VERSE_NOT_AVAILABLE);
    expect(missingVerseNotice(true, 2)).toBe(VERSES_NOT_AVAILABLE);
    expect(missingVerseLabel(true)).toBe(VERSE_NOT_AVAILABLE_LABEL);
  });
});
