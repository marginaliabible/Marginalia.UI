import { findTourStepForTarget, parseHelpTargetRef } from './tourTargetLinks';
import { helpContentService } from '../services/helpContentService';

jest.mock('../services/helpContentService', () => ({
  helpContentService: {
    getManifest: jest.fn(),
    getTour: jest.fn(),
  },
}));

describe('tourTargetLinks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('parses bare and tour-scoped target refs', () => {
    expect(parseHelpTargetRef('translations-selected')).toEqual({
      targetId: 'translations-selected',
    });
    expect(parseHelpTargetRef('translations-panel.translations-selected')).toEqual({
      tourId: 'translations-panel',
      targetId: 'translations-selected',
    });
  });

  it('finds the first matching step across tours', async () => {
    (helpContentService.getManifest as jest.Mock).mockResolvedValue({
      tours: [
        { id: 'open-settings', path: 'tours/open-settings.json' },
        { id: 'translations-panel', path: 'tours/translations-panel.json' },
      ],
    });
    (helpContentService.getTour as jest.Mock).mockImplementation(async (tourId: string) => {
      if (tourId === 'open-settings') {
        return {
          id: 'open-settings',
          steps: [{ target: 'settings-theme', content: 'Theme' }],
        };
      }
      return {
        id: 'translations-panel',
        steps: [
          { target: 'translations-panel', content: 'Tab' },
          { target: 'translations-selected', content: 'Cards' },
        ],
      };
    });

    await expect(findTourStepForTarget('translations-selected')).resolves.toEqual({
      tourId: 'translations-panel',
      stepIndex: 1,
    });
  });

  it('respects an explicit tour id prefix', async () => {
    (helpContentService.getManifest as jest.Mock).mockResolvedValue({
      tours: [
        { id: 'translations-panel', path: 'tours/translations-panel.json' },
      ],
    });
    (helpContentService.getTour as jest.Mock).mockResolvedValue({
      id: 'translations-panel',
      steps: [
        { target: 'translations-panel', content: 'Tab' },
        { target: 'translations-selected', content: 'Cards' },
        {
          target: 'translations-drag-handle',
          spotlightTarget: 'translations-selected',
          content: 'Drag',
        },
      ],
    });

    await expect(
      findTourStepForTarget('translations-panel.translations-selected')
    ).resolves.toEqual({
      tourId: 'translations-panel',
      stepIndex: 1,
    });
  });
});
