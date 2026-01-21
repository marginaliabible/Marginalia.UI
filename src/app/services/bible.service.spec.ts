import { BibleService } from './bible.service';

describe('BibleService refreshAvailableTranslations', () => {
  let service: BibleService;
  let originalFetch: typeof fetch | undefined;
  let storage: Record<string, string>;
  let getItemSpy: jasmine.Spy;
  let setItemSpy: jasmine.Spy;
  let originalGetItem: typeof window.localStorage.getItem;
  let originalSetItem: typeof window.localStorage.setItem;

  beforeAll(() => {
    originalGetItem = window.localStorage.getItem;
    originalSetItem = window.localStorage.setItem;
    getItemSpy = spyOn(window.localStorage, 'getItem');
    setItemSpy = spyOn(window.localStorage, 'setItem');
  });

  beforeEach(() => {
    storage = {};
    originalFetch = (globalThis as any).fetch;
    getItemSpy.and.callFake((key: string) => storage[key] ?? null);
    setItemSpy.and.callFake((key: string, value: string) => {
      storage[key] = value;
    });
    service = new BibleService();
  });

  afterEach(() => {
    (globalThis as any).fetch = originalFetch as typeof fetch;
    getItemSpy.calls.reset();
    setItemSpy.calls.reset();
  });

  afterAll(() => {
    window.localStorage.getItem = originalGetItem;
    window.localStorage.setItem = originalSetItem;
  });

  it('loads translation metadata from _settings.json', async () => {
    const payload = {
      translations: [
        {
          id: 'ESV',
          label: 'English Standard Version',
          location: 'https://example.com/ESV.json',
          language: 'en'
        },
        {
          id: 'RVR',
          label: 'Reina Valera',
          location: 'spanish/RVR.json',
          language: ['es', 'en']
        }
      ]
    };

    (globalThis as any).fetch = jasmine.createSpy('fetch').and.callFake(async () => ({
      ok: true,
      json: async () => payload
    }));

    await service.refreshAvailableTranslations(true);
    const translations = service.availableTranslations();

    expect((globalThis as any).fetch).toHaveBeenCalledWith('data/bibles/_settings.json', {
      cache: 'no-store'
    });
    const esv = translations.find((entry) => entry.id === 'ESV');
    expect(esv?.label).toContain('English Standard Version');
    expect(esv?.source).toBe('https://example.com/ESV.json');

    const rvr = translations.find((entry) => entry.id === 'RVR');
    expect(rvr?.source).toBe('data/bibles/spanish/RVR.json');
    expect(rvr?.language).toEqual(['es', 'en']);

    expect(translations.some((entry) => entry.id === 'KJV')).toBeTrue();
  });

  it('prefers local entries when duplicate translations are present', async () => {
    const payload = {
      translations: [
        { id: 'ESV', label: 'ESV Remote', location: 'https://remote/ESV.json', language: 'en' },
        { id: 'ESV', label: 'ESV Local', location: 'local/esv.json', language: 'en' },
        { id: 'KJV', label: 'KJV Remote', location: 'https://remote/KJV.json', language: 'en' }
      ]
    };

    (globalThis as any).fetch = jasmine.createSpy('fetch').and.callFake(async () => ({
      ok: true,
      json: async () => payload
    }));

    await service.refreshAvailableTranslations(true);
    const translations = service.availableTranslations();

    const esv = translations.find((entry) => entry.id === 'ESV');
    expect(esv?.isLocal).toBeTrue();
    expect(esv?.source).toBe('data/bibles/local/esv.json');
    expect(esv?.label).toBe('ESV Local');

    const kjv = translations.find((entry) => entry.id === 'KJV');
    expect(kjv?.isLocal).toBeTrue();
    expect(kjv?.source).toBe('data/bibles/KJV.json');
  });
});
