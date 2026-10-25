import { fireEvent, render, waitFor, within } from '@testing-library/react';
import CloudFolderPicker, { type FolderSelectionTarget } from './CloudFolderPicker';
import type { FederatedSession } from '../services/federatedAuthService';

jest.mock('../services/cloudConfigProviderService', () => ({
  listFolderChildrenForSession: jest.fn(async (_session: unknown, parentId: string) => (
    parentId === 'g-folder'
      ? [
        { id: 'g-rich', name: 'Rich.pdf', kind: 'file', sizeBytes: 100, hasChildren: false },
        { id: 'g-pending', name: 'Pending.pdf', kind: 'file', sizeBytes: 100, hasChildren: false },
      ]
      : []
  )),
  computeSupportedFolderSizeForSession: jest.fn(async () => 0),
  listSupportedFolderContentsForSession: jest.fn(async () => ({ totalBytes: 0, files: [] })),
}));

jest.mock('../services/cloudControlService', () => ({
  requestDocumentReprocess: jest.fn(async () => undefined),
  fetchDeveloperCapabilities: jest.fn(async () => ({ ok: true, isDeveloper: true })),
}));

jest.mock('../services/developerToolsService', () => ({
  isDeveloperToolsEnabled: () => true,
  ensureDeveloperCapabilities: jest.fn(async () => true),
  subscribeDeveloperTools: () => () => undefined,
}));

const googleSession = { provider: 'google', accessToken: 'token' } as unknown as FederatedSession;
const selections: Record<'google' | 'microsoft', FolderSelectionTarget[]> = {
  google: [{ id: 'g-folder', kind: 'folder', name: 'Notes', path: 'Google Drive/Notes' }],
  microsoft: [],
};

describe('CloudFolderPicker developer reprocess', () => {
  it('shows a bomb next to each document, disabled until the file is processed', async () => {
    render(
      <CloudFolderPicker
        sessions={{ google: googleSession, microsoft: null }}
        initialSelections={selections}
        providerSyncFilesEnabled={{ google: true, microsoft: false }}
        linkedProviders={{ google: true, microsoft: false }}
        focusRequest={null}
        onSelectionsChange={jest.fn()}
        onConnectRequested={jest.fn()}
        processedDocumentIds={{ google: new Set(['g-rich']) }}
        userId="dev@example.com"
      />
    );

    const rightPanel = within(document.querySelector('.cloud-folder-picker-right') as HTMLElement);
    fireEvent.click(await rightPanel.findByLabelText('Expand Notes'));
    await waitFor(() => {
      expect(rightPanel.getByText('Rich.pdf')).toBeInTheDocument();
    });

    const processed = rightPanel.getByRole('button', { name: 'Blow away and reprocess Rich.pdf' });
    expect(processed).toBeEnabled();
    expect(processed.querySelector('i')).toHaveClass('fa-bomb');

    const pending = rightPanel.getByRole('button', { name: 'Blow away and reprocess Pending.pdf' });
    expect(pending).toBeDisabled();
    expect(pending.querySelector('i')).toHaveClass('fa-bomb');
  });
});
