const TEXT_LAYER_DIV = /(<div class="t\b[^"]*"[^>]*>)([\s\S]*?)(<\/div>)/g;
const TRAILING_COPY_SPACE = /(?: |&nbsp;|&#160;|\u00a0)+$/i;

/**
 * Already-converted pages may end `.t` runs with two spaces: the PDF supplied one,
 * then the markup converter appended another. Collapse those to a single space so
 * select+copy does not paste "hello  world" while new conversions are rolling out.
 */
export function collapseRedundantTextLayerCopySpaces(html: string): string {
  return html.replace(TEXT_LAYER_DIV, (_full, open: string, inner: string, close: string) => {
    const withoutTrailing = inner.replace(TRAILING_COPY_SPACE, '');
    if (withoutTrailing === inner) {
      return `${open}${inner}${close}`;
    }
    return `${open}${withoutTrailing} ${close}`;
  });
}
