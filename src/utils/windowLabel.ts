import { formatVerseReference } from './scriptureReference';

export const APP_TITLE = 'Marginalia';
export const PANEL_WINDOW_LABEL = 'Panel';
const UNTITLED_DOCUMENT_LABEL = 'Untitled';

export interface WindowLabelInput {
  isPanelWindow: boolean;
  documentOpen: boolean;
  documentTitle: string | null;
  selectedBook: string | null;
  selectedChapter: number;
  selectedVerses: readonly number[];
}

/** What this window shows: "Panel", the open document's title, or the selected scripture reference. */
export const getWindowLabel = (input: WindowLabelInput): string | null => {
  if (input.isPanelWindow) {
    return PANEL_WINDOW_LABEL;
  }

  if (input.documentOpen) {
    return input.documentTitle?.trim() || UNTITLED_DOCUMENT_LABEL;
  }

  return input.selectedBook
    ? formatVerseReference(input.selectedBook, input.selectedChapter, input.selectedVerses)
    : null;
};

export const formatWindowTitle = (input: WindowLabelInput): string => {
  const label = getWindowLabel(input);
  if (!label) {
    return APP_TITLE;
  }

  return !input.isPanelWindow && input.documentOpen
    ? `${APP_TITLE} - ${label} - Document`
    : `${APP_TITLE} - ${label}`;
};
