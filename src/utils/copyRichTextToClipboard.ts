/**
 * Copies plain text and HTML to the clipboard.
 * Returns true only after a clipboard write reports success.
 */
export async function copyRichTextToClipboard(copyText: string, copyHtml: string): Promise<boolean> {
  const copyViaClipboardEvent = (): boolean => {
    const listener = (event: ClipboardEvent) => {
      event.preventDefault();
      event.clipboardData?.setData('text/plain', copyText);
      event.clipboardData?.setData('text/html', copyHtml);
    };

    document.addEventListener('copy', listener, { once: true });
    const didCopy = document.execCommand('copy');
    document.removeEventListener('copy', listener);
    return didCopy;
  };

  try {
    if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard.write === 'function') {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([copyText], { type: 'text/plain' }),
          'text/html': new Blob([copyHtml], { type: 'text/html' }),
        }),
      ]);
      return true;
    }
  } catch {
    // Continue to legacy fallback paths below.
  }

  if (copyViaClipboardEvent()) {
    return true;
  }

  try {
    if (typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(copyText);
      return true;
    }
  } catch {
    // Continue to the textarea fallback.
  }

  const fallback = document.createElement('textarea');
  fallback.value = copyText;
  fallback.setAttribute('readonly', 'true');
  fallback.style.position = 'fixed';
  fallback.style.opacity = '0';
  document.body.appendChild(fallback);
  fallback.select();
  const didCopy = document.execCommand('copy');
  document.body.removeChild(fallback);
  return Boolean(didCopy);
}
