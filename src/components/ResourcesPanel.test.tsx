import { fireEvent, render, waitFor } from '@testing-library/react';
import ResourcesPanel from './ResourcesPanel';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { bibleService } from '../services/bibleService';
import type { PanelTab } from '../models/tab';
import type { VerseResourcesPayload } from '../services/bibleService';
import { EMPTY_SOURCE_PREFERENCES } from '../utils/sourceSubscriptions';

jest.mock('../hooks/useDocumentScriptureNavigation', () => ({
  useRevealVerseSelectionInBible: () => jest.fn(),
}));

jest.mock('../store/hooks', () => ({
  useAppDispatch: jest.fn(),
  useAppSelector: jest.fn(),
}));

jest.mock('../services/bibleService', () => ({
  bibleService: {
    getResourcesForVerse: jest.fn(),
  },
}));

jest.mock('../utils/pdfProxy', () => ({
  buildPdfProxyUrl: jest.fn((url: string) => url),
}));

jest.mock('../utils/resourceTagColors', () => ({
  getOrAssignResourceTagColors: jest.fn(() => new Map()),
  TAG_COLOR_PALETTE: [],
}));

const resourcesTab: PanelTab = {
  id: 'tab-resources-1',
  type: 'resources',
  title: 'Resources',
  iconClass: 'fa-solid fa-book-open-reader',
  verseContext: { book: 'Genesis', chapter: 1, verse: 1 },
  createdAt: 1,
  updatedAt: 1,
};

describe('ResourcesPanel visibility gating', () => {
  beforeEach(() => {
    (useAppDispatch as unknown as jest.Mock).mockReturnValue(jest.fn());
    (useAppSelector as unknown as jest.Mock).mockImplementation((selector: (state: unknown) => unknown) => (
      selector({
        ui: {
          sourceUrls: [],
          resourceHiddenTags: [],
          resourceVerseMatchMode: 'all',
          translatorItalics: true,
          translatorParagraphMarks: true,
          pdfViewer: { isOpen: false, kind: 'pdf', sourceUrl: null, title: null, page: 1, matchRaws: [], focusNonce: 0 },
        },
        bible: { currentBible: null, isPanelDetached: false },
      })
    ));
    (bibleService.getResourcesForVerse as jest.Mock).mockReset();
    (bibleService.getResourcesForVerse as jest.Mock).mockResolvedValue({
      tags: [],
      documents: [],
    });
  });

  it('does not fetch resources while the tab is inactive', () => {
    render(<ResourcesPanel tab={resourcesTab} isActive={false} />);
    expect(bibleService.getResourcesForVerse).not.toHaveBeenCalled();
  });

  it('does not refetch while inactive when verseContext changes', async () => {
    const { rerender } = render(<ResourcesPanel tab={resourcesTab} isActive={true} />);

    await waitFor(() => {
      expect(bibleService.getResourcesForVerse).toHaveBeenCalled();
    });

    rerender(<ResourcesPanel
      tab={{ ...resourcesTab, verseContext: { book: 'Romans', chapter: 10, verse: 9 } }}
      isActive={false}
    />);

    expect(bibleService.getResourcesForVerse).not.toHaveBeenCalledWith('Romans', 10, 9, [], EMPTY_SOURCE_PREFERENCES);
  });

  it('fetches the selected verse when the tab becomes active', async () => {
    const { rerender } = render(<ResourcesPanel
      tab={{ ...resourcesTab, verseContext: { book: 'Romans', chapter: 10, verse: 9 } }}
      isActive={false}
    />);

    expect(bibleService.getResourcesForVerse).not.toHaveBeenCalled();

    rerender(<ResourcesPanel
      tab={{ ...resourcesTab, verseContext: { book: 'Romans', chapter: 10, verse: 9 } }}
      isActive={true}
    />);

    await waitFor(() => {
      expect(bibleService.getResourcesForVerse).toHaveBeenCalledWith('Romans', 10, 9, [], EMPTY_SOURCE_PREFERENCES);
    });
  });
});

