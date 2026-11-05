import { collapseRedundantTextLayerCopySpaces } from './textLayerCopySpaces';

describe('collapseRedundantTextLayerCopySpaces', () => {
  it('collapses two trailing spaces on a text run to one', () => {
    const html = '<div class="t x1">hello  </div><div class="t x2">world</div>';
    expect(collapseRedundantTextLayerCopySpaces(html)).toBe(
      '<div class="t x1">hello </div><div class="t x2">world</div>'
    );
  });

  it('leaves a single trailing space alone', () => {
    const html = '<div class="t x1">hello </div><div class="t x2">world</div>';
    expect(collapseRedundantTextLayerCopySpaces(html)).toBe(html);
  });

  it('leaves runs with no trailing space alone', () => {
    const html = '<div class="t x1">hello</div><div class="t x2">world</div>';
    expect(collapseRedundantTextLayerCopySpaces(html)).toBe(html);
  });

  it('normalizes mixed trailing nbsp-plus-space to one space', () => {
    const html = '<div class="t x1">hello&nbsp; </div>';
    expect(collapseRedundantTextLayerCopySpaces(html)).toBe('<div class="t x1">hello </div>');
  });
});
