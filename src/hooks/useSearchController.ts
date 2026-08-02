import { useState, useMemo, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import {
  loadTranslations,
  runSearchInNewTab,
  runSearchInTab,
  clearSearch,
} from '../store/slices/bibleSlice';
import { setSearchTerm, clearVerseSelection } from '../store/slices/uiSlice';
import { parseQuickJump } from '../utils/reference-parser';
import type { QuickJumpTarget } from '../models/bible';
import type { SearchHistoryEntry } from '../components/SearchActionDropdown';

const SEARCH_HISTORY_KEY = 'marginalia:search-jump-history';
const MAX_SEARCH_HISTORY = 50;

interface UseSearchControllerOptions {
  starredTranslationIds: string[];
  goToReference: (target: QuickJumpTarget, translationId?: string) => Promise<void>;
  isPanelDetached: boolean;
  focusDetachedPanel: () => void;
  isDesktopLayout: boolean;
  setIsMobilePanelOpen: (open: boolean) => void;
  onEmptyEscape?: () => void;
  onSearchComplete?: () => void;
}

export interface SearchControllerApi {
  searchTerm: string;
  normalizedSearchTerm: string;
  isSearchFocused: boolean;
  isSearchActionDropdownOpen: boolean;
  searchActionIndex: number | null;
  historyEntries: SearchHistoryEntry[];
  activeTabTitle: string | null;
  quickJumpPreview: {
    book: string;
    chapter: number;
    verse?: number;
    text?: string;
  } | null;
  canShowSearchActionDropdown: boolean;
  handleSearchInput: (value: string) => void;
  handleSearchInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  handleFocus: () => void;
  handleBlur: () => void;
  handleSubmitSearch: (event?: React.FormEvent) => Promise<void>;
  runSearchByAction: (query: string, action: 'replace' | 'new') => Promise<void>;
  handleSelectHistory: (entry: SearchHistoryEntry) => Promise<void>;
  handleSelectQuickJump: () => Promise<void>;
  closeDropdown: () => void;
  handlePrimaryActionOrHide: (explicitQuery?: string) => Promise<void>;
}

export const useSearchController = ({
  starredTranslationIds,
  goToReference,
  isPanelDetached,
  focusDetachedPanel,
  isDesktopLayout,
  setIsMobilePanelOpen,
  onEmptyEscape,
  onSearchComplete,
}: UseSearchControllerOptions): SearchControllerApi => {
  const dispatch = useAppDispatch();
  const { tabs, activeTabId, currentBible } = useAppSelector((state) => state.bible);
  const { searchTerm, ready } = useAppSelector((state) => state.ui);

  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [isSearchActionDropdownOpen, setIsSearchActionDropdownOpen] = useState(false);
  const [searchActionIndex, setSearchActionIndex] = useState<number | null>(null);
  const [historyEntries, setHistoryEntries] = useState<SearchHistoryEntry[]>([]);

  const normalizedSearchTerm = searchTerm.trim();

  const activeTab = useMemo(() => {
    if (!activeTabId) return null;
    return tabs.find((tab) => tab.id === activeTabId) ?? null;
  }, [tabs, activeTabId]);

  const quickJumpTarget = useMemo<QuickJumpTarget | null>(() => {
    if (!ready || !currentBible || !searchTerm) return null;
    return parseQuickJump(searchTerm, currentBible.books);
  }, [ready, currentBible, searchTerm]);

  const quickJumpPreview = useMemo(() => {
    if (!currentBible || !quickJumpTarget) return null;

    const book = currentBible.books.find((b) => b.name === quickJumpTarget.book);
    const chapter = book?.chapters.find((c) => c.chapter === quickJumpTarget.chapter);
    const verseText = quickJumpTarget.verse
      ? chapter?.verses.find((v) => v.verse === quickJumpTarget.verse)?.text
      : undefined;

    return { ...quickJumpTarget, text: verseText };
  }, [currentBible, quickJumpTarget]);

  const canShowSearchActionDropdown =
    activeTab?.type === 'search' &&
    Boolean(activeTabId) &&
    tabs.length > 0 &&
    !quickJumpTarget &&
    normalizedSearchTerm.length > 0;

  const actionCount = canShowSearchActionDropdown ? 2 : 0;
  const quickJumpCount = quickJumpPreview ? 1 : 0;
  const selectableCount = actionCount + quickJumpCount + historyEntries.length;

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const raw = window.localStorage.getItem(SEARCH_HISTORY_KEY);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return;
      }

      const normalized = parsed
        .filter((entry): entry is SearchHistoryEntry => {
          return Boolean(entry) && typeof entry.query === 'string' && (entry.kind === 'search' || entry.kind === 'quick-jump');
        })
        .map((entry) => ({
          query: entry.query.trim(),
          kind: entry.kind,
          referenceLabel: typeof entry.referenceLabel === 'string' ? entry.referenceLabel : undefined,
        }))
        .filter((entry) => entry.query.length > 0)
        .slice(0, MAX_SEARCH_HISTORY);

      setHistoryEntries(normalized);
    } catch {
      setHistoryEntries([]);
    }
  }, []);

  useEffect(() => {
    if (searchActionIndex === null) {
      return;
    }

    if (selectableCount === 0) {
      setSearchActionIndex(null);
      return;
    }

    if (searchActionIndex < selectableCount) {
      return;
    }

    setSearchActionIndex(selectableCount - 1);
  }, [searchActionIndex, selectableCount]);

  const updateSearchHistory = (query: string, jumpTarget: QuickJumpTarget | null) => {
    const normalized = query.trim();
    if (!normalized) {
      return;
    }

    const nextEntry: SearchHistoryEntry = jumpTarget
      ? {
        query: normalized,
        kind: 'quick-jump',
        referenceLabel: `${jumpTarget.book} ${jumpTarget.chapter}${jumpTarget.verse ? `:${jumpTarget.verse}` : ''}`,
      }
      : {
        query: normalized,
        kind: 'search',
      };

    const nextHistory = [
      nextEntry,
      ...historyEntries.filter((entry) => entry.query.toLowerCase() !== normalized.toLowerCase()),
    ].slice(0, MAX_SEARCH_HISTORY);

    setHistoryEntries(nextHistory);

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(nextHistory));
    }
  };

  const runSearchByAction = async (query: string, action: 'replace' | 'new') => {
    const normalized = query.trim();
    if (!normalized) return;

    updateSearchHistory(normalized, null);

    await dispatch(loadTranslations(starredTranslationIds));

    if (action === 'new') {
      dispatch(runSearchInNewTab({ query: normalized, translationIds: starredTranslationIds }));
    } else if (activeTabId && activeTab?.type === 'search') {
      dispatch(runSearchInTab({ tabId: activeTabId, query: normalized, translationIds: starredTranslationIds }));
    } else {
      dispatch(runSearchInNewTab({ query: normalized, translationIds: starredTranslationIds }));
    }

    setIsSearchActionDropdownOpen(false);
    setSearchActionIndex(0);

    if (!isDesktopLayout && !isPanelDetached) {
      setIsMobilePanelOpen(true);
    }

    if (isPanelDetached) {
      focusDetachedPanel();
    }

    onSearchComplete?.();
  };

  const handleSearchInput = (value: string) => {
    setIsSearchActionDropdownOpen(true);
    const trimmedValue = value.trim();
    const nextQuickJumpTarget = ready && currentBible && trimmedValue
      ? parseQuickJump(trimmedValue, currentBible.books)
      : null;
    const nextCanShowSearchActionDropdown =
      activeTab?.type === 'search' &&
      Boolean(activeTabId) &&
      tabs.length > 0 &&
      !nextQuickJumpTarget &&
      trimmedValue.length > 0;

    setSearchActionIndex((nextCanShowSearchActionDropdown || nextQuickJumpTarget) ? 0 : null);
    dispatch(setSearchTerm(value));
  };

  const handleSelectHistory = async (entry: SearchHistoryEntry) => {
    const normalized = entry.query.trim();
    if (!normalized) {
      return;
    }

    dispatch(setSearchTerm(normalized));

    if (entry.kind === 'quick-jump' && currentBible) {
      const target = parseQuickJump(normalized, currentBible.books);
      if (target) {
        await goToReference(target);
        updateSearchHistory(normalized, target);
        setIsSearchActionDropdownOpen(false);
        onSearchComplete?.();
        return;
      }
    }

    await runSearchByAction(
      normalized,
      activeTabId && activeTab?.type === 'search' ? 'replace' : 'new'
    );
  };

  const handleSelectQuickJump = async () => {
    if (!quickJumpTarget || !quickJumpPreview) {
      return;
    }

    const normalized = `${quickJumpPreview.book} ${quickJumpPreview.chapter}${quickJumpPreview.verse ? `:${quickJumpPreview.verse}` : ''}`;
    dispatch(setSearchTerm(normalized));
    await goToReference(quickJumpTarget);
    updateSearchHistory(normalized, quickJumpTarget);
    setIsSearchActionDropdownOpen(false);
    onSearchComplete?.();
  };

  const executeQuery = async (queryInput: string) => {
    const query = queryInput.trim();
    dispatch(setSearchTerm(query));

    if (!query) {
      dispatch(clearSearch());
      dispatch(clearVerseSelection());
      return;
    }

    const parsedQuickJump = currentBible ? parseQuickJump(query, currentBible.books) : null;
    if (parsedQuickJump) {
      await goToReference(parsedQuickJump);
      updateSearchHistory(query, parsedQuickJump);
      setIsSearchActionDropdownOpen(false);
      onSearchComplete?.();
      return;
    }

    await runSearchByAction(query, activeTabId && activeTab?.type === 'search' ? 'replace' : 'new');
  };

  const handleSubmitSearch = async (event?: React.FormEvent) => {
    if (event) {
      event.preventDefault();
    }

    await executeQuery(normalizedSearchTerm);
  };

  const closeDropdown = () => {
    setIsSearchActionDropdownOpen(false);
    setSearchActionIndex(null);
  };

  const handlePrimaryActionOrHide = async (explicitQuery?: string) => {
    const candidateQuery = typeof explicitQuery === 'string' ? explicitQuery.trim() : normalizedSearchTerm;

    if (!candidateQuery) {
      onEmptyEscape?.();
      return;
    }

    await executeQuery(candidateQuery);
  };

  const handleSearchInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const query = normalizedSearchTerm;
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      void runSearchByAction(query, 'new');
      return;
    }

    if (!isSearchActionDropdownOpen) {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (quickJumpPreview) {
          void handleSelectQuickJump();
        } else if (query.length > 0) {
          void executeQuery(query);
        }
      }
      return;
    }

    if (event.key === 'ArrowDown' && selectableCount > 0) {
      event.preventDefault();
      setSearchActionIndex((index) => {
        if (index === null) {
          return 0;
        }

        return Math.min(selectableCount - 1, index + 1);
      });
      return;
    }

    if (event.key === 'ArrowUp' && selectableCount > 0) {
      event.preventDefault();
      setSearchActionIndex((index) => {
        if (index === null) {
          return selectableCount - 1;
        }

        return Math.max(0, index - 1);
      });
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (searchActionIndex !== null && searchActionIndex < actionCount) {
        void runSearchByAction(query, searchActionIndex === 0 ? 'replace' : 'new');
        return;
      }

      if (searchActionIndex !== null && searchActionIndex < actionCount + quickJumpCount) {
        void handleSelectQuickJump();
        return;
      }

      if (searchActionIndex !== null) {
        const historyEntry = historyEntries[searchActionIndex - actionCount - quickJumpCount];
        if (historyEntry) {
          void handleSelectHistory(historyEntry);
        }
        return;
      }

      if (quickJumpPreview) {
        void handleSelectQuickJump();
        return;
      }

      if (query.length > 0) {
        void executeQuery(query);
      }

      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      closeDropdown();
      if (!normalizedSearchTerm) {
        onEmptyEscape?.();
      }
    }
  };

  return {
    searchTerm,
    normalizedSearchTerm,
    isSearchFocused,
    isSearchActionDropdownOpen,
    searchActionIndex,
    historyEntries,
    activeTabTitle: canShowSearchActionDropdown ? activeTab?.title ?? null : null,
    quickJumpPreview,
    canShowSearchActionDropdown,
    handleSearchInput,
    handleSearchInputKeyDown,
    handleFocus: () => {
      setIsSearchFocused(true);
      setIsSearchActionDropdownOpen(true);
      setSearchActionIndex(normalizedSearchTerm.length > 0 && (canShowSearchActionDropdown || Boolean(quickJumpPreview)) ? 0 : null);
    },
    handleBlur: () => {
      setIsSearchFocused(false);
      setIsSearchActionDropdownOpen(false);
      setSearchActionIndex(null);
    },
    handleSubmitSearch,
    runSearchByAction,
    handleSelectHistory,
    handleSelectQuickJump,
    closeDropdown,
    handlePrimaryActionOrHide,
  };
};