const documentPayload = (
  verse: number,
  documents: VerseResourcesPayload['documents']
): VerseResourcesPayload => ({
  reference: { book: 'Genesis', chapter: 1, verse },
  tags: Array.from(new Set(documents.flatMap((document) => document.tags))),
  documents,
});

describe('ResourcesPanel page links', () => {
  const dispatch = jest.fn();

  beforeEach(() => {
    dispatch.mockReset();
    (useAppDispatch as unknown as jest.Mock).mockReturnValue(dispatch);
    (useAppSelector as unknown as jest.Mock).mockImplementation((selector: (state: unknown) => unknown) => (
      selector({
        ui: {
          sourceUrls: [],
          resourceHiddenTags: [],
          resourceVerseMatchMode: 'all',
          translatorItalics: true,
          translatorParagraphMarks: true,
          pdfViewer: { isOpen: false, kind: 'pdf', sourceUrl: null, title: null, page: 1, matchRaws: [], focusNonce: 0 },
        },
        bible: { currentBible: null, isPanelDetached: false },
      })
    ));
    (bibleService.getResourcesForVerse as jest.Mock).mockReset();
    (bibleService.getResourcesForVerse as jest.Mock).mockResolvedValue(documentPayload(1, [{
      libraryId: 'lib-a',
      libraryLabel: 'Library A',
      documentId: 'doc',
      title: 'Commentary',
      tags: [],
      pages: [2, 5],
      pageLinks: [
        { page: 2, url: 'https://example.com/doc.pdf', raws: ['1 Pet. 2:24', '1Pe 2:24'] },
        { page: 5, url: 'https://example.com/doc.pdf', raws: ['1 Peter 2:24'] },
      ],
    }, {
      libraryId: 'lib-b',
      libraryLabel: 'Library B',
      documentId: 'doc',
      title: 'Commentary',
      tags: [],
      pages: [2],
      pageLinks: [{ page: 2, url: 'https://example.com/doc.pdf', raws: ['1 Pt 2:24', '1Pe 2:24'] }],
    }]));
  });

  it('shows each page once and opens it with every reference text for that page', async () => {
    const { findAllByRole } = render(<ResourcesPanel tab={resourcesTab} isActive={true} />);

    const pageButtons = await findAllByRole('button', { name: /^\d+$/ });
    expect(pageButtons.map((button) => button.textContent)).toEqual(['2', '5']);

    fireEvent.click(pageButtons[0]!);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'ui/openDocumentViewer',
      payload: {
        sourceUrl: 'https://example.com/doc.pdf',
        page: 2,
        title: 'Commentary',
        matchRaws: ['1 Pet. 2:24', '1Pe 2:24', '1 Pt 2:24'],
        kind: 'pdf',
        syncItem: null,
      },
    });
  });
});

