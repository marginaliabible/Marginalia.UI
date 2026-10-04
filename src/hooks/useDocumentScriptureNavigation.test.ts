import { act, renderHook } from '@testing-library/react';
import { routeInteraction } from '../services/windowRouting';
import { bibleService } from '../services/bibleService';
import { useOpenDocumentScriptureReference } from './useDocumentScriptureNavigation';

jest.mock('../store/slices/bibleSlice', () => ({
  openVerseTabs: (payload: unknown) => ({ type: 'bible/openVerseTabs', payload }),
}));

jest.mock('../services/windowRouting', () => ({
  routeInteraction: jest.fn(),
}));

jest.mock('../services/bibleService', () => ({
  bibleService: { hasResourcesForVerse: jest.fn() },
}));

jest.mock('../App', () => ({
  scrollToVerse: jest.fn(),
  VERSE_REFERENCE_SCROLL_OPTIONS: {},
}));

jest.mock('./useSourcePreferences', () => ({
  useSourcePreferences: () => ({}),
}));

const mockDispatch = jest.fn();
const mockState = {
  ui: { selectedTranslationId: 'KJV', pdfViewer: { isOpen: true }, sourceUrls: [] },
};

jest.mock('../store/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (selector: (state: typeof mockState) => unknown) => selector(mockState),
}));

const routeMock = routeInteraction as jest.MockedFunction<typeof routeInteraction>;

describe('useOpenDocumentScriptureReference', () => {
  beforeEach(() => {
    mockDispatch.mockReset();
    routeMock.mockReset();
    (bibleService.hasResourcesForVerse as jest.Mock).mockResolvedValue(false);
  });

  it('opens the verses in the panel, never as a Bible interaction, and keeps the document open', async () => {
    const onOpen = jest.fn();
    const { result } = renderHook(() => useOpenDocumentScriptureReference(onOpen));

    await act(async () => {
      await result.current({ raw: 'John 3:16-17', book: 'John', chapter: 3, verses: [16, 17] });
    });

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(routeMock).toHaveBeenCalledTimes(1);
    const [command] = routeMock.mock.calls[0];
    expect(command).toEqual({
      kind: 'panel',
      type: 'open-verse-tabs',
      payload: {
        book: 'John',
        chapter: 3,
        verse: 16,
        verses: [16, 17],
        hasResources: false,
        preferPanel: 'translations',
      },
    });

    const actionTypes = mockDispatch.mock.calls.map(([action]) => action.type);
    expect(actionTypes).toContain('ui/setVerseSelection');
    expect(actionTypes).not.toContain('ui/closeDocumentViewer');
  });
});
