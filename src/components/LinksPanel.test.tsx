import { render, waitFor } from '@testing-library/react';
import LinksPanel from './LinksPanel';
import { useAppSelector } from '../store/hooks';
import { hyperlinkService } from '../services/hyperlinkService';
import type { PanelTab } from '../models/tab';

jest.mock('../store/hooks', () => ({
  useAppSelector: jest.fn(),
}));

jest.mock('../services/hyperlinkService', () => ({
  hyperlinkService: {
    getHyperlinksForVerse: jest.fn(),
  },
}));

const linksTab: PanelTab = {
  id: 'tab-links-1',
  type: 'links',
  title: 'Links',
  iconClass: 'fa-solid fa-link',
  verseContext: { book: 'Genesis', chapter: 1, verse: 1 },
  createdAt: 1,
  updatedAt: 1,
};

describe('LinksPanel visibility gating', () => {
  beforeEach(() => {
    (useAppSelector as unknown as jest.Mock).mockImplementation((selector: (state: unknown) => unknown) => (
      selector({ ui: { sourceUrls: [] } })
    ));
    (hyperlinkService.getHyperlinksForVerse as jest.Mock).mockReset();
    (hyperlinkService.getHyperlinksForVerse as jest.Mock).mockResolvedValue([]);
  });

  it('does not fetch links for an inactive tab', () => {
    render(<LinksPanel tab={linksTab} isActive={false} />);
    expect(hyperlinkService.getHyperlinksForVerse).not.toHaveBeenCalled();
  });

  it('does not fetch when an inactive tab loses verse context after a chapter change', () => {
    const { rerender } = render(<LinksPanel tab={linksTab} isActive={false} />);

    rerender(<LinksPanel tab={{ ...linksTab, verseContext: undefined }} isActive={false} />);

    expect(hyperlinkService.getHyperlinksForVerse).not.toHaveBeenCalled();
  });

  it('does not refetch while inactive after the tab has been viewed', async () => {
    const { rerender } = render(<LinksPanel tab={linksTab} isActive={true} />);

    await waitFor(() => {
      expect(hyperlinkService.getHyperlinksForVerse).toHaveBeenCalled();
    });

    const nextVerse = { book: 'Romans', chapter: 10, verse: 9 } as const;
    rerender(<LinksPanel
      tab={{ ...linksTab, verseContext: nextVerse }}
      isActive={false}
    />);

    expect(hyperlinkService.getHyperlinksForVerse).not.toHaveBeenCalledWith(nextVerse, []);
  });

  it('fetches the selected verse when the tab becomes active', async () => {
    const selected = { book: 'Romans', chapter: 10, verse: 9 } as const;
    const { rerender } = render(<LinksPanel
      tab={{ ...linksTab, verseContext: selected }}
      isActive={false}
    />);

    expect(hyperlinkService.getHyperlinksForVerse).not.toHaveBeenCalled();

    rerender(<LinksPanel
      tab={{ ...linksTab, verseContext: selected }}
      isActive={true}
    />);

    await waitFor(() => {
      expect(hyperlinkService.getHyperlinksForVerse).toHaveBeenCalledWith(selected, []);
    });
  });
});
