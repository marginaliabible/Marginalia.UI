import { fireEvent, render, screen } from '@testing-library/react';
import CloudFolderPicker from './CloudFolderPicker';
import type { FederatedSession } from '../services/federatedAuthService';
import { listFolderChildrenForSession } from '../services/cloudConfigProviderService';

jest.mock('../services/cloudConfigProviderService', () => ({
  listFolderChildrenForSession: jest.fn(async () => []),
  computeSupportedFolderSizeForSession: jest.fn(async () => 0),
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
const providerFlags = { google: true, microsoft: false };

function renderPicker(session: FederatedSession) {
  return (
    <CloudFolderPicker
      sessions={{ google: session, microsoft: null }}
      initialSelections={initialSelections}
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
});
