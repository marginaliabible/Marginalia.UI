import { CommonModule } from '@angular/common';
import {
  Component,
  computed,
  effect,
  inject,
  signal,
  type OnInit
} from '@angular/core';
import type { BibleBook, BibleTranslationMeta, QuickJumpTarget, ThemePreference } from './models/bible';
import { BibleService } from './services/bible.service';
import { parseQuickJump } from './utils/reference-parser';

type BootstrapModalInstance = {
  show: () => void;
  hide: () => void;
};

@Component({
  selector: 'app-root',
  imports: [CommonModule],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit {
  private readonly bibleService = inject(BibleService);
  private readonly initialState = this.bibleService.readState();
  private settingsModal: BootstrapModalInstance | null = null;

  readonly translations = this.bibleService.availableTranslations;
  readonly currentBible = this.bibleService.currentBible;
  readonly loading = this.bibleService.isLoading;
  readonly error = this.bibleService.error;
  readonly searchResults = this.bibleService.searchResults;

  readonly searchTerm = signal('');
  private readonly defaultTranslationId = 'KJV';
  readonly selectedTranslationId = signal(this.defaultTranslationId);
  readonly selectedBook = signal<string | null>(null);
  readonly selectedChapter = signal(1);
  readonly focusVerse = signal<number | null>(null);
  readonly selectedLanguages = signal<string[]>([]);
  readonly theme = signal<ThemePreference>(
    this.initialState.theme ?? this.detectPreferredTheme()
  );
  readonly ready = signal(false);

  readonly books = computed<readonly BibleBook[]>(() => this.currentBible()?.books ?? []);

  readonly languageOptions = computed(() => {
    const counts = new Map<string, number>();

    for (const translation of this.translations()) {
      for (const code of this.normalizeLanguages(translation.language)) {
        counts.set(code, (counts.get(code) ?? 0) + 1);
      }
    }

    return Array.from(counts.entries())
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => a.code.localeCompare(b.code));
  });

  readonly filteredTranslations = computed(() => {
    const selected = this.normalizeLanguageSelection(this.selectedLanguages());
    const all = this.translations();
    if (selected.length === 0) {
      return all;
    }

    const selectionSet = new Set(selected);
    const matches = all.filter((translation) => {
      const codes = this.normalizeLanguages(translation.language);
      if (codes.length === 0) {
        return true;
      }
      return codes.some((code) => selectionSet.has(code));
    });

    if (matches.length === 0) {
      return all;
    }

    return matches;
  });

  readonly chapters = computed(() => {
    const bookName = this.selectedBook();
    const book = this.books().find((candidate) => candidate.name === bookName);
    return book?.chapters ?? [];
  });

  readonly currentChapter = computed(() => {
    const chapterNumber = this.selectedChapter();
    return this.chapters().find((entry) => entry.chapter === chapterNumber) ?? null;
  });

  readonly quickJumpTarget = computed<QuickJumpTarget | null>(() => {
    if (!this.ready()) {
      return null;
    }

    const bible = this.currentBible();
    const query = this.searchTerm();
    if (!bible || !query) {
      return null;
    }

    return parseQuickJump(query, bible.books);
  });

  readonly quickJumpPreview = computed(() => {
    const bible = this.currentBible();
    const target = this.quickJumpTarget();
    if (!bible || !target) {
      return null;
    }

    const book = bible.books.find((entry) => entry.name === target.book);
    const chapter = book?.chapters.find((entry) => entry.chapter === target.chapter);
    const verseText = target.verse
      ? chapter?.verses.find((entry) => entry.verse === target.verse)?.text
      : undefined;

    return {
      ...target,
      text: verseText
    };
  });

  constructor() {
    effect(() => {
      const theme = this.theme();
      this.applyTheme(theme);
    });

    effect(() => {
      if (!this.ready()) {
        return;
      }

      this.bibleService.persistState({
        lastTranslationId: this.selectedTranslationId(),
        lastBook: this.selectedBook() ?? undefined,
        lastChapter: this.selectedBook() ? this.selectedChapter() : undefined,
        lastVerse: this.focusVerse() ?? undefined,
        lastSearch: this.searchTerm().trim() || undefined,
        theme: this.theme(),
        languages: this.selectedLanguages()
      });
    });

    effect(() => {
      if (!this.ready()) {
        return;
      }

      const filtered = this.filteredTranslations();
      const currentId = this.selectedTranslationId();
      if (filtered.length === 0) {
        return;
      }

      if (!filtered.some((entry) => entry.id === currentId)) {
        void this.onTranslationChange(filtered[0].id);
      }
    });
  }

  async ngOnInit(): Promise<void> {
    const storedState = this.initialState;

    await this.bibleService.refreshAvailableTranslations();

    const preferredLanguages = this.resolveInitialLanguages(storedState.languages);
    this.selectedLanguages.set(preferredLanguages);

    const translationId = this.resolveInitialTranslationId(storedState.lastTranslationId);
    this.selectedTranslationId.set(translationId);

    await this.bibleService.loadTranslation(translationId);

    const bible = this.currentBible();
    const fallbackBook = bible?.books[0]?.name ?? null;
    const persistedBook = storedState.lastBook ?? fallbackBook;
    const chosenBook = bible?.books.some((book) => book.name === persistedBook)
      ? persistedBook
      : fallbackBook;

    if (chosenBook) {
      this.selectedBook.set(chosenBook);
      const book = bible?.books.find((entry) => entry.name === chosenBook);
      const persistedChapter = storedState.lastChapter ?? 1;
      const validChapter = book?.chapters.some((entry) => entry.chapter === persistedChapter)
        ? persistedChapter
        : book?.chapters[0]?.chapter ?? 1;
      this.selectedChapter.set(validChapter);
    }

    if (storedState.lastVerse !== undefined) {
      this.focusVerse.set(storedState.lastVerse);
    }

    if (storedState.lastSearch) {
      this.searchTerm.set(storedState.lastSearch);
      this.bibleService.runSearch(storedState.lastSearch);
    }

    this.ready.set(true);
  }

  async onTranslationChange(id: string): Promise<void> {
    if (!id || id === this.selectedTranslationId()) {
      return;
    }

    this.selectedTranslationId.set(id);
    await this.bibleService.loadTranslation(id);

    const bible = this.currentBible();
    const currentBook = this.selectedBook();
    const nextBook = bible?.books.some((book) => book.name === currentBook)
      ? currentBook
      : bible?.books[0]?.name ?? null;

    this.selectedBook.set(nextBook);

    if (nextBook) {
      const book = bible?.books.find((entry) => entry.name === nextBook);
      const currentChapter = this.selectedChapter();
      const validChapter = book?.chapters.some((entry) => entry.chapter === currentChapter)
        ? currentChapter
        : book?.chapters[0]?.chapter ?? 1;
      this.selectedChapter.set(validChapter);
    }

    this.focusVerse.set(null);
    this.bibleService.clearSearch();
  }

  onTranslationSelect(event: Event): void {
    const select = event.target as HTMLSelectElement | null;
    if (!select) {
      return;
    }

    void this.onTranslationChange(select.value);
  }

  onBookChange(name: string): void {
    if (!name) {
      return;
    }

    this.selectedBook.set(name);
    const book = this.books().find((entry) => entry.name === name);
    const chapter = book?.chapters[0]?.chapter ?? 1;
    this.selectedChapter.set(chapter);
    this.focusVerse.set(null);
  }

  onBookSelect(event: Event): void {
    const select = event.target as HTMLSelectElement | null;
    if (!select) {
      return;
    }

    this.onBookChange(select.value);
  }

  onChapterChange(value: string): void {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
      return;
    }

    this.selectedChapter.set(parsed);
    this.focusVerse.set(null);
  }

  onChapterSelect(event: Event): void {
    const select = event.target as HTMLSelectElement | null;
    if (!select) {
      return;
    }

    this.onChapterChange(select.value);
  }

  handleSearchInput(value: string): void {
    this.searchTerm.set(value);
    if (this.searchResults()) {
      this.bibleService.clearSearch();
    }
  }

  onSearchFieldInput(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    this.handleSearchInput(input?.value ?? '');
  }

  async submitSearch(event: Event): Promise<void> {
    event.preventDefault();
    const query = this.searchTerm().trim();
    this.searchTerm.set(query);
    if (!query) {
      this.bibleService.clearSearch();
      this.focusVerse.set(null);
      return;
    }

    const quickJump = this.quickJumpTarget();
    if (quickJump) {
      await this.goToReference(quickJump);
      return;
    }

    const result = this.bibleService.runSearch(query);
    if (result && result.matches.length > 0) {
      const firstMatch = result.matches[0];
      await this.goToReference({
        book: firstMatch.book,
        chapter: firstMatch.chapter,
        verse: firstMatch.verse
      });
    }
  }

  async goToReference(target: QuickJumpTarget): Promise<void> {
    const bible = this.currentBible();
    if (!bible) {
      return;
    }

    if (!bible.books.some((book) => book.name === target.book)) {
      return;
    }

    this.selectedBook.set(target.book);
    this.selectedChapter.set(target.chapter);
    this.focusVerse.set(target.verse ?? null);

    await this.scrollToVerse(target);
  }

  setTheme(preference: ThemePreference): void {
    this.theme.set(preference);
  }

  onThemeToggle(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    if (!input) {
      return;
    }

    this.setTheme(input.checked ? 'dark' : 'light');
  }

  async openSettingsModal(): Promise<void> {
    const el = document.getElementById('settingsModal');
    if (!el) return;

    if (!this.settingsModal) {
      const { default: Modal } = await import('bootstrap/js/dist/modal');
      this.settingsModal = Modal.getOrCreateInstance(el);
    }

    this.settingsModal?.show();
  }

  closeSettingsModal(): void {
    this.settingsModal?.hide();
  }

  onLanguagesChange(event: Event): void {
    const select = event.target as HTMLSelectElement | null;
    if (!select) {
      return;
    }

    const selected = Array.from(select.selectedOptions).map((option) => option.value);
    this.selectedLanguages.set(this.normalizeLanguageSelection(selected));
  }

  verseDomId(book: string, chapter: number, verse: number): string {
    return `${book.replace(/\s+/g, '_')}-${chapter}-${verse}`;
  }

  getLanguageDisplayName(code: string): string {
    if (typeof Intl === 'undefined' || typeof Intl.DisplayNames === 'undefined') {
      return code.toUpperCase();
    }

    try {
      const displayNames = new Intl.DisplayNames(['en'], { type: 'language' });
      const name = displayNames.of(code);
      return name || code.toUpperCase();
    } catch {
      return code.toUpperCase();
    }
  }

  private applyTheme(theme: ThemePreference): void {
    if (typeof document === 'undefined') {
      return;
    }

    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-bs-theme', theme);
  }

  private detectPreferredTheme(): ThemePreference {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return 'light';
    }

    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  private resolveInitialLanguages(stored?: string[]): string[] {
    if (stored && stored.length > 0) {
      const normalized = this.normalizeLanguageSelection(stored);
      if (normalized.length > 0) {
        const available = new Set(this.languageOptions().map((entry) => entry.code));
        if (available.size === 0 || normalized.some((code) => available.has(code))) {
          return normalized;
        }
      }
    }

    return this.detectPreferredLanguages();
  }

  private resolveInitialTranslationId(requested?: string): string {
    const filtered = this.filteredTranslations();
    const all = this.translations();
    if (requested) {
      const match =
        filtered.find((entry) => entry.id === requested) ??
        all.find((entry) => entry.id === requested);
      if (match) {
        return match.id;
      }
    }

    return filtered[0]?.id ?? all[0]?.id ?? this.defaultTranslationId;
  }

  private normalizeLanguages(language: BibleTranslationMeta['language']): string[] {
    if (!language) {
      return [];
    }

    const candidates = Array.isArray(language) ? language : [language];
    return this.normalizeLanguageSelection(candidates);
  }

  private normalizeLanguageSelection(values: string[]): string[] {
    const normalized = values
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0);

    return Array.from(new Set(normalized));
  }

  private detectPreferredLanguages(): string[] {
    const defaults = ['he', 'hbo', 'el', 'grc'];

    if (typeof navigator === 'undefined') {
      return this.normalizeLanguageSelection(['en', ...defaults]);
    }

    const navigatorLanguages =
      (Array.isArray(navigator.languages) && navigator.languages.length > 0
        ? navigator.languages
        : []) ?? [];
    const primaryLanguage = navigator.language ? [navigator.language] : [];

    const fromNavigator = [...navigatorLanguages, ...primaryLanguage];
    const normalized = fromNavigator.flatMap((entry) => {
      const lower = entry?.toLowerCase() ?? '';
      if (!lower) {
        return [];
      }
      const base = lower.split('-')[0];
      return base && base !== lower ? [base, lower] : [lower];
    });

    return this.normalizeLanguageSelection([...normalized, ...defaults]);
  }

  private async scrollToVerse(target: QuickJumpTarget): Promise<void> {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    if (!target.verse) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const elementId = this.verseDomId(target.book, target.chapter, target.verse);

    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

    const element = document.getElementById(elementId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}
