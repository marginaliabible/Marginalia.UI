import { fireEvent, render, screen } from '@testing-library/react';
import AccountControl from './AccountControl';
import type { SubscriptionsBinding } from '../models/subscription';

function makeBinding(): SubscriptionsBinding {
  return {
    sourceUrls: [],
    libraries: [{
      key: 'builtin',
      name: 'Built-In',
      isBuiltIn: true,
      types: {
        translation: [{ key: 'builtin|translation|KJV', label: 'KJV', itemId: 'KJV' }],
      },
    }],
    isCatalogLoading: false,
    translationRecords: [{ id: 'KJV', starred: true }],
    disabledSourceItems: [],
    resourceTagOverrides: {},
    onRequestCatalog: jest.fn(),
    onAddSourceUrl: jest.fn(async () => ({ ok: true, message: 'ok' })),
    onRequestGitHubAuth: jest.fn(),
    onSubscriptionsApply: jest.fn(async () => ({
      librariesDisconnected: 0,
      itemsEnabled: 0,
      itemsDisabled: 0,
      translationsDropped: 0,
    })),
  };
}

describe('AccountControl (open-source File Sync)', () => {
  it('opens a File Sync modal with Subscriptions and no cloud providers', () => {
    render(<AccountControl subscriptions={makeBinding()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open File Sync' }));

    expect(screen.getByRole('heading', { name: 'File Sync' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Subscriptions' })).toBeTruthy();
    expect(screen.queryByText('Google Drive')).toBeNull();
    expect(screen.queryByText('OneDrive')).toBeNull();
    expect(screen.queryByText('Bring your personal notes into Marginalia')).toBeNull();
  });
});
