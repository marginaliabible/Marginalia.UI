import { extractPageSizeRules } from './extractPageSizeRules';

describe('extractPageSizeRules', () => {
  it('extracts page-box width/height classes and ignores tiny glyph metrics in the inject sheet', () => {
    const css = [
      '.h18{height:16.020160px;}',
      '.h85{height:792.000000px;}',
      '.h86{height:792.500000px;}',
      '.w2{width:612.000000px;}',
      '.w3{width:612.500000px;}',
      '.h85{height:1056.000000pt;}',
      '.w2{width:816.000000pt;}',
    ].join('\n');

    const result = extractPageSizeRules(css);

    expect(result.heights.h18).toBeCloseTo(16.02016);
    expect(result.heights.h85).toBe(792);
    expect(result.widths.w2).toBe(612);
    expect(result.cssText).toContain('.h85{height:792px;}');
    expect(result.cssText).toContain('.w2{width:612px;}');
    expect(result.cssText).not.toContain('.h18{');
    expect(result.cssText).not.toContain('pt');
  });
});
