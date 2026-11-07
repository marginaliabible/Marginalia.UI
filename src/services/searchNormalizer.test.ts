jest.mock('stemmer', () => require('../test/stemmer.cjs'));

import { normalizeEnglishTerm, normalizeTerm } from './searchNormalizer';

describe('normalizeEnglishTerm', () => {
  it('maps common KJV pronouns to modern stems', () => {
    expect(normalizeEnglishTerm('thou')).toBe(normalizeEnglishTerm('you'));
    expect(normalizeEnglishTerm('thee')).toBe(normalizeEnglishTerm('you'));
    expect(normalizeEnglishTerm('ye')).toBe(normalizeEnglishTerm('you'));
    expect(normalizeEnglishTerm('thy')).toBe(normalizeEnglishTerm('your'));
    expect(normalizeEnglishTerm('thine')).toBe(normalizeEnglishTerm('your'));
    expect(normalizeEnglishTerm('thyself')).toBe(normalizeEnglishTerm('yourself'));
  });

  it('unifies irregular archaic lexicon with modern search terms', () => {
    const pairs: Array<[string, string]> = [
      ['besought', 'begged'],
      ['astonied', 'astonished'],
      ['forgat', 'forgot'],
      ['spake', 'spoke'],
      ['shew', 'show'],
      ['shewed', 'showed'],
      ['shewn', 'shown'],
      ['holpen', 'helped'],
      ['hearken', 'listen'],
      ['charity', 'love'],
      ['raiment', 'clothes'],
      ['betwixt', 'between'],
      ['straightway', 'immediately'],
      ['tidings', 'news'],
      ['throughly', 'thoroughly'],
      ['onely', 'only'],
      ['joyned', 'joined'],
      ['knowen', 'known'],
      ['plaister', 'plaster'],
      ['spunge', 'sponge'],
      ['enow', 'enough'],
      ['smote', 'struck'],
      ['victuals', 'food'],
      ['hath', 'has'],
      ['hast', 'have'],
      ['saith', 'says'],
      ['whithersoever', 'wherever'],
    ];

    for (const [archaic, modern] of pairs) {
      expect(normalizeEnglishTerm(archaic)).toBe(normalizeEnglishTerm(modern));
    }
  });

  it('strips archaic -eth/-est suffixes onto modern stems', () => {
    expect(normalizeEnglishTerm('believeth')).toBe(normalizeEnglishTerm('believes'));
    expect(normalizeEnglishTerm('cometh')).toBe(normalizeEnglishTerm('comes'));
    expect(normalizeEnglishTerm('knowest')).toBe(normalizeEnglishTerm('knows'));
    expect(normalizeEnglishTerm('prospereth')).toBe(normalizeEnglishTerm('prospers'));
  });

  it('does not strip real words that merely end in eth/est', () => {
    expect(normalizeEnglishTerm('faith')).toBeTruthy();
    expect(normalizeEnglishTerm('earth')).toBeTruthy();
    expect(normalizeEnglishTerm('priest')).toBeTruthy();
    expect(normalizeEnglishTerm('harvest')).toBeTruthy();
    expect(normalizeEnglishTerm('faith')).not.toBe(normalizeEnglishTerm('fa'));
  });

  it('drops stopwords', () => {
    expect(normalizeEnglishTerm('the')).toBeNull();
    expect(normalizeEnglishTerm('and')).toBeNull();
    expect(normalizeEnglishTerm('no')).toBeNull();
  });

  it('keeps nay searchable because no is a stopword', () => {
    expect(normalizeEnglishTerm('nay')).toBeTruthy();
    expect(normalizeEnglishTerm('nay')).not.toBe(normalizeEnglishTerm('no'));
  });
});

describe('normalizeTerm', () => {
  it('applies English archaic normalization for en and enm', () => {
    expect(normalizeTerm('hath', 'en')).toBe(normalizeEnglishTerm('has'));
    expect(normalizeTerm('shew', 'enm')).toBe(normalizeEnglishTerm('show'));
    expect(normalizeTerm('thy', 'en-GB')).toBe(normalizeEnglishTerm('your'));
  });

  it('only lowercases non-English languages', () => {
    expect(normalizeTerm('Hath', 'es')).toBe('hath');
    expect(normalizeTerm('Shew', ['de'])).toBe('shew');
  });
});
