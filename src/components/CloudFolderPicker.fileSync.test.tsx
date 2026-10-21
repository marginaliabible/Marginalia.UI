import { fireEvent, render, screen } from '@testing-library/react';
import CloudFolderPicker, { type FolderSelectionTarget } from './CloudFolderPicker';
import type { FederatedSession } from '../services/federatedAuthService';
import { listFolderChildrenForSession } from '../services/cloudConfigProviderService';

jest.mock('../services/cloudConfigProviderService', () => ({
  listFolderChildrenForSession: jest.fn(async () => []),
  computeSupportedFolderSizeForSession: jest.fn(async () => 0),
  listSupportedFolderContentsForSession: jest.fn(async () => ({ totalBytes: 0, files: [] })),
}));

const listFolderChildrenMock = listFolderChildrenForSession as jest.MockedFunction<typeof listFolderChildrenForSession>;

const CHILDREN_BY_FOLDER_ID: Record<string, Awaited<ReturnType<typeof listFolderChildrenForSession>>> = {
  projects: [
    { id: 'sub', name: 'Sub', kind: 'folder', sizeBytes: 0, hasChildren: true },
    { id: 'notes', name: 'Notes.md', kind: 'file', sizeBytes: 10, hasChildren: false },
  ],
  sub: [
    { id: 'deep', name: 'Deep.md', kind: 'file', sizeBytes: 10, hasChildren: false },
  ],
};

function makeSession(accessToken: string): FederatedSession {
  return {
    provider: 'google',
    accessToken,
    expiresAt: Date.now() + 60_000,
    grantedAt: Date.now(),
    profile: { providerAccountId: 'user-1' },
  };
}

const initialSelections = {
  google: [{ id: 'projects', kind: 'folder' as const, name: 'Projects', path: 'Google Drive/Projects', tags: ['Notes'] }],
  microsoft: [],
};
const emptySelections: Record<'google' | 'microsoft', FolderSelectionTarget[]> = {
  google: [],
  microsoft: [],
};
const providerFlags = { google: true, microsoft: false };

function mockMatchMedia(isDesktop: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: query.includes('min-width: 992px') ? isDesktop : false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });
}

function renderPicker(
  session: FederatedSession,
  selections: Record<'google' | 'microsoft', FolderSelectionTarget[]> = initialSelections
) {
  return (
    <CloudFolderPicker
      sessions={{ google: session, microsoft: null }}
      initialSelections={selections}
      providerSyncFilesEnabled={providerFlags}
      linkedProviders={providerFlags}
      focusRequest={null}
      onSelectionsChange={jest.fn()}
      onConnectRequested={jest.fn()}
    />
  );
}

describe('CloudFolderPicker file sync panel', () => {
  beforeEach(() => {
    mockMatchMedia(true);
    listFolderChildrenMock.mockImplementation(async (_session, parentId) => CHILDREN_BY_FOLDER_ID[parentId] ?? []);
  });

  it('keeps expanded right-panel folders showing their children after sessions refresh', async () => {
    const { rerender } = render(renderPicker(makeSession('token-1')));

    fireEvent.click(await screen.findByRole('button', { name: 'Expand Projects' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Expand Sub' }));
    expect(await screen.findByText('Deep.md')).toBeTruthy();

    rerender(renderPicker(makeSession('token-2')));

    expect(await screen.findByText('Deep.md')).toBeTruthy();
    expect(screen.getByText('Notes.md')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Collapse Projects' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Collapse Sub' })).toBeTruthy();
  });

  it('on desktop keeps side-by-side panes without mobile accordion chrome', async () => {
    render(renderPicker(makeSession('token-1')));

    expect(await screen.findByText('Selected Files & Folders')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Select Cloud Providers' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Select Files & Folders' })).toBeNull();
    expect(document.querySelector('.cloud-folder-picker-layout')?.classList.contains('is-mobile-stacked')).toBe(false);
  });

  describe('mobile stacked layout', () => {
    beforeEach(() => {
      mockMatchMedia(false);
    });

    it('defaults to files pane when selections exist and hides the sync header row', async () => {
      render(renderPicker(makeSession('token-1')));

      const providersToggle = await screen.findByRole('button', { name: 'Select Cloud Providers' });
      const filesToggle = screen.getByRole('button', { name: 'Select Files & Folders' });
      expect(providersToggle).toHaveAttribute('aria-expanded', 'false');
      expect(filesToggle).toHaveAttribute('aria-expanded', 'true');
      expect(screen.queryByText('Selected Files & Folders')).toBeNull();
      expect(screen.queryByText('Synchronization')).toBeNull();
      expect(await screen.findByRole('button', { name: 'Expand Projects' })).toBeTruthy();
      expect(document.querySelector('.cloud-folder-picker-layout')?.classList.contains('is-mobile-stacked')).toBe(true);
    });

    it('defaults to providers pane when nothing is selected', async () => {
      render(renderPicker(makeSession('token-1'), emptySelections));

      const providersToggle = await screen.findByRole('button', { name: 'Select Cloud Providers' });
      const filesToggle = screen.getByRole('button', { name: 'Select Files & Folders' });
      expect(providersToggle).toHaveAttribute('aria-expanded', 'true');
      expect(filesToggle).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByText('No folders selected yet.')).toBeNull();
    });

    it('opens only one mobile accordion at a time', async () => {
      render(renderPicker(makeSession('token-1')));

      const providersToggle = await screen.findByRole('button', { name: 'Select Cloud Providers' });
      const filesToggle = screen.getByRole('button', { name: 'Select Files & Folders' });
      expect(filesToggle).toHaveAttribute('aria-expanded', 'true');

      fireEvent.click(providersToggle);
      expect(providersToggle).toHaveAttribute('aria-expanded', 'true');
      expect(filesToggle).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('button', { name: 'Expand Projects' })).toBeNull();

      fireEvent.click(filesToggle);
      expect(providersToggle).toHaveAttribute('aria-expanded', 'false');
      expect(filesToggle).toHaveAttribute('aria-expanded', 'true');
      expect(await screen.findByRole('button', { name: 'Expand Projects' })).toBeTruthy();
    });
  });
});