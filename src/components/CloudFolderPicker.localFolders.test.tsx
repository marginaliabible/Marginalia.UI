import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CloudFolderPicker, { type CloudFolderSyncApi } from './CloudFolderPicker';
import type { LocalFoldersBinding } from '../models/localFolders';

const cloudSync: CloudFolderSyncApi = {
  listFolderChildrenForSession: jest.fn(async () => []),
  listSupportedFolderContentsForSession: jest.fn(async () => ({ totalBytes: 0, files: [] })),
};

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

const emptyGetFolderSize = jest.fn(async () => ({ sizeBytes: 0, children: [] }));

describe('CloudFolderPicker Local Folders right pane', () => {
  beforeEach(() => {
    mockMatchMedia(true);
    jest.clearAllMocks();
    emptyGetFolderSize.mockImplementation(async () => ({ sizeBytes: 0, children: [] }));
  });

  it('shows a Local root in the selected list and expands children via listChildren', async () => {
    const onTargetsChange = jest.fn();
    const listChildren = jest.fn(async (_machineId: string, path: string) => {
      if (path === 'C:/Docs') {
        return [
          { path: 'C:/Docs/Notes', name: 'Notes', kind: 'folder' as const },
          { path: 'C:/Docs/readme.md', name: 'readme.md', kind: 'file' as const, sizeBytes: 128 },
        ];
      }
      return [];
    });
    const getFolderSize = jest.fn(async () => ({
      sizeBytes: 128,
      children: [{ path: 'C:/Docs/Notes', sizeBytes: 0 }],
    }));

    const localFolders: LocalFoldersBinding = {
      machines: [{
        machineId: 'm1',
        name: 'Desk',
        online: true,
        expanded: true,
        entriesByPath: {
          '': [{ path: 'C:/Docs', name: 'Docs', kind: 'folder' }],
        },
        expandedPaths: [],
        loadingPaths: [],
        selectedTargets: [{
          id: 'C:/Docs',
          kind: 'folder',
          path: 'C:/Docs',
          name: 'Docs',
          machineId: 'm1',
          tags: ['Study'],
        }],
      }],
      onConnect: jest.fn(),
      onExpandMachine: jest.fn(),
      onExpandPath: jest.fn(),
      onTogglePath: jest.fn(),
      onTargetsChange,
      listChildren,
      getFolderSize,
      onEditMachine: jest.fn(),
    };

    render(
      <CloudFolderPicker
        sessions={{ google: null, microsoft: null }}
        initialSelections={{ google: [], microsoft: [] }}
        providerSyncFilesEnabled={{ google: false, microsoft: false }}
        linkedProviders={{ google: false, microsoft: false }}
        focusRequest={null}
        onSelectionsChange={jest.fn()}
        onConnectRequested={jest.fn()}
        cloudSync={cloudSync}
        localFolders={localFolders}
      />
    );

    // Right-pane paths insert zero-width spaces after `/` for wrapping; match via aria-label.
    expect(await screen.findByLabelText('Stop syncing C:/Docs')).toBeInTheDocument();
    expect(screen.getByTitle('Study')).toBeInTheDocument();

    // Prefer the selected-list expand control (right pane), not the left-tree Docs chevron.
    const selectedExpand = screen.getAllByLabelText('Expand Docs').find((button) => (
      button.closest('.cloud-folder-selected-list') != null
    ));
    expect(selectedExpand).toBeTruthy();
    fireEvent.click(selectedExpand!);

    await waitFor(() => {
      expect(listChildren).toHaveBeenCalledWith('m1', 'C:/Docs');
    });
    expect(await screen.findByText('Notes')).toBeInTheDocument();
    expect(screen.getByText('readme.md')).toBeInTheDocument();
    expect(getFolderSize).toHaveBeenCalledWith('m1', 'C:/Docs', expect.any(Object));
  });

  it('keeps Local selections in the right pane when the machines list briefly goes empty', async () => {
    const onTargetsChange = jest.fn();
    const listChildren = jest.fn(async () => []);
    const machine = {
      machineId: 'm1',
      name: 'Desk',
      online: true,
      expanded: false,
      entriesByPath: {},
      expandedPaths: [],
      loadingPaths: [],
      selectedTargets: [{
        id: 'C:/Docs',
        kind: 'folder' as const,
        path: 'C:/Docs',
        name: 'Docs',
        machineId: 'm1',
        tags: ['Study'],
      }],
    };

    const localFolders: LocalFoldersBinding = {
      machines: [machine],
      onConnect: jest.fn(),
      onExpandMachine: jest.fn(),
      onExpandPath: jest.fn(),
      onTogglePath: jest.fn(),
      onTargetsChange,
      listChildren,
      getFolderSize: emptyGetFolderSize,
      onEditMachine: jest.fn(),
    };

    const { rerender } = render(
      <CloudFolderPicker
        sessions={{ google: null, microsoft: null }}
        initialSelections={{ google: [], microsoft: [] }}
        providerSyncFilesEnabled={{ google: false, microsoft: false }}
        linkedProviders={{ google: false, microsoft: false }}
        focusRequest={null}
        onSelectionsChange={jest.fn()}
        onConnectRequested={jest.fn()}
        cloudSync={cloudSync}
        localFolders={localFolders}
      />
    );

    expect(await screen.findByLabelText('Stop syncing C:/Docs')).toBeInTheDocument();

    rerender(
      <CloudFolderPicker
        sessions={{ google: null, microsoft: null }}
        initialSelections={{ google: [], microsoft: [] }}
        providerSyncFilesEnabled={{ google: false, microsoft: false }}
        linkedProviders={{ google: false, microsoft: false }}
        focusRequest={null}
        onSelectionsChange={jest.fn()}
        onConnectRequested={jest.fn()}
        cloudSync={cloudSync}
        localFolders={{ ...localFolders, machines: [] }}
      />
    );

    expect(screen.getByLabelText('Stop syncing C:/Docs')).toBeInTheDocument();
    expect(onTargetsChange).not.toHaveBeenCalledWith('m1', []);
  });

  it('keeps Local selections in the right pane when cloud sessions bootstrap again', async () => {
    const localFolders: LocalFoldersBinding = {
      machines: [{
        machineId: 'm1',
        name: 'Desk',
        online: true,
        expanded: false,
        entriesByPath: {},
        expandedPaths: [],
        loadingPaths: [],
        selectedTargets: [{
          id: 'C:/Docs',
          kind: 'folder',
          path: 'C:/Docs',
          name: 'Docs',
          machineId: 'm1',
          tags: ['Study'],
        }],
      }],
      onConnect: jest.fn(),
      onExpandMachine: jest.fn(),
      onExpandPath: jest.fn(),
      onTogglePath: jest.fn(),
      onTargetsChange: jest.fn(),
      listChildren: jest.fn(async () => []),
      getFolderSize: emptyGetFolderSize,
      onEditMachine: jest.fn(),
    };

    const { rerender } = render(
      <CloudFolderPicker
        sessions={{ google: null, microsoft: null }}
        initialSelections={{ google: [], microsoft: [] }}
        providerSyncFilesEnabled={{ google: false, microsoft: false }}
        linkedProviders={{ google: false, microsoft: false }}
        focusRequest={null}
        onSelectionsChange={jest.fn()}
        onConnectRequested={jest.fn()}
        cloudSync={cloudSync}
        localFolders={localFolders}
      />
    );

    expect(await screen.findByLabelText('Stop syncing C:/Docs')).toBeInTheDocument();

    // Session object identity changes whenever Sanctum refreshes federated auth — that re-runs
    // cloud bootstrap, which used to replace `selected`/`nodes` and drop Local rows.
    rerender(
      <CloudFolderPicker
        sessions={{ google: null, microsoft: { provider: 'microsoft', accessToken: 't' } as never }}
        initialSelections={{ google: [], microsoft: [] }}
        providerSyncFilesEnabled={{ google: false, microsoft: false }}
        linkedProviders={{ google: false, microsoft: true }}
        focusRequest={null}
        onSelectionsChange={jest.fn()}
        onConnectRequested={jest.fn()}
        cloudSync={cloudSync}
        localFolders={localFolders}
      />
    );

    expect(await screen.findByLabelText('Stop syncing C:/Docs')).toBeInTheDocument();
    expect(screen.getByTitle('Study')).toBeInTheDocument();
  });

  it('includes Local Folders selection bytes and machine name in the usage snapshot', async () => {
    const onUsageSnapshotChange = jest.fn();
    const listChildren = jest.fn(async () => []);
    const getFolderSize = jest.fn(async (machineId: string, path: string) => {
      expect(machineId).toBe('m1');
      expect(path).toBe('C:/Docs');
      return {
        sizeBytes: 1500,
        children: [{ path: 'C:/Docs/Notes', sizeBytes: 500 }],
      };
    });

    const localFolders: LocalFoldersBinding = {
      machines: [{
        machineId: 'm1',
        name: 'Desk',
        online: true,
        expanded: false,
        entriesByPath: {},
        expandedPaths: [],
        loadingPaths: [],
        selectedTargets: [{
          id: 'C:/Docs',
          kind: 'folder',
          path: 'C:/Docs',
          name: 'Docs',
          machineId: 'm1',
        }],
      }],
      onConnect: jest.fn(),
      onExpandMachine: jest.fn(),
      onExpandPath: jest.fn(),
      onTogglePath: jest.fn(),
      onTargetsChange: jest.fn(),
      listChildren,
      getFolderSize,
      onEditMachine: jest.fn(),
    };

    render(
      <CloudFolderPicker
        sessions={{ google: null, microsoft: null }}
        initialSelections={{ google: [], microsoft: [] }}
        providerSyncFilesEnabled={{ google: false, microsoft: false }}
        linkedProviders={{ google: false, microsoft: false }}
        focusRequest={null}
        onSelectionsChange={jest.fn()}
        onConnectRequested={jest.fn()}
        onUsageSnapshotChange={onUsageSnapshotChange}
        cloudSync={cloudSync}
        localFolders={localFolders}
      />
    );

    await waitFor(() => {
      const snapshots = onUsageSnapshotChange.mock.calls.map((call) => call[0]);
      expect(snapshots.some((snapshot) => (
        snapshot.sourceLabelsWithSelection.includes('Desk')
        && snapshot.selectedBytes === 1500
        && snapshot.sizesReady
      ))).toBe(true);
    });
    expect(getFolderSize).toHaveBeenCalledTimes(1);
    expect(listChildren).not.toHaveBeenCalled();
  });

  it('hides Local Folders Connect when showConnect is false', async () => {
    const localFolders: LocalFoldersBinding = {
      machines: [{
        machineId: 'm1',
        name: 'Desk',
        online: true,
        expanded: false,
        entriesByPath: {},
        expandedPaths: [],
        loadingPaths: [],
        selectedTargets: [],
      }],
      onConnect: jest.fn(),
      showConnect: false,
      onExpandMachine: jest.fn(),
      onExpandPath: jest.fn(),
      onTogglePath: jest.fn(),
      onTargetsChange: jest.fn(),
      listChildren: jest.fn(async () => []),
      getFolderSize: emptyGetFolderSize,
      onEditMachine: jest.fn(),
    };

    render(
      <CloudFolderPicker
        sessions={{ google: null, microsoft: null }}
        initialSelections={{ google: [], microsoft: [] }}
        providerSyncFilesEnabled={{ google: false, microsoft: false }}
        linkedProviders={{ google: false, microsoft: false }}
        focusRequest={null}
        onSelectionsChange={jest.fn()}
        onConnectRequested={jest.fn()}
        cloudSync={cloudSync}
        localFolders={localFolders}
      />
    );

    expect(await screen.findByRole('button', { name: 'Local Folders' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect a local folder' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Desk' })).toBeInTheDocument();
  });
});
