import { findStarredTranslationBlock } from './useSubscriptionStaging';
import type { SubscriptionLibrary } from '../services/subscriptionCatalogService';

jest.mock('../services/subscriptionCatalogService', () => ({}));

const PUBLISHER_URL = 'https://publisher.example/library.json';

const libraries: SubscriptionLibrary[] = [
  {
    key: 'builtin',
    name: 'Built-In',
    isBuiltIn: true,
    types: {
      translation: [{ key: 'builtin|translation|KJV', label: 'KJV', itemId: 'KJV' }],
    },
  },
  {
    key: PUBLISHER_URL,
    name: 'Publisher',
    isBuiltIn: false,
    types: {
      translation: [{ key: `${PUBLISHER_URL}|translation|NET`, label: 'NET', itemId: 'NET' }],
    },
  },
];

const records = [
  { id: 'KJV', starred: true },
  { id: 'NET', starred: true },
  { id: 'ASV', starred: false },
];

const empty = { disconnected: [], disabled: [], overrides: {} };

describe('findStarredTranslationBlock', () => {
  it('allows Apply while any starred translation stays enabled', () => {
    expect(findStarredTranslationBlock(libraries, records, { ...empty, disabled: ['builtin|translation|KJV'] })).toBeNull();
  });

  it('blocks when every starred translation is disabled, disconnected, or under a disabled type', () => {
    const blocked = findStarredTranslationBlock(libraries, records, {
      ...empty,
      disconnected: [PUBLISHER_URL],
      disabled: ['builtin|type|translation'],
    });

    expect(blocked).toEqual({ libraryKey: 'builtin', type: 'translation', documentKey: 'builtin|translation|KJV' });
  });

  it('treats a starred translation missing from the catalog as enabled', () => {
    const withUnknown = [...records, { id: 'LOST', starred: true }];
    expect(findStarredTranslationBlock(libraries, withUnknown, {
      ...empty,
      disabled: ['builtin|translation|KJV', `${PUBLISHER_URL}|translation|NET`],
    })).toBeNull();
  });
});
