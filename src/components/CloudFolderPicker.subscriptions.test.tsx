import { createRef } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import CloudFolderPicker, { type CloudFolderPickerHandle } from './CloudFolderPicker';
import type { SubscriptionsBinding } from '../models/subscription';

jest.mock('../services/cloudConfigProviderService', () => ({
  listFolderChildrenForSession: jest.fn(async () => []),
  computeSupportedFolderSizeForSession: jest.fn(async () => 0),
}));

const PUBLISHER_URL = 'https://publisher.example/library.json';

const sessions = { google: null, microsoft: null };
const initialSelections = { google: [], microsoft: [] };
const providerFlags = { google: false, microsoft: false };

function makeBinding(overrides: Partial<SubscriptionsBinding> = {}): SubscriptionsBinding {
  return {
    sourceUrls: [PUBLISHER_URL],
    libraries: [
      {
        key: 'builtin',
        name: 'Built-In',
        isBuiltIn: true,
        types: {
          translation: [
            { key: 'builtin|translation|ASV', label: 'ASV', itemId: 'ASV' },
            { key: 'builtin|translation|KJV', label: 'KJV', itemId: 'KJV' },
          ],
        },
      },
      {
        key: PUBLISHER_URL,
        name: 'Publisher',
        isBuiltIn: false,
        types: {
          translation: [{ key: `${PUBLISHER_URL}|translation|NET`, label: 'NET', itemId: 'NET' }],
          resource: [{
            key: `${PUBLISHER_URL}|resource|abc:doc-1`,
            label: 'Romans Notes',
            itemId: 'abc:doc-1',
            publisherTags: ['Teaching'],
          }],
        },
      },
    ],
    isCatalogLoading: false,
    translationRecords: [
      { id: 'KJV', starred: true },
      { id: 'NET', starred: true },
      { id: 'ASV', starred: false },
    ],
    disabledSourceItems: [],
    resourceTagOverrides: {},
    onRequestCatalog: jest.fn(),
    onAddSourceUrl: jest.fn(async () => ({ ok: true, message: 'ok', url: PUBLISHER_URL })),
    onRequestGitHubAuth: jest.fn(),
    onSubscriptionsApply: jest.fn(async () => undefined),
    ...overrides,
  };
}

function renderPicker(binding: SubscriptionsBinding) {
  const ref = createRef<CloudFolderPickerHandle>();
  const onSelectionsChange = jest.fn();
  const onDirtyChange = jest.fn();
  render(
    <CloudFolderPicker
      sessions={sessions}
      initialSelections={initialSelections}
      providerSyncFilesEnabled={providerFlags}
      linkedProviders={providerFlags}
      focusRequest={null}
      onSelectionsChange={onSelectionsChange}
      onConnectRequested={jest.fn()}
      onDirtyChange={onDirtyChange}
      subscriptions={binding}
      ref={ref}
    />
  );
  return { ref, onSelectionsChange, onDirtyChange };
}

function openSubscriptions() {
  fireEvent.click(screen.getByRole('button', { name: 'Subscriptions' }));
  return within(screen.getByRole('list', { name: 'Subscription libraries' }));
}

