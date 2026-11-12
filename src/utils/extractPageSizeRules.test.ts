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

  it('extracts hex pdf2htmlEX page-box classes (e.g. h48b, wc)', () => {
    const css = [
      '.h48b{height:749px;}',
      '.h48c{height:749.5px;}',
      '.ha5f{height:775px;}',
      '.w6{width:553px;}',
      '.w7{width:553.5px;}',
      '.wc{width:528px;}',
      '.h100a{height:21.2964px;}',
    ].join('');

    const result = extractPageSizeRules(css);

    expect(result.heights.h48b).toBe(749);
    expect(result.heights.h48c).toBe(749.5);
    expect(result.heights.ha5f).toBe(775);
    expect(result.widths.wc).toBe(528);
    expect(result.cssText).toContain('.h48b{height:749px;}');
    expect(result.cssText).toContain('.wc{width:528px;}');
    expect(result.cssText).not.toContain('.h100a{');
  });
});