describe('ResourcesPanel multi-verse selection', () => {
  const dispatch = jest.fn();
  const multiVerseTab: PanelTab = {
    ...resourcesTab,
    verseContext: { book: 'Genesis', chapter: 1, verse: 1, verses: [1, 2] },
  };

  beforeEach(() => {
    dispatch.mockReset();
    (useAppDispatch as unknown as jest.Mock).mockReturnValue(dispatch);
    (useAppSelector as unknown as jest.Mock).mockImplementation((selector: (state: unknown) => unknown) => (
      selector({
        ui: {
          sourceUrls: [],
          resourceHiddenTags: [],
          resourceVerseMatchMode: 'all',
          translatorItalics: true,
          translatorParagraphMarks: true,
          pdfViewer: { isOpen: false, kind: 'pdf', sourceUrl: null, title: null, page: 1, matchRaws: [], focusNonce: 0 },
        },
        bible: {
          isPanelDetached: false,
          currentBible: {
            books: [{
              name: 'Genesis',
              chapters: [{
                chapter: 1,
                verses: [
                  { verse: 1, text: 'In the beginning God created the heaven and the earth.' },
                  { verse: 2, text: 'And the earth was without form, and void.' },
                ],
              }],
            }],
          },
        },
      })
    ));
    (bibleService.getResourcesForVerse as jest.Mock).mockReset();
    (bibleService.getResourcesForVerse as jest.Mock).mockImplementation(async (
      _book: string,
      _chapter: number,
      verse: number
    ) => {
      if (verse === 1) {
        return documentPayload(1, [{
          libraryId: 'lib',
          libraryLabel: 'Library',
          documentId: 'shared',
          title: 'Shared Commentary',
          tags: ['commentary'],
          pages: [3],
          pageLinks: [{ page: 3, url: 'https://example.com/shared#3' }],
        }, {
          libraryId: 'lib',
          libraryLabel: 'Library',
          documentId: 'first-only',
          title: 'First Only',
          tags: ['map'],
          pages: [8],
          pageLinks: [{ page: 8, url: 'https://example.com/first#8' }],
        }]);
      }

      return documentPayload(2, [{
        libraryId: 'lib',
        libraryLabel: 'Library',
        documentId: 'shared',
        title: 'Shared Commentary',
        tags: ['commentary'],
        pages: [4],
        pageLinks: [{ page: 4, url: 'https://example.com/shared#4' }],
      }]);
    });
  });

  it('previews every selected verse and fetches resources for each', async () => {
    const { findByText } = render(<ResourcesPanel tab={multiVerseTab} isActive={true} />);

    await waitFor(() => {
      expect(bibleService.getResourcesForVerse).toHaveBeenCalledWith('Genesis', 1, 1, [], EMPTY_SOURCE_PREFERENCES);
      expect(bibleService.getResourcesForVerse).toHaveBeenCalledWith('Genesis', 1, 2, [], EMPTY_SOURCE_PREFERENCES);
    });

    expect(await findByText('Genesis 1:1-2')).toBeTruthy();
    expect(await findByText('In the beginning God created the heaven and the earth.')).toBeTruthy();
    expect(await findByText('And the earth was without form, and void.')).toBeTruthy();
    expect(await findByText('Shared Commentary')).toBeTruthy();
    expect(await findByText('ALL')).toBeTruthy();
    expect(await findByText('ANY')).toBeTruthy();
  });

  it('keeps only resources present in every selected verse when ALL is selected', async () => {
    const { findByText, queryByText } = render(<ResourcesPanel tab={multiVerseTab} isActive={true} />);

    expect(await findByText('Shared Commentary')).toBeTruthy();
    expect(queryByText('First Only')).toBeNull();
  });

  it('dispatches ANY when the match toggle is changed', async () => {
    const { findByText } = render(<ResourcesPanel tab={multiVerseTab} isActive={true} />);
    const anyButton = await findByText('ANY');

    fireEvent.click(anyButton);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'ui/setResourceVerseMatchMode',
      payload: 'any',
    });
  });

  it('limits the sticky verse preview to five verses and shows overflow', async () => {
    (useAppSelector as unknown as jest.Mock).mockImplementation((selector: (state: unknown) => unknown) => (
      selector({
        ui: {
          sourceUrls: [],
          resourceHiddenTags: [],
          resourceVerseMatchMode: 'all',
          translatorItalics: true,
          translatorParagraphMarks: true,
          pdfViewer: { isOpen: false, kind: 'pdf', sourceUrl: null, title: null, page: 1, matchRaws: [], focusNonce: 0 },
        },
        bible: {
          isPanelDetached: false,
          currentBible: {
            books: [{
              name: 'Genesis',
              chapters: [{
                chapter: 1,
                verses: [1, 2, 3, 4, 5, 6, 7].map((verse) => ({
                  verse,
                  text: `Verse ${verse}`,
                })),
              }],
            }],
          },
        },
      })
    ));
    (bibleService.getResourcesForVerse as jest.Mock).mockResolvedValue(documentPayload(1, []));

    const { findByText, queryByText } = render(
      <ResourcesPanel
        tab={{
          ...resourcesTab,
          verseContext: {
            book: 'Genesis',
            chapter: 1,
            verse: 1,
            verses: [1, 2, 3, 4, 5, 6, 7],
          },
        }}
        isActive={true}
      />
    );

    expect(await findByText('Genesis 1:1-7')).toBeTruthy();
    expect(await findByText('Verse 5')).toBeTruthy();
    expect(queryByText('Verse 6')).toBeNull();
    expect(await findByText('...')).toBeTruthy();
  });
});
