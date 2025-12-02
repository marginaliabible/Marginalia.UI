import { CommonModule } from '@angular/common';
import {
  Component,
  computed,
  effect,
  inject,
  signal,
  type OnInit
} from '@angular/core';
import type { BibleBook, QuickJumpTarget, ThemePreference } from './models/bible';
import { BibleService } from './services/bible.service';
import { parseQuickJump } from './utils/reference-parser';

@Component({
  selector: 'app-root',
  imports: [CommonModule],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit {
  private readonly bibleService = inject(BibleService);

  readonly translations = this.bibleService.availableTranslations;
  readonly currentBible = this.bibleService.currentBible;
  readonly loading = this.bibleService.isLoading;
  readonly error = this.bibleService.error;
  readonly searchResults = this.bibleService.searchResults;

  readonly searchTerm = signal('');
  readonly selectedTranslationId = signal('KJV');
  readonly selectedBook = signal<string | null>(null);
  readonly selectedChapter = signal(1);
  readonly focusVerse = signal<number | null>(null);
  readonly theme = signal<ThemePreference>('light');
  readonly ready = signal(false);

  readonly books = computed<readonly BibleBook[]>(() => this.currentBible()?.books ?? []);

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
      if (!this.ready()) {
        return;
      }

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
        theme: this.theme()
      });
    });
  }

  async ngOnInit(): Promise<void> {
    const storedState = this.bibleService.readState();
    if (storedState.theme) {
      this.theme.set(storedState.theme);
    } else {
      this.theme.set(this.detectPreferredTheme());
    }

    await this.bibleService.refreshAvailableTranslations();

    const translationId = storedState.lastTranslationId || 'KJV';
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

    this.applyTheme(this.theme());
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

  toggleTheme(): void {
    const nextTheme: ThemePreference = this.theme() === 'dark' ? 'light' : 'dark';
    this.theme.set(nextTheme);
  }

  verseDomId(book: string, chapter: number, verse: number): string {
    return `${book.replace(/\s+/g, '_')}-${chapter}-${verse}`;
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
    if (typeof window === 'undefined') {
      return 'light';
    }

    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
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
