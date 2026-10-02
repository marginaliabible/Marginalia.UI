import { filterTranslationsByLanguages } from './App';

const translations = [
  { id: 'KJV', language: 'en' },
  { id: 'RVR', language: ['es'] },
  { id: 'WLC', language: 'hbo' },
  { id: 'SourceDoc', language: undefined },
];

describe('filterTranslationsByLanguages', () => {
  it('returns everything without a fallback when no languages are selected', () => {
    expect(filterTranslationsByLanguages(translations, [])).toEqual({ translations, usedFallback: false });
  });

  it('keeps matching translations and those without language metadata', () => {
    const result = filterTranslationsByLanguages(translations, ['EN', 'hbo']);
    expect(result.usedFallback).toBe(false);
    expect(result.translations.map((t) => t.id)).toEqual(['KJV', 'WLC', 'SourceDoc']);
  });

  it('falls back to every translation when nothing matches', () => {
    const withMetadata = translations.filter((t) => t.language);
    expect(filterTranslationsByLanguages(withMetadata, ['fr'])).toEqual({ translations: withMetadata, usedFallback: true });
  });
});
