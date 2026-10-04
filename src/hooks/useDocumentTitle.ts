import { useEffect, useMemo } from 'react';
import { useAppSelector } from '../store/hooks';
import { formatWindowTitle, getWindowLabel, type WindowLabelInput } from '../utils/windowLabel';

export const useWindowLabelInput = (isPanelWindow: boolean): WindowLabelInput => {
  const documentOpen = useAppSelector((state) => state.ui.pdfViewer.isOpen);
  const documentTitle = useAppSelector((state) => state.ui.pdfViewer.title);
  const selectedBook = useAppSelector((state) => state.ui.selectedBook);
  const selectedChapter = useAppSelector((state) => state.ui.selectedChapter);
  const selectedVerses = useAppSelector((state) => state.ui.selectedVerses);

  return useMemo(() => ({
    isPanelWindow,
    documentOpen,
    documentTitle,
    selectedBook,
    selectedChapter,
    selectedVerses,
  }), [documentOpen, documentTitle, isPanelWindow, selectedBook, selectedChapter, selectedVerses]);
};

export const useWindowLabel = (isPanelWindow: boolean): string | null => {
  const input = useWindowLabelInput(isPanelWindow);
  return useMemo(() => getWindowLabel(input), [input]);
};

export const useDocumentTitle = (isPanelWindow: boolean): void => {
  const input = useWindowLabelInput(isPanelWindow);
  const title = useMemo(() => formatWindowTitle(input), [input]);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.title = title;
    }
  }, [title]);
};
