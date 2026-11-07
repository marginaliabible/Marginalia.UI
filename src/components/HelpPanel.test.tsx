import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import HelpPanel from './HelpPanel';
import { HelpTourProvider } from '../help/HelpTourContext';
import { helpContentService } from '../services/helpContentService';
import type { PanelTab } from '../models/tab';

jest.mock('../services/helpContentService', () => ({
  helpContentService: {
    getManifest: jest.fn(),
    getSearchIndex: jest.fn(),
    getArticleMarkdown: jest.fn(),
  },
}));

jest.mock('../help/helpContentHotReload', () => ({
  subscribeHelpContentHotReload: () => () => {},
}));

jest.mock('../services/appBuildIdentity', () => ({
  getAppVersion: () => 'test',
}));

jest.mock('remark-gfm', () => () => {});

jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({
    children,
    components,
  }: {
    children: string;
    components?: {
      a?: React.FC<{ href?: string; children?: React.ReactNode }>;
      h2?: React.FC<{ children?: React.ReactNode }>;
    };
  }) => {
    const Anchor = components?.a;
    const tourMatch = /\[([^\]]+)]\(tour:([^)]+)\)/.exec(children);
    const targetMatch = /\[([^\]]+)]\(target:([^)]+)\)/.exec(children);
    const titleMatch = /^#\s+(.+)$/m.exec(children);

    return (
      <div>
        {titleMatch ? <h1>{titleMatch[1]}</h1> : null}
        {tourMatch && Anchor ? (
          <Anchor href={`tour:${tourMatch[2]}`}>{tourMatch[1]}</Anchor>
        ) : null}
        {targetMatch && Anchor ? (
          <Anchor href={`target:${targetMatch[2]}`}>{targetMatch[1]}</Anchor>
        ) : null}
        <div>{children}</div>
      </div>
    );
  },
}));

const helpTab: PanelTab = {
  id: 'tab-help-1',
  type: 'help',
  title: 'Help',
  iconClass: 'fa-regular fa-circle-question',
  createdAt: 1,
  updatedAt: 1,
};

describe('HelpPanel', () => {
  const startTour = jest.fn();
  const startTourAtTarget = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (helpContentService.getManifest as jest.Mock).mockResolvedValue({
      schemaVersion: 1,
      articles: [
        { id: 'settings', title: 'Settings', section: 'Basics', path: 'articles/settings.md' },
        { id: 'search', title: 'Searching Scripture', section: 'Basics', path: 'articles/search.md' },
      ],
      tours: [{ id: 'open-settings', path: 'tours/open-settings.json' }],
    });
    (helpContentService.getSearchIndex as jest.Mock).mockResolvedValue({
      schemaVersion: 1,
      documents: [
        {
          id: 'settings',
          title: 'Settings',
          section: 'Basics',
          headings: ['Open Settings'],
          headingSlugs: ['open-settings'],
          body: 'Click the gear icon in Settings',
        },
        {
          id: 'search',
          title: 'Searching Scripture',
          section: 'Basics',
          headings: [],
          body: 'Search across loaded translations',
        },
      ],
    });
    (helpContentService.getArticleMarkdown as jest.Mock).mockImplementation(async (path: string) => {
      if (path.includes('settings')) {
        return '# Settings\n\n[Show me how](tour:open-settings)\n\nGear icon details.';
      }
      return '# Searching Scripture\n\nUse the search box.';
    });
  });

  const renderPanel = () => render(
    <HelpTourProvider startTour={startTour} startTourAtTarget={startTourAtTarget}>
      <HelpPanel tab={helpTab} isActive />
    </HelpTourProvider>
  );

  it('renders the TOC and loads the first article', async () => {
    renderPanel();

    expect(await screen.findByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Searching Scripture' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    });
  });

  it('navigates from search hits to an article', async () => {
    renderPanel();
    await screen.findByRole('button', { name: 'Settings' });

    fireEvent.change(screen.getByLabelText('Search help'), { target: { value: 'gear' } });

    const hit = await screen.findByRole('button', { name: /Settings/i });
    fireEvent.click(hit);

    await waitFor(() => {
      expect(helpContentService.getArticleMarkdown).toHaveBeenCalledWith('articles/settings.md');
    });
  });

  it('starts a tour from a tour: markdown link', async () => {
    renderPanel();
    const showMeHow = await screen.findByRole('button', { name: 'Show me how' });
    fireEvent.click(showMeHow);
    expect(startTour).toHaveBeenCalledWith('open-settings');
  });

  it('starts a tour step from a target: markdown link', async () => {
    (helpContentService.getArticleMarkdown as jest.Mock).mockResolvedValue(
      '# Settings\n\nSee the [theme](target:settings-theme) control.\n'
    );
    renderPanel();
    const themeLink = await screen.findByRole('button', { name: 'theme' });
    fireEvent.click(themeLink);
    expect(startTourAtTarget).toHaveBeenCalledWith('settings-theme');
  });

  it('goes back to the previous help topic', async () => {
    renderPanel();
    await screen.findByRole('heading', { name: 'Settings' });

    const backButton = screen.getByRole('button', { name: 'Back to previous help topic' });
    expect(backButton).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Searching Scripture' }));
    await screen.findByRole('heading', { name: 'Searching Scripture' });
    expect(backButton).toBeEnabled();

    fireEvent.click(backButton);
    await screen.findByRole('heading', { name: 'Settings' });
    expect(backButton).toBeDisabled();
  });
});
