const ROMAN_DIGITS: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 };
// Canonical numerals 1-199 only, so `iiii`, `vx` or `il` never read as a chapter.
const CANONICAL_ROMAN = /^c?(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})$/;

export interface RomanNumeralReading {
  value: number;
  /** An OCR `I` was read as `l` or `i` (`Ivii` -> lvii). */
  corrected: boolean;
}

/**
 * Readings of an all-lowercase (`xviii`) or all-uppercase (`XX`) roman numeral. In an otherwise lowercase numeral
 * an uppercase `I` is an OCR misread of `l` or `i`, so `Ivii` reads lvii but `Ix` reads both lx and ix; other
 * mixed case has no reading.
 */
export function readRomanNumeral(value: string): RomanNumeralReading[] {
  if (value === value.toLowerCase() || value === value.toUpperCase()) {
    const numeral = toValue(value.toLowerCase());
    return numeral ? [{ value: numeral, corrected: false }] : [];
  }
  if (/[A-HJ-Z]/.test(value)) {
    return [];
  }

  const values = new Set(
    [value.replace(/I/g, 'l'), value.replace(/I/g, 'i')].map(toValue).filter((numeral) => numeral !== null),
  );
  return [...values].map((numeral) => ({ value: numeral, corrected: true }));
}

function toValue(numeral: string): number | null {
  if (numeral.length === 0 || !CANONICAL_ROMAN.test(numeral)) {
    return null;
  }

  let total = 0;
  for (let index = 0; index < numeral.length; index += 1) {
    const current = ROMAN_DIGITS[numeral[index]!]!;
    const next = ROMAN_DIGITS[numeral[index + 1] ?? ''] ?? 0;
    total += current < next ? -current : current;
  }
  return total > 0 ? total : null;
}