describe('CloudFolderPicker subscriptions', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it('requests the catalog and lists only library names under the left Subscriptions node', async () => {
    const binding = makeBinding();
    renderPicker(binding);
    expect(binding.onRequestCatalog).toHaveBeenCalledTimes(1);

    const left = within(screen.getByRole('list', { name: 'Subscriptions' }));
    expect(left.getByRole('button', { name: 'Connect a subscription' })).toBeTruthy();
    fireEvent.click(left.getByRole('button', { name: 'Expand Subscriptions' }));

    expect(left.getByRole('button', { name: 'Built-In' })).toBeTruthy();
    expect(left.getByRole('button', { name: 'Publisher' })).toBeTruthy();
    expect(left.queryByText('KJV')).toBeNull();
    expect(left.queryByText('Translations')).toBeNull();
  });

  it('disables disconnect for Built-In but not for connected libraries', () => {
    renderPicker(makeBinding());
    const panel = openSubscriptions();

    expect((panel.getByRole('button', { name: 'Stop syncing Built-In' }) as HTMLButtonElement).disabled).toBe(true);
    expect((panel.getByRole('button', { name: 'Stop syncing Publisher' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows a single-type library\'s documents directly and splits multi-type libraries by type', () => {
    renderPicker(makeBinding());
    const panel = openSubscriptions();

    fireEvent.click(panel.getByText('Built-In'));
    expect(panel.getByText('KJV')).toBeTruthy();
    expect(panel.queryByText('Translations')).toBeNull();

    fireEvent.click(panel.getByText('Publisher'));
    expect(panel.getByText('Translations')).toBeTruthy();
    expect(panel.getByText('Resources')).toBeTruthy();
    expect(panel.queryByText('Romans Notes')).toBeNull();

    fireEvent.click(panel.getByText('Resources'));
    expect(panel.getByText('Romans Notes')).toBeTruthy();
    expect(panel.getByText('Teaching')).toBeTruthy();
  });

  it('hides lower-level toggles once the library is staged for disconnect', () => {
    renderPicker(makeBinding());
    const panel = openSubscriptions();
    fireEvent.click(panel.getByText('Publisher'));

    const typeToggle = panel.getByRole('button', { name: 'Exclude Translations in Publisher from sync', hidden: true }) as HTMLButtonElement;
    expect(typeToggle.disabled).toBe(false);

    fireEvent.click(panel.getByRole('button', { name: 'Stop syncing Publisher' }));
    expect(typeToggle.disabled).toBe(true);
    expect(typeToggle.style.visibility).toBe('hidden');
  });

  it('blocks Apply when no starred translation stays enabled, then applies subscription-only changes', async () => {
    const binding = makeBinding();
    const { ref, onSelectionsChange, onDirtyChange } = renderPicker(binding);
    const panel = openSubscriptions();

    fireEvent.click(panel.getByText('Built-In'));
    fireEvent.click(panel.getByRole('button', { name: 'Exclude KJV from sync' }));
    fireEvent.click(panel.getByRole('button', { name: 'Stop syncing Publisher' }));
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    await act(async () => {
      ref.current?.apply();
    });
    expect(alertSpy).toHaveBeenCalledWith('At least one of your starred translations must stay enabled.');
    expect(binding.onSubscriptionsApply).not.toHaveBeenCalled();

    fireEvent.click(panel.getByRole('button', { name: 'Resume syncing Publisher' }));
    await act(async () => {
      ref.current?.apply();
    });

    expect(binding.onSubscriptionsApply).toHaveBeenCalledWith({
      disconnectLibraryKeys: [],
      disabledSourceItems: ['builtin|translation|KJV'],
      resourceTagOverrides: {},
    });
    expect(onSelectionsChange).not.toHaveBeenCalled();
  });

  it('connects a new library immediately from the Connect modal', async () => {
    const binding = makeBinding();
    renderPicker(binding);

    fireEvent.click(screen.getByRole('button', { name: 'Connect a subscription' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByLabelText('Library URL'), { target: { value: 'not a url' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Connect' }));
    expect(dialog.getByText('Library URL must start with http:// or https://')).toBeTruthy();
    expect(binding.onAddSourceUrl).not.toHaveBeenCalled();

    fireEvent.change(dialog.getByLabelText('Library URL'), { target: { value: 'https://new.example/library.json' } });
    await act(async () => {
      fireEvent.click(dialog.getByRole('button', { name: 'Connect' }));
    });

    expect(binding.onAddSourceUrl).toHaveBeenCalledWith('https://new.example/library.json');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('list', { name: 'Subscription libraries' })).toBeTruthy();
  });

  it('Cancel discards staged subscription changes', async () => {
    const binding = makeBinding();
    const { ref, onDirtyChange } = renderPicker(binding);
    const panel = openSubscriptions();

    fireEvent.click(panel.getByText('Built-In'));
    fireEvent.click(panel.getByRole('button', { name: 'Exclude ASV from sync' }));
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    await act(async () => {
      ref.current?.cancel();
    });

    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(panel.getByRole('button', { name: 'Exclude ASV from sync' })).toBeTruthy();
  });
});
