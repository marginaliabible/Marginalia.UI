import { render, waitFor } from '@testing-library/react';
import ResourcesPanel from './ResourcesPanel';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { bibleService } from '../services/bibleService';
import type { PanelTab } from '../models/tab';

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
        ui: { sourceUrls: [], resourceHiddenTags: [], pdfViewer: { isOpen: false, kind: 'pdf', sourceUrl: null, title: null, page: 1, matchRaw: null, focusNonce: 0 } },
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

    expect(bibleService.getResourcesForVerse).not.toHaveBeenCalledWith('Romans', 10, 9, []);
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
      expect(bibleService.getResourcesForVerse).toHaveBeenCalledWith('Romans', 10, 9, []);
    });
  });
});
