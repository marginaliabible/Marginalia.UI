import { createRef } from 'react';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import CloudFolderPicker, {
  type CloudFolderPickerHandle,
  type CloudFolderSyncApi,
  type FolderSelectionTarget,
} from './CloudFolderPicker';
import type { FederatedSession } from '../models/bible';
import { __resetToastsForTests, getToasts } from '../services/toastService';

const cloudSync: CloudFolderSyncApi = {
  listFolderChildrenForSession: jest.fn(async (_session, parentId) => (
    parentId === 'g-folder'
      ? [
        { id: 'g-thin', name: 'Thin.pdf', kind: 'file' as const, sizeBytes: 100, hasChildren: false },
        { id: 'g-rich', name: 'Rich.pdf', kind: 'file' as const, sizeBytes: 100, hasChildren: false },
        { id: 'g-protected', name: 'Protected.pdf', kind: 'file' as const, sizeBytes: 100, hasChildren: false },
      ]
      : []
  )),
  listSupportedFolderContentsForSession: jest.fn(async () => ({ totalBytes: 0, files: [] })),
};

const googleSession = { provider: 'google', accessToken: 'token' } as unknown as FederatedSession;
const selections: Record<'google' | 'microsoft', FolderSelectionTarget[]> = {
  google: [{ id: 'g-folder', kind: 'folder', name: 'Notes', path: 'Google Drive/Notes' }],
  microsoft: [],
};

const TOOLTIP = 'This file contains less than an average of one verse per page, and has been removed from your library.';

describe('CloudFolderPicker rejected files', () => {
  beforeEach(() => {
    __resetToastsForTests();
  });

  afterEach(() => {
    __resetToastsForTests();
  });

  it('shows a rejected file with a grey, disabled-looking upload icon that explains itself in a toast', async () => {
    render(
      <CloudFolderPicker
        sessions={{ google: googleSession, microsoft: null }}
        initialSelections={selections}
        providerSyncFilesEnabled={{ google: true, microsoft: false }}
        linkedProviders={{ google: true, microsoft: false }}
        focusRequest={null}
        onSelectionsChange={jest.fn()}
        onConnectRequested={jest.fn()}
        cloudSync={cloudSync}
        rejectedDocumentIds={{ google: new Set(['g-thin']) }}
      />
    );

    const rightPanel = within(document.querySelector('.cloud-folder-picker-right') as HTMLElement);
    fireEvent.click(await rightPanel.findByLabelText('Expand Notes'));
    await waitFor(() => {
      expect(rightPanel.getByText('Thin.pdf')).toBeInTheDocument();
    });

    const rejectedButton = rightPanel.getByRole('button', {
      name: `'Thin.pdf' contains less than an average of one verse per page, and has been removed from your library.`,
    });
    expect(rejectedButton).toHaveAttribute('title', TOOLTIP);
    expect(rejectedButton).toHaveAttribute('aria-disabled', 'true');
    expect(rejectedButton).toHaveClass('cloud-folder-selected-rejected');
    expect(rejectedButton.querySelector('i')).toHaveClass('fa-upload');
    expect(rightPanel.queryByLabelText(/Exclude .*Thin\.pdf from sync/)).toBeNull();
    expect(rightPanel.getByLabelText(/Exclude .*Rich\.pdf from sync/)).toBeInTheDocument();

    fireEvent.click(rejectedButton);

    expect(getToasts().map((toast) => toast.message)).toEqual([
      `'Thin.pdf' contains less than an average of one verse per page, and has been removed from your library.`,
    ]);
  });

  it('shows an unpublished conversion failure with the same greyed upload icon and a friendly toast', async () => {
    const rawError = 'pdf2htmlEX failed with exit code 1: Error: Copying of text from this document is not allowed.';
    const friendly = "'Protected.pdf' is copy protected and couldn't be added to your library.";

    render(
      <CloudFolderPicker
        sessions={{ google: googleSession, microsoft: null }}
        initialSelections={selections}
        providerSyncFilesEnabled={{ google: true, microsoft: false }}
        linkedProviders={{ google: true, microsoft: false }}
        focusRequest={null}
        onSelectionsChange={jest.fn()}
        onConnectRequested={jest.fn()}
        cloudSync={cloudSync}
        failedDocuments={{ google: new Map([['g-protected', rawError]]) }}
      />
    );

    const rightPanel = within(document.querySelector('.cloud-folder-picker-right') as HTMLElement);
    fireEvent.click(await rightPanel.findByLabelText('Expand Notes'));
    await waitFor(() => {
      expect(rightPanel.getByText('Protected.pdf')).toBeInTheDocument();
    });

    const failedButton = rightPanel.getByRole('button', { name: friendly });
    expect(failedButton).toHaveAttribute('title', "This file is copy protected and couldn't be added to your library.");
    expect(failedButton).toHaveAttribute('aria-disabled', 'true');
    expect(failedButton).toHaveClass('cloud-folder-selected-rejected');
    expect(failedButton.querySelector('i')).toHaveClass('fa-upload');
    expect(rightPanel.queryByLabelText(/Exclude .*Protected\.pdf from sync/)).toBeNull();
    expect(rightPanel.getByLabelText(/Exclude .*Rich\.pdf from sync/)).toBeInTheDocument();

    fireEvent.click(failedButton);

    expect(getToasts().map((toast) => toast.message)).toEqual([friendly]);
  });

  it('shows a page-limit skip as an unselected upload icon the user can click to opt in', async () => {
    const onSelectionsChange = jest.fn().mockResolvedValue({ applied: true });
    const pickerRef = createRef<CloudFolderPickerHandle>();
    render(
      <CloudFolderPicker
        ref={pickerRef}
        sessions={{ google: googleSession, microsoft: null }}
        initialSelections={{
          google: [{ ...selections.google[0], tags: ['Notes'] }],
          microsoft: [],
        }}
        providerSyncFilesEnabled={{ google: true, microsoft: false }}
        linkedProviders={{ google: true, microsoft: false }}
        focusRequest={null}
        onSelectionsChange={onSelectionsChange}
        onConnectRequested={jest.fn()}
        cloudSync={cloudSync}
        skippedDocumentIds={{ google: new Set(['g-thin']) }}
      />
    );

    const rightPanel = within(document.querySelector('.cloud-folder-picker-right') as HTMLElement);
    fireEvent.click(await rightPanel.findByLabelText('Expand Notes'));
    await waitFor(() => {
      expect(rightPanel.getByText('Thin.pdf')).toBeInTheDocument();
    });

    const skipButton = rightPanel.getByRole('button', { name: /Resume syncing / });
    expect(skipButton).toHaveClass('cloud-folder-selected-restore');
    expect(skipButton.querySelector('i')).toHaveClass('fa-upload');
    expect(skipButton).not.toHaveAttribute('aria-disabled');
    expect(rightPanel.queryByLabelText(/Thin\.pdf contains less than an average/)).toBeNull();

    fireEvent.click(skipButton);
    await act(async () => {
      pickerRef.current?.apply();
    });

    await waitFor(() => {
      expect(onSelectionsChange).toHaveBeenCalled();
    });
    const payload = onSelectionsChange.mock.calls[0][0] as Record<string, FolderSelectionTarget[]>;
    expect(payload['google'][0].includedItemIds).toEqual(['g-thin']);
    expect(payload['google'][0].excludedItemIds).toBeUndefined();
  });
});
