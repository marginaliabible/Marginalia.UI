import { HELP_TOUR_TARGETS, resolveHelpTourTarget } from './tourTargets';

describe('tourTargets', () => {
  it('maps logical ids to data-help selectors', () => {
    expect(resolveHelpTourTarget('settings-button')).toBe(HELP_TOUR_TARGETS['settings-button']);
    expect(resolveHelpTourTarget('search-input')).toBe('[data-help="search-input"]');
  });

  it('passes through unknown selectors', () => {
    expect(resolveHelpTourTarget('#custom-target')).toBe('#custom-target');
  });
});
