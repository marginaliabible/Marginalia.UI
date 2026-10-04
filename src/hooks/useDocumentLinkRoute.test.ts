import { act, renderHook, waitFor } from '@testing-library/react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { bibleService } from '../services/bibleService';
import { routeInteraction } from '../services/windowRouting';
import { REOPEN_DOCUMENT_LINK_EVENT } from '../App';
import { DOCUMENT_LINK_NOT_FOUND_MESSAGE, openDocumentLinkHere, useDocumentLinkRoute } from './useDocumentLinkRoute';

jest.mock('../store/slices/bibleSlice', () => ({
  openVerseTabs: (payload: unknown) => ({ type: 'bible/openVerseTabs', payload }),
}));

jest.mock('../store/hooks', () => ({
  useAppDispatch: jest.fn(),
  useAppSelector: jest.fn(),
}));

jest.mock('../services/bibleService', () => ({
  bibleService: {
    findDocumentByLink: jest.fn(),
    getResourcesForVerse: jest.fn(),
  },
}));

jest.mock('../services/windowRouting', () => ({
  routeInteraction: jest.fn(),
}));

interface TestUiState {
  sourceUrls: string[];
  selectedBook: string | null;
  selectedChapter: number;
  selectedVerses: number[];
  pdfViewer: { isOpen: boolean };
}

const RESOLVED = {
  libraryId: 'cloud',
  documentId: 'drive-file-1',
  title: 'Synced Commentary',
  hash: 'abc',
  cloudProvider: 'google',
  viewer: 'markup',
  url: 'https://storage.example.com/documents/ab/c/abc/pages/',
};

const versePayload = (verse: number, raws: string[]) => ({
  reference: { book: 'Romans', chapter: 8, verse },
  tags: [],
  documents: [{
    libraryId: 'cloud',
    libraryLabel: 'Google Drive',
    documentId: 'drive-file-1',
    title: 'Synced Commentary',
    tags: [],
    pages: [12],
    pageLinks: [{ page: 12, url: RESOLVED.url, raws }],
    link: { doc: 'abc' },
  }],
});

const openAction = (matchRaws: string[]) => ({
  type: 'ui/openDocumentViewer',
  payload: {
    sourceUrl: 'https://storage.example.com/documents/ab/c/abc/pages/index.html',
    page: 12,
    title: 'Synced Commentary',
    matchRaws,
    kind: 'markup',
    syncItem: { provider: 'google', itemId: 'drive-file-1' },
  },
});

