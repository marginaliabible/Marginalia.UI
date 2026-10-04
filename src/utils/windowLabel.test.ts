import { formatWindowTitle, getWindowLabel, type WindowLabelInput } from './windowLabel';

const base: WindowLabelInput = {
  isPanelWindow: false,
  documentOpen: false,
  documentTitle: null,
  selectedBook: 'Romans',
  selectedChapter: 10,
  selectedVerses: [12],
};

describe('window titles', () => {
  it('names the selected scripture while browsing the Bible', () => {
    expect(getWindowLabel(base)).toBe('Romans 10:12');
    expect(formatWindowTitle(base)).toBe('Marginalia - Romans 10:12');
    expect(formatWindowTitle({ ...base, selectedVerses: [] })).toBe('Marginalia - Romans 10');
  });

  it('names the open document', () => {
    const input = { ...base, documentOpen: true, documentTitle: "Thayer's Greek Lexicon" };
    expect(getWindowLabel(input)).toBe("Thayer's Greek Lexicon");
    expect(formatWindowTitle(input)).toBe("Marginalia - Thayer's Greek Lexicon - Document");
    expect(formatWindowTitle({ ...input, documentTitle: '  ' })).toBe('Marginalia - Untitled - Document');
  });

  it('always names the panel window "Panel"', () => {
    const input = { ...base, isPanelWindow: true, documentOpen: true, documentTitle: 'Ignored' };
    expect(getWindowLabel(input)).toBe('Panel');
    expect(formatWindowTitle(input)).toBe('Marginalia - Panel');
  });

  it('falls back to the app name before a book is selected', () => {
    const input = { ...base, selectedBook: null };
    expect(getWindowLabel(input)).toBeNull();
    expect(formatWindowTitle(input)).toBe('Marginalia');
  });
});
