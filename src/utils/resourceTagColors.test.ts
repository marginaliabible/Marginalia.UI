import {
  TAG_COLOR_PALETTE,
  TAG_COLOR_STORAGE_KEY,
  assignResourceTagColors,
  getResourceTagColors,
  mergeIntoResourceTagColors,
  mergeResourceTagColors,
  normalizeResourceTagColors,
} from './resourceTagColors';

const [teal, yellow, pink] = TAG_COLOR_PALETTE;

describe('normalizeResourceTagColors', () => {
  it('reads colors saved before assignments were timed as assigned at 0', () => {
    expect(normalizeResourceTagColors({ Teaching: teal, ' Notes ': { color: yellow, assignedAt: 500 }, '': pink, Bad: 7 }))
      .toEqual({ Teaching: { color: teal, assignedAt: 0 }, Notes: { color: yellow, assignedAt: 500 } });
  });
});

describe('mergeResourceTagColors', () => {
  it('keeps the earliest color for each tag regardless of order', () => {
    const original = { Teaching: { color: teal, assignedAt: 1000 } };
    const freshDevice = { Teaching: { color: yellow, assignedAt: 5000 }, Notes: { color: teal, assignedAt: 5000 } };

    const forward = mergeResourceTagColors([original, freshDevice]);
    const reverse = mergeResourceTagColors([freshDevice, original]);

    expect(forward).toEqual(reverse);
    expect(forward['Teaching']).toEqual({ color: teal, assignedAt: 1000 });
    expect(forward['Notes']?.color).not.toBe(teal);
  });

  it('moves a later tag off a color an earlier tag holds, stably across re-merges', () => {
    const deviceA = { Teaching: { color: teal, assignedAt: 1000 } };
    const deviceB = { Syllabus: { color: teal, assignedAt: 2000 } };

    const merged = mergeResourceTagColors([deviceA, deviceB]);

    expect(merged).toEqual({
      Teaching: { color: teal, assignedAt: 1000 },
      Syllabus: { color: yellow, assignedAt: 2000 },
    });
    expect(mergeResourceTagColors([deviceB, merged])).toEqual(merged);
    expect(mergeResourceTagColors([merged, deviceA, deviceB])).toEqual(merged);
  });

  it('breaks assignment-time ties by color so every device converges', () => {
    const left = { Teaching: { color: yellow, assignedAt: 0 } };
    const right = { Teaching: { color: teal, assignedAt: 0 } };

    expect(mergeResourceTagColors([left, right])).toEqual(mergeResourceTagColors([right, left]));
  });
});

describe('resource tag color store', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('assigns unused palette colors only to tags without one', () => {
    window.localStorage.setItem(TAG_COLOR_STORAGE_KEY, JSON.stringify({ Teaching: teal }));

    assignResourceTagColors(['Teaching', 'Notes', ' Notes ']);

    const colors = getResourceTagColors();
    expect(colors['Teaching']).toEqual({ color: teal, assignedAt: 0 });
    expect(colors['Notes']?.color).toBe(yellow);
    expect(colors['Notes']?.assignedAt).toBeGreaterThan(0);
    expect(Object.keys(colors)).toHaveLength(2);
  });

  it('adopts earlier colors from another copy and persists them', () => {
    assignResourceTagColors(['Teaching']);

    mergeIntoResourceTagColors({ Teaching: { color: pink, assignedAt: 1 } });

    expect(getResourceTagColors()['Teaching']).toEqual({ color: pink, assignedAt: 1 });
    expect(JSON.parse(window.localStorage.getItem(TAG_COLOR_STORAGE_KEY) ?? '{}').Teaching).toEqual({ color: pink, assignedAt: 1 });
  });
});
