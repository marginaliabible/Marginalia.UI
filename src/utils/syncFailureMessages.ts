/** User-facing copy for files that failed to convert and are not in the library. */

const KNOWN_SYNC_ERRORS: Array<{ test: RegExp; message: (subject: string) => string }> = [
  {
    test: /copying of text from this document is not allowed/i,
    message: (subject) => `${subject} is copy protected and couldn't be added to your library.`,
  },
  {
    test: /encrypted|password required|incorrect password|no password was provided/i,
    message: (subject) => `${subject} is password protected and couldn't be added to your library.`,
  },
  {
    test: /cannot read the file/i,
    message: (subject) => `${subject} couldn't be read and has been left out of your library.`,
  },
  {
    test: /timed out after|process tree killed/i,
    message: (subject) => `${subject} took too long to convert and couldn't be added to your library.`,
  },
];

const COMPONENT_NAMES: Array<[RegExp, string]> = [
  [/(?<![/\\])pdf2htmlEX\b/gi, 'PDF to web converter'],
  [/(?<![/\\])Gotenberg\b/gi, 'Document extractor'],
  [/(?<![/\\])ocrmypdf\b/gi, 'OCR engine'],
  [/(?<![/\\])pdftoppm\b/gi, 'Page renderer'],
  [/(?<![/\\])tesseract\b/gi, 'OCR engine'],
  [/(?<![/\\])pdfinfo\b/gi, 'PDF inspector'],
  [/(?<![/\\])MarkupServer\b/gi, 'Document converter'],
  [/Azure Document Intelligence/gi, 'AI OCR engine'],
];

function subjectFor(fileName?: string | null): string {
  const name = String(fileName ?? '').trim();
  return name ? `'${name}'` : 'This file';
}

function primaryErrorLine(raw: string): string {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^preprocessing:/i.test(line));
  const match = [...lines].reverse().find((line) => /error|failed|cannot|unable|timed out/i.test(line));
  return match || lines[lines.length - 1] || raw.trim();
}

/** Soften an unhandled converter error: friendlier tool names, no exit-code jargon. */
export function softenUnhandledSyncError(rawError: string): string {
  let text = primaryErrorLine(rawError);
  text = text.replace(/\bMarkupServer rejected \S+:\s*/gi, '');
  text = text.replace(/\bfailed with exit code \d+:\s*(?:Error:\s*)?/gi, 'failed: ');
  text = text.replace(/\bfailed with exit code \d+(?:\s*\([^)]*\))?/gi, 'failed');
  text = text.replace(/\bconversion failed \(\d+\):\s*/gi, 'failed: ');
  for (const [pattern, name] of COMPONENT_NAMES) {
    text = text.replace(pattern, name);
  }
  text = text.replace(/\s*\(MARKUP_[A-Z0-9_/*]+\)/g, '');
  text = text.replace(/\)?;?\s*process tree killed.*$/i, '');
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Tooltip / toast copy for an unpublished conversion failure.
 * `fileName` omitted yields "This file …" (title); pass the real name for aria-label and toast.
 */
export function describeSyncFailure(fileName?: string | null, rawError?: string | null): string {
  const subject = subjectFor(fileName);
  const raw = String(rawError ?? '').trim();
  if (raw) {
    for (const known of KNOWN_SYNC_ERRORS) {
      if (known.test.test(raw)) {
        return known.message(subject);
      }
    }
    const softened = softenUnhandledSyncError(raw);
    if (softened) {
      return `${subject} couldn't be added to your library: ${softened}`;
    }
  }
  return `${subject} couldn't be added to your library.`;
}