describe('useDocumentLinkRoute', () => {
  const dispatch = jest.fn();
  let ui: TestUiState;
  let tabs: Array<{ type: string }>;

  const setHash = (hash: string) => {
    window.history.replaceState(null, '', `/${hash}`);
  };

  beforeEach(() => {
    dispatch.mockReset();
    ui = {
      sourceUrls: [],
      selectedBook: null,
      selectedChapter: 1,
      selectedVerses: [],
      pdfViewer: { isOpen: false },
    };
    (useAppDispatch as unknown as jest.Mock).mockReturnValue(dispatch);
    tabs = [{ type: 'resources' }];
    (useAppSelector as unknown as jest.Mock).mockImplementation((selector: (state: unknown) => unknown) => (
      selector({ ui, bible: { tabs } })
    ));
    (routeInteraction as jest.Mock).mockReset().mockImplementation((_command: unknown, applyLocally: () => void) => {
      applyLocally();
      return 'local';
    });
    (bibleService.findDocumentByLink as jest.Mock).mockReset().mockResolvedValue(RESOLVED);
    (bibleService.getResourcesForVerse as jest.Mock).mockReset()
      .mockImplementation(async (_book: string, _chapter: number, verse: number) => (
        versePayload(verse, verse === 28 ? ['Rom 8:28'] : [`Rom 8:${verse}`])
      ));
    setHash('');
  });

  it('opens the linked page with the verse reference highlighted on load', async () => {
    setHash('#/Romans/8/28?doc=abc&page=12');

    renderHook(() => useDocumentLinkRoute({ ready: true }));

    await waitFor(() => expect(dispatch).toHaveBeenCalledWith(openAction(['Rom 8:28'])));
    expect(bibleService.findDocumentByLink).toHaveBeenCalledWith({ doc: 'abc', page: 12 }, []);
    expect(dispatch).toHaveBeenCalledWith({ type: 'ui/setDocumentLinkNotice', payload: null });
  });

  it('opens the Resources tab on a fresh load so the side panel shows', async () => {
    tabs = [];
    setHash('#/Romans/8/28?doc=abc&page=12');

    renderHook(() => useDocumentLinkRoute({ ready: true }));

    await waitFor(() => expect(dispatch).toHaveBeenCalledWith(openAction(['Rom 8:28'])));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'bible/openVerseTabs',
      payload: { book: 'Romans', chapter: 8, verse: 28, verses: [28], hasResources: true, preferPanel: 'resources' },
    });
  });

  it('leaves existing panel tabs alone', async () => {
    setHash('#/Romans/8/28?doc=abc&page=12');

    renderHook(() => useDocumentLinkRoute({ ready: true }));

    await waitFor(() => expect(dispatch).toHaveBeenCalledWith(openAction(['Rom 8:28'])));
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'bible/openVerseTabs' }));
  });

  it('waits until the app is ready', async () => {
    setHash('#/Romans/8/28?doc=abc&page=12');

    const { rerender } = renderHook(({ ready }) => useDocumentLinkRoute({ ready }), { initialProps: { ready: false } });
    expect(bibleService.findDocumentByLink).not.toHaveBeenCalled();

    rerender({ ready: true });
    await waitFor(() => expect(dispatch).toHaveBeenCalledWith(openAction(['Rom 8:28'])));
  });

  it('opens a link when the hash changes', async () => {
    renderHook(() => useDocumentLinkRoute({ ready: true }));
    expect(bibleService.findDocumentByLink).not.toHaveBeenCalled();

    act(() => {
      setHash('#/Romans/8/28?doc=abc&page=12');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    await waitFor(() => expect(dispatch).toHaveBeenCalledWith(openAction(['Rom 8:28'])));
  });

  it('sends a clicked link to the document window', async () => {
    (routeInteraction as jest.Mock).mockReturnValue('remote');
    renderHook(() => useDocumentLinkRoute({ ready: true }));

    act(() => {
      setHash('#/Romans/8/28?doc=abc&page=12');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    expect(routeInteraction).toHaveBeenCalledWith(
      { kind: 'document', type: 'open-document-link', payload: { hash: '#/Romans/8/28?doc=abc&page=12' } },
      expect.any(Function)
    );
    expect(bibleService.findDocumentByLink).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('#/Romans/8/28');
  });

  it('keeps a link sent to this window here, even when the hash is read again before its hashchange', async () => {
    (routeInteraction as jest.Mock).mockReturnValue('remote');
    (bibleService.findDocumentByLink as jest.Mock).mockImplementation(() => (
      new Promise((resolve) => setTimeout(() => resolve(RESOLVED), 50))
    ));
    setHash('#/Romans/8/28');
    const { rerender } = renderHook(() => useDocumentLinkRoute({ ready: true }));

    openDocumentLinkHere('#/Romans/8/28?doc=abc&page=12');
    ui = { ...ui, sourceUrls: [] };
    rerender();

    await waitFor(() => expect(dispatch).toHaveBeenCalledWith(openAction(['Rom 8:28'])));
    expect(routeInteraction).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'document' }),
      expect.any(Function)
    );
  });

  it('highlights every selected verse when the link verse is part of the selection', async () => {
    ui.selectedBook = 'Romans';
    ui.selectedChapter = 8;
    ui.selectedVerses = [28, 29];
    setHash('#/Romans/8/28?doc=abc&page=12');

    renderHook(() => useDocumentLinkRoute({ ready: true }));

    await waitFor(() => expect(dispatch).toHaveBeenCalledWith(openAction(['Rom 8:28', 'Rom 8:29'])));
  });

  it('re-opens the same link on request', async () => {
    setHash('#/Romans/8/28?doc=abc&page=12');
    renderHook(() => useDocumentLinkRoute({ ready: true }));
    await waitFor(() => expect(bibleService.findDocumentByLink).toHaveBeenCalledTimes(1));

    act(() => {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    act(() => {
      window.dispatchEvent(new Event(REOPEN_DOCUMENT_LINK_EVENT));
    });

    await waitFor(() => expect(bibleService.findDocumentByLink).toHaveBeenCalledTimes(2));
  });

  it('shows a notice when the document is not in the libraries, then retries when sources change', async () => {
    (bibleService.findDocumentByLink as jest.Mock).mockResolvedValueOnce(null);
    setHash('#/Romans/8/28?doc=abc&page=12');

    const { rerender } = renderHook(() => useDocumentLinkRoute({ ready: true }));

    await waitFor(() => expect(dispatch).toHaveBeenCalledWith({
      type: 'ui/setDocumentLinkNotice',
      payload: DOCUMENT_LINK_NOT_FOUND_MESSAGE,
    }));
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ui/openDocumentViewer' }));

    ui = { ...ui, sourceUrls: ['https://storage.example.com/users/u1/library.json'] };
    rerender();

    await waitFor(() => expect(dispatch).toHaveBeenCalledWith(openAction(['Rom 8:28'])));
    expect(bibleService.findDocumentByLink).toHaveBeenLastCalledWith(
      { doc: 'abc', page: 12 },
      ['https://storage.example.com/users/u1/library.json']
    );
  });

  it('strips the document params from the hash when the viewer closes', async () => {
    ui.pdfViewer = { isOpen: true };
    setHash('#/Romans/8/28?q=love&doc=abc&page=12');
    const { rerender } = renderHook(() => useDocumentLinkRoute({ ready: false }));

    ui = { ...ui, pdfViewer: { isOpen: false } };
    rerender();

    expect(window.location.hash).toBe('#/Romans/8/28?q=love');
  });
});
