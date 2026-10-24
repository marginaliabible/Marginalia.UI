import { render, screen } from '@testing-library/react';
import {
  formatVerseHtml,
  markupFlagsFromBible,
  renderVerseMarkers,
  stripVerseMarkers,
} from './verseMarkup';

const optedIn = { italiciseBrackets: true, paragraphMarks: true };
const settingsOn = { italics: true, paragraphMarks: true };
const settingsOff = { italics: false, paragraphMarks: false };

describe('stripVerseMarkers', () => {
  it('leaves text unchanged when flags are off', () => {
    expect(stripVerseMarkers('# And darkness [was] upon', {})).toBe('# And darkness [was] upon');
  });

  it('strips opted-in markers', () => {
    expect(stripVerseMarkers('# And darkness [was] upon', optedIn)).toBe('And darkness was upon');
  });

  it('strips only the opted-in marker kinds', () => {
    expect(stripVerseMarkers('# And darkness [was] upon', { italiciseBrackets: true })).toBe(
      '# And darkness was upon'
    );
    expect(stripVerseMarkers('# And darkness [was] upon', { paragraphMarks: true })).toBe(
      'And darkness [was] upon'
    );
  });
});

describe('renderVerseMarkers', () => {
  it('returns plain text when the translation does not opt in', () => {
    const result = renderVerseMarkers('# And darkness [was] upon', {}, settingsOn);
    expect(result).toBe('# And darkness [was] upon');
  });

  it('italicizes brackets and shows a pilcrow when settings are on', () => {
    render(
      <div data-testid="verse">
        {renderVerseMarkers('# And darkness [was] upon', optedIn, settingsOn)}
      </div>
    );
    const verse = screen.getByTestId('verse');
    expect(verse.querySelector('.verse-paragraph-mark')?.textContent).toBe('¶');
    expect(verse.querySelector('.verse-italics')?.textContent).toBe('was');
    expect(verse.textContent).toBe('¶ And darkness was upon');
  });

  it('omits pilcrow and unwraps brackets without italics when settings are off', () => {
    render(
      <div data-testid="verse">
        {renderVerseMarkers('# And darkness [was] upon', optedIn, settingsOff)}
      </div>
    );
    const verse = screen.getByTestId('verse');
    expect(verse.querySelector('.verse-paragraph-mark')).toBeNull();
    expect(verse.querySelector('.verse-italics')).toBeNull();
    expect(verse.textContent).toBe('And darkness was upon');
  });

  it('keeps literal brackets when italiciseBrackets is false', () => {
    render(
      <div data-testid="verse">
        {renderVerseMarkers('darkness [was] upon', { paragraphMarks: true }, settingsOn)}
      </div>
    );
    expect(screen.getByTestId('verse').textContent).toBe('darkness [was] upon');
  });
});

describe('formatVerseHtml', () => {
  it('formats clipboard HTML with italics when enabled and never includes a pilcrow', () => {
    expect(formatVerseHtml('# And darkness [was] upon', optedIn, settingsOn)).toBe(
      'And darkness <i style="color:#808080;">was</i> upon'
    );
    expect(formatVerseHtml('# And darkness [was] upon', optedIn, settingsOff)).toBe(
      'And darkness was upon'
    );
    expect(formatVerseHtml('# And darkness [was] upon', { paragraphMarks: true }, settingsOn)).toBe(
      'And darkness [was] upon'
    );
  });

  it('leaves literal brackets when the translation does not opt in', () => {
    expect(formatVerseHtml('# And darkness [was] upon', {}, settingsOn)).toBe(
      '# And darkness [was] upon'
    );
  });

  it('escapes HTML special characters outside markup', () => {
    expect(formatVerseHtml('A & B <C>', {}, settingsOn)).toBe('A &amp; B &lt;C&gt;');
  });
});

describe('markupFlagsFromBible', () => {
  it('reads boolean flags from bible data', () => {
    expect(markupFlagsFromBible({ italiciseBrackets: true, paragraphMarks: true })).toEqual({
      italiciseBrackets: true,
      paragraphMarks: true,
    });
    expect(markupFlagsFromBible(null)).toEqual({
      italiciseBrackets: false,
      paragraphMarks: false,
    });
  });
});
