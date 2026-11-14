import { isPanelOwnedTourTarget, tourTargetWindowRole } from './tourTargetWindows';

jest.mock('../services/windowChannel', () => {
  const self = { type: 'bible' as 'bible' | 'panel' | 'document' };
  return {
    PANEL_WINDOW_NAME: 'marginalia-panel',
    windowChannel: {
      getSelf: () => self,
      __setSelfType: (type: 'bible' | 'panel' | 'document') => {
        self.type = type;
      },
    },
  };
});

jest.mock('../services/windowRouting', () => {
  let panelOpen = false;
  return {
    mostRecentWindowOfType: (type: string) => (type === 'panel' && panelOpen ? { id: 'panel-1', type: 'panel' } : null),
    __setPanelOpen: (open: boolean) => {
      panelOpen = open;
    },
  };
});

const channelMock = jest.requireMock('../services/windowChannel') as {
  windowChannel: { __setSelfType: (type: 'bible' | 'panel' | 'document') => void };
};
const routingMock = jest.requireMock('../services/windowRouting') as {
  __setPanelOpen: (open: boolean) => void;
};

describe('tourTargetWindows', () => {
  beforeEach(() => {
    channelMock.windowChannel.__setSelfType('bible');
    routingMock.__setPanelOpen(false);
  });

  it('marks panel search/resources targets as panel-owned', () => {
    expect(isPanelOwnedTourTarget('search-results')).toBe(true);
    expect(isPanelOwnedTourTarget('resources-panel')).toBe(true);
    expect(isPanelOwnedTourTarget('translations-filter')).toBe(true);
    expect(isPanelOwnedTourTarget('search-input')).toBe(false);
    expect(isPanelOwnedTourTarget('body')).toBe(false);
  });

  it('keeps panel targets on the Bible window when the panel is docked', () => {
    expect(tourTargetWindowRole('search-results')).toBe('bible');
    expect(tourTargetWindowRole('search-input')).toBe('bible');
  });

  it('routes panel targets to the panel popout when it is open', () => {
    routingMock.__setPanelOpen(true);
    expect(tourTargetWindowRole('search-results')).toBe('panel');
    expect(tourTargetWindowRole('search-input')).toBe('bible');
  });

  it('treats this window as the panel owner when running inside the panel popout', () => {
    channelMock.windowChannel.__setSelfType('panel');
    routingMock.__setPanelOpen(false);
    expect(tourTargetWindowRole('search-results')).toBe('panel');
    expect(tourTargetWindowRole('body')).toBe('panel');
  });
});
