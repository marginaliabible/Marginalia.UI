import React from 'react';

export interface VerseMarkupFlags {
  italiciseBrackets?: boolean;
  paragraphMarks?: boolean;
}

export interface VerseMarkupSettings {
  italics: boolean;
  paragraphMarks: boolean;
}

const BRACKET_TOKEN = /(\[[^\]]+\])/;
const BRACKET_CONTENTS = /^\[([^\]]+)\]$/;

/** Muted grey used for verse numbers and translator italics in clipboard HTML. */
export const CLIPBOARD_MUTED_COLOR = '#808080';

/** Remove opted-in translator markers for plain-text consumers (search, clipboard). */
export function stripVerseMarkers(text: string, flags: VerseMarkupFlags = {}): string {
  let result = text;
  if (flags.paragraphMarks) {
    result = result.replace(/^#\s*/, '');
  }
  if (flags.italiciseBrackets) {
    result = result.replace(/\[([^\]]+)\]/g, '$1');
  }
  return result;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * HTML verse for clipboard: italicize bracket words when enabled. Paragraph marks are never copied.
 */
export function formatVerseHtml(
  text: string,
  flags: VerseMarkupFlags = {},
  settings: Pick<VerseMarkupSettings, 'italics'>
): string {
  const interpretBrackets = Boolean(flags.italiciseBrackets);
  const interpretParagraphs = Boolean(flags.paragraphMarks);

  if (!interpretBrackets && !interpretParagraphs) {
    return escapeHtml(text);
  }

  let remaining = text;
  let html = '';

  if (interpretParagraphs && remaining.startsWith('#')) {
    remaining = remaining.slice(1).replace(/^\s*/, '');
  }

  if (!interpretBrackets) {
    return escapeHtml(remaining);
  }

  const parts = remaining.split(BRACKET_TOKEN);
  for (const part of parts) {
    if (!part) {
      continue;
    }

    const match = BRACKET_CONTENTS.exec(part);
    if (match) {
      const words = escapeHtml(match[1]);
      html += settings.italics
        ? `<i style="color:${CLIPBOARD_MUTED_COLOR};">${words}</i>`
        : words;
      continue;
    }

    html += escapeHtml(part);
  }

  return html;
}

/**
 * Render verse text, interpreting `#` / `[brackets]` only when the translation opts in.
 * User settings control italics styling and whether paragraph marks are shown.
 */
export function renderVerseMarkers(
  text: string,
  flags: VerseMarkupFlags = {},
  settings: VerseMarkupSettings
): React.ReactNode {
  const interpretBrackets = Boolean(flags.italiciseBrackets);
  const interpretParagraphs = Boolean(flags.paragraphMarks);

  if (!interpretBrackets && !interpretParagraphs) {
    return text;
  }

  const nodes: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  if (interpretParagraphs && remaining.startsWith('#')) {
    remaining = remaining.slice(1).replace(/^\s*/, '');
    if (settings.paragraphMarks) {
      nodes.push(
        <span key={key++} className="verse-paragraph-mark" aria-hidden="true">
          ¶
        </span>
      );
      nodes.push(' ');
    }
  }

  if (!interpretBrackets) {
    if (remaining) {
      nodes.push(remaining);
    }
    return nodes.length === 1 ? nodes[0] : <>{nodes}</>;
  }

  const parts = remaining.split(BRACKET_TOKEN);
  for (const part of parts) {
    if (!part) {
      continue;
    }

    const match = BRACKET_CONTENTS.exec(part);
    if (match) {
      const words = match[1];
      if (settings.italics) {
        nodes.push(
          <span key={key++} className="verse-italics">
            {words}
          </span>
        );
      } else {
        nodes.push(words);
      }
      continue;
    }

    nodes.push(part);
  }

  if (nodes.length === 0) {
    return '';
  }

  return nodes.length === 1 ? nodes[0] : <>{nodes}</>;
}

export function markupFlagsFromBible(bible: {
  italiciseBrackets?: boolean;
  paragraphMarks?: boolean;
} | null | undefined): VerseMarkupFlags {
  return {
    italiciseBrackets: Boolean(bible?.italiciseBrackets),
    paragraphMarks: Boolean(bible?.paragraphMarks),
  };
}
