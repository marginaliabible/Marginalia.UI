import { render } from '@testing-library/react';
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
    (hyperlinkService.getHyperlinksForVerse as jest.Mock).mockResolvedValue([]);
  });

  it('does not fetch links for a tab that has never been viewed', () => {
    render(<LinksPanel tab={linksTab} isActive={false} />);
    expect(hyperlinkService.getHyperlinksForVerse).not.toHaveBeenCalled();
  });

  it('does not fetch when an unviewed tab loses verse context after a chapter change', () => {
    const { rerender } = render(<LinksPanel tab={linksTab} isActive={false} />);

    rerender(<LinksPanel tab={{ ...linksTab, verseContext: undefined }} isActive={false} />);

    expect(hyperlinkService.getHyperlinksForVerse).not.toHaveBeenCalled();
  });
});
