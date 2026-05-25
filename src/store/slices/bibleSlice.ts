import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit';
import type { BibleData, BibleTranslationMeta, SearchResultSet } from '../../models/bible';
import type { PanelTab } from '../../models/tab';
import { bibleService } from '../../services/bibleService';
import { searchIndexService } from '../../services/searchIndexService';

interface BibleState {
  availableTranslations: BibleTranslationMeta[];
  currentBible: BibleData | null;
  loadedTranslations: Record<string, BibleData>;
  isLoading: boolean;
  error: string | null;
  tabs: PanelTab[];
  activeTabId: string | null;
  isPanelDetached: boolean;
  detachedPanelName: string | null;
}

const MAX_SEARCH_MATCHES = 1000;

const initialState: BibleState = {
  availableTranslations: [{
    id: 'KJV',
    label: 'KJV (King James Version)',
    source: 'data/bibles/KJV.json',
    isLocal: true,
    language: 'en'
  }],
  currentBible: null,
  loadedTranslations: {},
  isLoading: false,
  error: null,
  tabs: [],
  activeTabId: null,
  isPanelDetached: false,
  detachedPanelName: null
};

const buildSearchResults = (
  state: BibleState,
  queryInput: string,
  translationIds: string[]
): SearchResultSet | null => {
  const query = queryInput.trim();
  if (!query) {
    return null;
  }

  const metadataById = new Map(
    state.availableTranslations.map((translation) => [translation.id, translation.label] as const)
  );

  const allMatches = translationIds.flatMap((translationId) => {
    const translation = state.loadedTranslations[translationId];
    if (!translation) {
      return [];
    }

    const meta = state.availableTranslations.find((t) => t.id === translationId);
    const indexResult = searchIndexService.search(query, translationId, translation, meta?.language);
    const result = indexResult ?? bibleService.runSearch(translation, query);
    if (!result) {
      return [];
    }

    const label = metadataById.get(translationId) ?? translation.translation ?? translationId;
    return result.matches.map((match) => ({
      id: `${translationId}-${match.book}-${match.chapter}-${match.verse}`,
      book: match.book,
      chapter: match.chapter,
      verse: match.verse,
      text: match.text,
      translationId,
      translationLabel: label
    }));
  });

  // Dedupe by verse location (book, chapter, verse), keeping first occurrence.
  const seenVerses = new Set<string>();
  const matches = allMatches.filter((match) => {
    const verseKey = `${match.book}:${match.chapter}:${match.verse}`;
    if (seenVerses.has(verseKey)) {
      return false;
    }
    seenVerses.add(verseKey);
    return true;
  });

  const total = matches.length;
  const limitedMatches = matches.slice(0, MAX_SEARCH_MATCHES);
  return {
    query,
    matches: limitedMatches,
    total,
    limited: limitedMatches.length < total
  };
};

