import { helpSearchService } from './helpSearchService';

describe('helpSearchService', () => {
  beforeEach(() => {
    helpSearchService.clear();
    helpSearchService.load({
      schemaVersion: 1,
      documents: [
        {
          id: 'settings',
          title: 'Settings',
          section: 'Basics',
          headings: ['Open Settings'],
          headingSlugs: ['open-settings'],
          body: 'Settings control theme and preferred Bible languages. Click the gear icon.',
        },
        {
          id: 'search',
          title: 'Searching Scripture',
          section: 'Basics',
          headings: ['Run a search', 'Tips'],
          headingSlugs: ['run-a-search', 'tips'],
          body: 'Type a word or phrase in the search box to find verses.',
        },
        {
          id: 'account-sync',
          title: 'Account Sync',
          section: 'Basics',
          headings: ['Usage and plan limits'],
          headingSlugs: ['usage-and-plan-limits'],
          body: 'This is referred to as Committed Processing, and its impact is shown as a blue segment.',
        },
        {
          id: 'resources',
          title: 'Resources panel',
          section: 'Panels',
          headings: ['Resource Tags'],
          headingSlugs: ['resource-tags'],
          body: 'Long-pressing a swatch shows the tag name on mobile.',
        },
      ],
    });
  });

  afterEach(() => {
    helpSearchService.clear();
  });

  it('returns article hits for title and body terms', () => {
    const byTitle = helpSearchService.search('settings');
    expect(byTitle.some((hit) => hit.id === 'settings')).toBe(true);

    const byBody = helpSearchService.search('gear icon');
    expect(byBody.some((hit) => hit.id === 'settings')).toBe(true);
  });

  it('includes a heading slug when the query matches a heading', () => {
    const hits = helpSearchService.search('tips');
    const searchHit = hits.find((hit) => hit.id === 'search');
    expect(searchHit?.headingSlug).toBe('tips');
  });

  it('requires all query terms and avoids fuzzy false positives', () => {
    const hits = helpSearchService.search('committed processing');
    expect(hits.map((hit) => hit.id)).toEqual(['account-sync']);
  });

  it('treats quoted queries as literal consecutive phrases', () => {
    const phraseHits = helpSearchService.search('"committed processing"');
    expect(phraseHits.map((hit) => hit.id)).toEqual(['account-sync']);

    // Same words, wrong order — must not match a quoted phrase.
    expect(helpSearchService.search('"processing committed"')).toEqual([]);

    // Unquoted still matches as an unordered AND of terms.
    expect(helpSearchService.search('processing committed').map((hit) => hit.id)).toEqual([
      'account-sync',
    ]);
  });

  it('returns an empty list for blank queries', () => {
    expect(helpSearchService.search('   ')).toEqual([]);
  });
});
