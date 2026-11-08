import {
  parseHelpManifest,
  parseHelpSearchIndex,
  parseHelpTourDefinition,
} from './helpContentParsers';

describe('helpContentParsers', () => {
  it('parses a valid manifest', () => {
    const manifest = parseHelpManifest({
      schemaVersion: 1,
      articles: [
        { id: 'settings', title: 'Settings', section: 'Basics', path: 'articles/settings.md' },
        { id: 'bad', title: '', path: 'articles/bad.md' },
      ],
      tours: [
        { id: 'open-settings', path: 'tours/open-settings.json' },
        { id: 'missing-path' },
      ],
    });

    expect(manifest.articles).toEqual([
      { id: 'settings', title: 'Settings', section: 'Basics', path: 'articles/settings.md' },
    ]);
    expect(manifest.tours).toEqual([
      { id: 'open-settings', path: 'tours/open-settings.json' },
    ]);
  });

  it('rejects an invalid manifest', () => {
    expect(() => parseHelpManifest({ articles: [] })).toThrow(/invalid/i);
  });

  it('parses a search index', () => {
    const index = parseHelpSearchIndex({
      schemaVersion: 1,
      documents: [
        {
          id: 'settings',
          title: 'Settings',
          section: 'Basics',
          headings: ['Open Settings'],
          headingSlugs: ['open-settings'],
          body: 'Click the gear icon',
        },
      ],
    });

    expect(index.documents).toHaveLength(1);
    expect(index.documents[0].id).toBe('settings');
    expect(index.documents[0].headings).toEqual(['Open Settings']);
  });

  it('parses a tour definition with before actions', () => {
    const tour = parseHelpTourDefinition({
      id: 'open-settings',
      steps: [
        {
          target: 'settings-button',
          title: 'Settings',
          content: 'Click the gear',
          placement: 'left',
          before: { action: 'openSettings' },
        },
        {
          target: 'search-input',
          content: 'Search here',
          before: { action: 'selectPanelTab', tabType: 'help' },
        },
        {
          target: 'translations-panel',
          content: 'Open translations',
          before: { action: 'ensureTranslationsTab' },
          advanceVisible: 'translations-selected',
        },
        {
          target: 'search-input',
          content: 'Jump to a verse',
          advanceEvent: 'search-quick-jump',
        },
        {
          target: 'translations-drag-handle',
          spotlightTarget: 'translations-selected',
          content: 'Drag handle with wider spotlight',
        },
      ],
    });

    expect(tour.id).toBe('open-settings');
    expect(tour.steps).toHaveLength(5);
    expect(tour.steps[0].before).toEqual({ action: 'openSettings' });
    expect(tour.steps[1].before).toEqual({ action: 'selectPanelTab', tabType: 'help' });
    expect(tour.steps[2].before).toEqual({ action: 'ensureTranslationsTab' });
    expect(tour.steps[2].advanceVisible).toBe('translations-selected');
    expect(tour.steps[3].advanceEvent).toBe('search-quick-jump');
    expect(tour.steps[4].spotlightTarget).toBe('translations-selected');
  });

  it('rejects tours with no valid steps', () => {
    expect(() => parseHelpTourDefinition({ id: 'empty', steps: [{}] })).toThrow(/no valid steps/i);
  });
});