const createSearchTab = (searchResults: SearchResultSet, translationIds: string[]): PanelTab => {
  const now = Date.now();
  return {
    id: `tab-${now}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'search',
    title: searchResults.query,
    iconClass: 'fa-solid fa-magnifying-glass',
    searchResults,
    translationIds,
    createdAt: now,
    updatedAt: now
  };
};

const updateSearchTab = (tab: PanelTab, searchResults: SearchResultSet, translationIds: string[]): PanelTab => ({
  ...tab,
  title: searchResults.query,
  searchResults,
  translationIds,
  updatedAt: Date.now()
});

const findActiveTabIndex = (state: BibleState): number => {
  if (!state.activeTabId) {
    return -1;
  }
  return state.tabs.findIndex((tab) => tab.id === state.activeTabId);
};

export const refreshTranslations = createAsyncThunk(
  'bible/refreshTranslations',
  async (forceRefresh: boolean = false) => {
    return await bibleService.refreshAvailableTranslations(forceRefresh);
  }
);

export const loadTranslation = createAsyncThunk(
  'bible/loadTranslation',
  async (translationId: string) => {
    return await bibleService.loadTranslation(translationId);
  }
);

export const loadTranslations = createAsyncThunk(
  'bible/loadTranslations',
  async (translationIds: string[]) => {
    const uniqueIds = Array.from(new Set(translationIds));
    const settled = await Promise.allSettled(
      uniqueIds.map(async (id) => {
        const bible = await bibleService.loadTranslation(id);
        return [id, bible] as const;
      })
    );

    const entries = settled
      .filter((entry): entry is PromiseFulfilledResult<readonly [string, BibleData]> => entry.status === 'fulfilled')
      .map((entry) => entry.value);

    if (entries.length === 0) {
      throw new Error('Unable to load any selected translations');
    }

    return Object.fromEntries(entries) as Record<string, BibleData>;
  }
);

const bibleSlice = createSlice({
  name: 'bible',
  initialState,
  reducers: {
    setAvailableTranslations: (state, action: PayloadAction<BibleTranslationMeta[]>) => {
      state.availableTranslations = action.payload;
    },
    setCurrentBible: (state, action: PayloadAction<BibleData | null>) => {
      state.currentBible = action.payload;
    },
    setCurrentBibleFromId: (state, action: PayloadAction<string>) => {
      state.currentBible = state.loadedTranslations[action.payload] ?? null;
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
    runSearch: (state, action: PayloadAction<{ query: string; translationIds: string[] }>) => {
      const searchResults = buildSearchResults(state, action.payload.query, action.payload.translationIds);
      if (!searchResults) {
        return;
      }

      const activeIndex = findActiveTabIndex(state);
      if (activeIndex >= 0 && state.tabs[activeIndex].type === 'search') {
        state.tabs[activeIndex] = updateSearchTab(state.tabs[activeIndex], searchResults, action.payload.translationIds);
        return;
      }

      const searchTab = createSearchTab(searchResults, action.payload.translationIds);
      state.tabs.push(searchTab);
      state.activeTabId = searchTab.id;
    },
    runSearchInNewTab: (state, action: PayloadAction<{ query: string; translationIds: string[] }>) => {
      const searchResults = buildSearchResults(state, action.payload.query, action.payload.translationIds);
      if (!searchResults) {
        return;
      }

      const duplicate = state.tabs.find(
        (tab) =>
          tab.type === 'search' &&
          tab.searchResults?.query.toLowerCase() === searchResults.query.toLowerCase()
      );

      if (duplicate) {
        state.activeTabId = duplicate.id;
        return;
      }

      const searchTab = createSearchTab(searchResults, action.payload.translationIds);
      state.tabs.push(searchTab);
      state.activeTabId = searchTab.id;
    },
    runSearchInTab: (state, action: PayloadAction<{ tabId: string; query: string; translationIds: string[] }>) => {
      const searchResults = buildSearchResults(state, action.payload.query, action.payload.translationIds);
      if (!searchResults) {
        return;
      }

      const tabIndex = state.tabs.findIndex((tab) => tab.id === action.payload.tabId);
      if (tabIndex < 0) {
        return;
      }

      // Never replace non-search tabs (e.g. Translations) with search results.
      if (state.tabs[tabIndex].type !== 'search') {
        const searchTab = createSearchTab(searchResults, action.payload.translationIds);
        state.tabs.push(searchTab);
        state.activeTabId = searchTab.id;
        return;
      }

      state.tabs[tabIndex] = updateSearchTab(state.tabs[tabIndex], searchResults, action.payload.translationIds);
      state.activeTabId = action.payload.tabId;
    },
    setActiveTab: (state, action: PayloadAction<string>) => {
      if (!state.tabs.some((tab) => tab.id === action.payload)) {
        return;
      }
      state.activeTabId = action.payload;
    },
    closeTab: (state, action: PayloadAction<string>) => {
      const closeIndex = state.tabs.findIndex((tab) => tab.id === action.payload);
      if (closeIndex < 0) {
        return;
      }

      const [removed] = state.tabs.splice(closeIndex, 1);
      if (removed.id !== state.activeTabId) {
        return;
      }

      if (state.tabs.length === 0) {
        state.activeTabId = null;
        return;
      }

      const fallbackIndex = Math.max(0, closeIndex - 1);
      state.activeTabId = state.tabs[fallbackIndex].id;
    },
    setPanelDetached: (state, action: PayloadAction<{ detached: boolean; panelName?: string | null }>) => {
      state.isPanelDetached = action.payload.detached;
      if (action.payload.panelName !== undefined) {
        state.detachedPanelName = action.payload.panelName;
      }
    },
    clearSearch: (state) => {
      state.tabs = [];
      state.activeTabId = null;
    },
    openTranslationsTab: (state, action: PayloadAction<{ book: string; chapter: number; verse: number }>) => {
      const { book, chapter, verse } = action.payload;
      const now = Date.now();
      
      // Find existing translations tab
      const existingTab = state.tabs.find((tab) => tab.type === 'translations');
      
      if (existingTab) {
        // Update existing tab with new verse context
        existingTab.verseContext = { book, chapter, verse };
        existingTab.title = 'Translations';
        existingTab.updatedAt = now;
        state.activeTabId = existingTab.id;
      } else {
        // Create new translations tab
        const newTab: PanelTab = {
          id: `tab-translations-${now}`,
          type: 'translations',
          title: 'Translations',
          iconClass: 'fa-solid fa-language',
          verseContext: { book, chapter, verse },
          createdAt: now,
          updatedAt: now
        };
        state.tabs.push(newTab);
        state.activeTabId = newTab.id;
      }
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(refreshTranslations.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(refreshTranslations.fulfilled, (state, action) => {
        state.availableTranslations = action.payload;
        state.isLoading = false;
      })
      .addCase(refreshTranslations.rejected, (state, action) => {
        state.error = action.error.message || 'Failed to refresh translations';
        state.isLoading = false;
      })
      .addCase(loadTranslation.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(loadTranslation.fulfilled, (state, action) => {
        state.loadedTranslations[action.meta.arg] = action.payload;
        state.currentBible = action.payload;
        state.isLoading = false;
      })
      .addCase(loadTranslation.rejected, (state, action) => {
        state.error = action.error.message || 'Failed to load translation';
        state.isLoading = false;
      })
      .addCase(loadTranslations.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(loadTranslations.fulfilled, (state, action) => {
        state.loadedTranslations = {
          ...state.loadedTranslations,
          ...action.payload
        };

        const firstRequestedId = Object.keys(action.payload)[0];
        if (firstRequestedId && state.loadedTranslations[firstRequestedId]) {
          state.currentBible = state.loadedTranslations[firstRequestedId];
        }

        state.isLoading = false;
      })
      .addCase(loadTranslations.rejected, (state, action) => {
        state.error = action.error.message || 'Failed to load selected translations';
        state.isLoading = false;
      });
  }
});

export const {
  setAvailableTranslations,
  setCurrentBible,
  setCurrentBibleFromId,
  setError,
  runSearch,
  runSearchInNewTab,
  runSearchInTab,
  setActiveTab,
  closeTab,
  setPanelDetached,
  clearSearch,
  openTranslationsTab
} = bibleSlice.actions;

export default bibleSlice.reducer;
