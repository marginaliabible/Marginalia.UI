import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { BibleData, BibleTranslationMeta } from './models/bible';
import { BibleService } from './services/bible.service';
import { App } from './app';

const baseBible: BibleData = {
  translation: 'Mock',
  books: [
    {
      name: 'Genesis',
      chapters: [
        {
          chapter: 1,
          verses: [{ verse: 1, text: 'In the beginning God created the heaven and the earth.' }]
        }
      ]
    }
  ]
};

class BibleServiceStub {
  availableTranslations = signal<BibleTranslationMeta[]>([
    { id: 'KJV', label: 'KJV', source: 'data/bibles/KJV.json', isLocal: true, language: 'en' }
  ]);
  currentBible = signal<BibleData | null>(null);
  isLoading = signal(false);
  error = signal<string | null>(null);
  searchResults = signal(null);

  refreshAvailableTranslations = jasmine
    .createSpy('refreshAvailableTranslations')
    .and.callFake(async () => {});
  loadTranslation = jasmine.createSpy('loadTranslation').and.callFake(async (id: string) => {
    const bible = { ...baseBible, translation: id };
    this.currentBible.set(bible);
    return bible;
  });
  runSearch = jasmine.createSpy('runSearch').and.returnValue(null);
  clearSearch = jasmine.createSpy('clearSearch');
  readState = jasmine
    .createSpy('readState')
    .and.returnValue({ lastTranslationId: 'KJV', languages: [] as string[] });
  persistState = jasmine.createSpy('persistState').and.callFake((state) => state);
}

describe('App', () => {
  let fixture: ComponentFixture<App>;
  let component: App;
  let bibleService: BibleServiceStub;
  const originalMatchMedia = window.matchMedia;

  const setMatchMedia = (matches: boolean): void => {
    (window as any).matchMedia = jasmine.createSpy('matchMedia').and.returnValue({
      matches,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {}
    });
  };

  beforeEach(async () => {
    bibleService = new BibleServiceStub();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [{ provide: BibleService, useValue: bibleService }]
    }).compileComponents();
  });

  afterEach(() => {
    (window as any).matchMedia = originalMatchMedia;
  });

  it('defaults theme using prefers-color-scheme when no stored theme exists', async () => {
    setMatchMedia(true);
    bibleService.readState.and.returnValue({ lastTranslationId: 'KJV', languages: [] });

    fixture = TestBed.createComponent(App);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.theme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-bs-theme')).toBe('dark');
  });

  it('persists theme changes after initialization', async () => {
    setMatchMedia(false);
    bibleService.readState.and.returnValue({ lastTranslationId: 'KJV', languages: ['en'] });

    fixture = TestBed.createComponent(App);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.ready()).toBeTrue();
    component.setTheme('dark');
    fixture.detectChanges();
    // Allow the persistence effect (which runs after ready() flips) to flush before assertions
    await fixture.whenStable();

    expect(bibleService.persistState).toHaveBeenCalled();
    const lastCall = bibleService.persistState.calls.mostRecent().args[0] as Record<string, unknown>;
    expect(lastCall['theme']).toBe('dark');
    expect(lastCall['languages']).toEqual(component.selectedLanguages());
  });

  it('filters translations by selected languages and switches when current is excluded', async () => {
    bibleService.availableTranslations.set([
      { id: 'ENG', label: 'English', source: 'eng.json', isLocal: true, language: 'en' },
      { id: 'SPA', label: 'Spanish', source: 'spa.json', isLocal: false, language: 'es' },
      { id: 'FRA', label: 'French', source: 'fra.json', isLocal: false, language: 'fr' }
    ]);
    bibleService.readState.and.returnValue({ lastTranslationId: 'FRA', languages: ['es'] });


    fixture = TestBed.createComponent(App);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();

    // The language-change effect triggers async translation loading after the first cycle
    fixture.detectChanges();
    // Run a second pass so the onTranslationChange promise resolves and signals settle
    await fixture.whenStable();

    expect(component.filteredTranslations().map((meta) => meta.id)).toEqual(['SPA']);
    expect(bibleService.loadTranslation.calls.allArgs().map((args) => args[0])).toEqual(['FRA', 'SPA']);
    expect(component.selectedTranslationId()).toBe('SPA');
  });
});
