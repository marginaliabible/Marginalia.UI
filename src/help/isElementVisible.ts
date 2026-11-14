/** True when an element is connected and has a non-empty layout box. */
export function isElementVisible(el: Element | null | undefined): boolean {
  if (!(el instanceof HTMLElement) || !el.isConnected) {
    return false;
  }

  const view = el.ownerDocument.defaultView;
  if (!view) {
    return false;
  }

  const style = view.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }

  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
