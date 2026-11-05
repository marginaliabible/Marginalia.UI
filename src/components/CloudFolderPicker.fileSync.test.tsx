import { fireEvent, render, screen } from '@testing-library/react';
import CloudFolderPicker, { type CloudFolderSyncApi, type FolderSelectionTarget } from './CloudFolderPicker';
import type { FederatedSession } from '../models/bible';

const CHILDREN_BY_FOLDER_ID: Record<string, Awaited<ReturnType<CloudFolderSyncApi['listFolderChildrenForSession']>>> = {
  projects: [
    { id: 'sub', name: 'Sub', kind: 'folder', sizeBytes: 0, hasChildren: true },
    { id: 'notes', name: 'Notes.md', kind: 'file', sizeBytes: 10, hasChildren: false },
  ],
  sub: [
    { id: 'deep', name: 'Deep.md', kind: 'file', sizeBytes: 10, hasChildren: false },
  ],
};

const listFolderChildrenForSession: CloudFolderSyncApi['listFolderChildrenForSession'] = jest.fn(
  async (_session, parentId) => CHILDREN_BY_FOLDER_ID[parentId] ?? []
);

const cloudSync: CloudFolderSyncApi = {
  listFolderChildrenForSession,
  listSupportedFolderContentsForSession: jest.fn(async () => ({ totalBytes: 0, files: [] })),
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
      cloudSync={cloudSync}
    />
  );
}

describe('CloudFolderPicker file sync panel', () => {
  beforeEach(() => {
    mockMatchMedia(true);
    (listFolderChildrenForSession as jest.Mock).mockImplementation(
      async (_session, parentId) => CHILDREN_BY_FOLDER_ID[parentId] ?? []
    );
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

    it('starts on the files pane when folders are already selected', async () => {
      render(renderPicker(makeSession('token-1')));

      expect(await screen.findByRole('button', { name: 'Select Files & Folders' })).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('button', { name: 'Select Cloud Providers' })).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByRole('button', { name: 'Expand Projects' })).toBeTruthy();
    });

    it('starts on the providers pane when nothing is selected', async () => {
      render(renderPicker(makeSession('token-1'), emptySelections));

      expect(await screen.findByRole('button', { name: 'Select Cloud Providers' })).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('button', { name: 'Select Files & Folders' })).toHaveAttribute('aria-expanded', 'false');
    });

    it('opens only one pane at a time', async () => {
      render(renderPicker(makeSession('token-1')));

      fireEvent.click(await screen.findByRole('button', { name: 'Select Cloud Providers' }));
      expect(screen.getByRole('button', { name: 'Select Cloud Providers' })).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('button', { name: 'Select Files & Folders' })).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(screen.getByRole('button', { name: 'Select Files & Folders' }));
      expect(screen.getByRole('button', { name: 'Select Files & Folders' })).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('button', { name: 'Select Cloud Providers' })).toHaveAttribute('aria-expanded', 'false');
    });
  });
});
