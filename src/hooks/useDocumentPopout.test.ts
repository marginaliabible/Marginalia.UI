import { act, renderHook } from '@testing-library/react';
import { routeInteraction } from '../services/windowRouting';
import { useBackToVerses } from './useDocumentPopout';

let mockIsDocumentWindow = false;

jest.mock('../services/windowChannel', () => ({
  DOCUMENT_WINDOW_NAME_PREFIX: 'marginalia-document-',
  isPanelWindow: false,
  get isDocumentWindow() {
    return mockIsDocumentWindow;
  },
}));

jest.mock('../services/windowRouting', () => ({
  registerWindowRef: jest.fn(),
  routeInteraction: jest.fn(),
}));

jest.mock('../services/screenPlacement', () => ({
  getScreenLayout: jest.fn(),
  moveToOtherScreen: jest.fn(),
  offerScreenPlacement: jest.fn(),
}));

const mockDispatch = jest.fn();
let mockUi: { selectedBook: string | null; selectedChapter: number; selectedVerses: number[] };

jest.mock('../store/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: jest.fn(),
}));

jest.mock('react-redux', () => ({
  useStore: () => ({ getState: () => ({ ui: mockUi }) }),
}));

const routeMock = routeInteraction as jest.MockedFunction<typeof routeInteraction>;

describe('useBackToVerses', () => {
  beforeEach(() => {
    mockDispatch.mockReset();
    routeMock.mockReset();
    mockUi = { selectedBook: 'Romans', selectedChapter: 8, selectedVerses: [28, 29] };
  });

  it('closes the document in a Bible window', () => {
    mockIsDocumentWindow = false;
    const { result } = renderHook(() => useBackToVerses());

    act(() => result.current());

    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'ui/closeDocumentViewer' }));
    expect(routeMock).not.toHaveBeenCalled();
  });

  it('shows the selected verses in the Bible window from a document window, keeping its own document', () => {
    mockIsDocumentWindow = true;
    const { result } = renderHook(() => useBackToVerses());

    act(() => result.current());

    expect(mockDispatch).not.toHaveBeenCalled();
    expect(routeMock).toHaveBeenCalledTimes(1);
    const [command, applyLocally, options] = routeMock.mock.calls[0];
    expect(command).toEqual({
      kind: 'bible',
      type: 'show-verses',
      payload: { context: expect.objectContaining({ book: 'Romans', chapter: 8, verse: 28, verses: [28, 29] }) },
    });
    expect(options).toBeUndefined();
    applyLocally();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('falls back to the first verse of the chapter when nothing is selected', () => {
    mockIsDocumentWindow = true;
    mockUi = { selectedBook: 'Romans', selectedChapter: 8, selectedVerses: [] };
    const { result } = renderHook(() => useBackToVerses());

    act(() => result.current());

    const [command] = routeMock.mock.calls[0];
    expect(command).toEqual({
      kind: 'bible',
      type: 'show-verses',
      payload: { context: { book: 'Romans', chapter: 8, verse: 1 } },
    });
  });
});
