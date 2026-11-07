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

  it('returns an empty list for blank queries', () => {
    expect(helpSearchService.search('   ')).toEqual([]);
  });
});
