import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit';
import type { BibleData, BibleTranslationMeta, ExtraLanguageMeta, SearchResultSet } from '../../models/bible';
import type { PanelTab } from '../../models/tab';
import { bibleService } from '../../services/bibleService';
import { searchIndexService } from '../../services/searchIndexService';
import { compareBibleReferences } from '../../utils/book-aliases';

interface BibleState {
  availableTranslations: BibleTranslationMeta[];
  extraLanguages: ExtraLanguageMeta[];
  currentBible: BibleData | null;
  loadedTranslations: Record<string, BibleData>;
  isLoading: boolean;
  error: string | null;
  tabs: PanelTab[];
  activeTabId: string | null;
  lastVersePanelType: 'translations' | 'resources' | 'links';
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
  extraLanguages: [],
  currentBible: null,
  loadedTranslations: {},
  isLoading: false,
  error: null,
  tabs: [],
  activeTabId: null,
  lastVersePanelType: 'resources',
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

  const seenVerses = new Set<string>();
  const matches: SearchResultSet['matches'] = [];
  let total = 0;

  for (const translationId of translationIds) {
    const translation = state.loadedTranslations[translationId];
    if (!translation) {
      continue;
    }

    const meta = state.availableTranslations.find((t) => t.id === translationId);
    const indexResult = searchIndexService.search(query, translationId, translation, meta?.language);
    const result = indexResult ?? bibleService.runSearch(translation, query);
    if (!result) {
      continue;
    }

    const label = metadataById.get(translationId) ?? translation.translation ?? translationId;
    for (const match of result.matches) {
      const verseKey = `${match.book}:${match.chapter}:${match.verse}`;
      if (seenVerses.has(verseKey)) {
        continue;
      }

      seenVerses.add(verseKey);
      total += 1;

      matches.push({
        id: `${translationId}-${match.book}-${match.chapter}-${match.verse}`,
        book: match.book,
        chapter: match.chapter,
        verse: match.verse,
        text: match.text,
        translationId,
        translationLabel: label
      });
    }
  }

  return {
    query,
    matches: matches
      .sort((left, right) => (
        compareBibleReferences(left, right)
        || (left.translationId ?? '').localeCompare(right.translationId ?? '')
      ))
      .slice(0, MAX_SEARCH_MATCHES),
    total,
    limited: total > MAX_SEARCH_MATCHES
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

const createDeferredSearchPanelTab = (queryInput: string, translationIds: string[]): PanelTab | null => {
  const query = queryInput.trim();
  if (!query) {
    return null;
  }

  const now = Date.now();
  return {
    id: `tab-${now}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'search',
    title: query,
    iconClass: 'fa-solid fa-magnifying-glass',
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

const isVersePanelTab = (tab: PanelTab): boolean => (
  tab.type === 'translations' || tab.type === 'resources' || tab.type === 'links'
);

const applyVerseContextToTab = (
  tab: PanelTab,
  verseContext: { book: string; chapter: number; verse: number } | null,
  now: number
): void => {
  if (verseContext) {
    const current = tab.verseContext;
    if (
      current
      && current.book === verseContext.book
      && current.chapter === verseContext.chapter
      && current.verse === verseContext.verse
    ) {
      return;
    }
    tab.verseContext = verseContext;
  } else if (tab.verseContext) {
    delete tab.verseContext;
  } else {
    return;
  }

  tab.updatedAt = now;
};

const applyVerseContextToVerseTabs = (
  state: BibleState,
  verseContext: { book: string; chapter: number; verse: number } | null
): void => {
  const now = Date.now();
  for (const tab of state.tabs) {
    if (!isVersePanelTab(tab)) {
      continue;
    }

    applyVerseContextToTab(tab, verseContext, now);
  }
};

const applyVerseContextToActiveVerseTab = (
  state: BibleState,
  verseContext: { book: string; chapter: number; verse: number } | null
): void => {
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
  if (!activeTab || !isVersePanelTab(activeTab)) {
    return;
  }

  applyVerseContextToTab(activeTab, verseContext, Date.now());
};

const upsertVerseTab = (
  state: BibleState,
  type: 'translations' | 'resources' | 'links',
  verseContext: { book: string; chapter: number; verse: number } | null,
  now: number
): PanelTab => {
  const existing = state.tabs.find((tab) => tab.type === type);
  const title = type === 'translations' ? 'Translations' : type === 'resources' ? 'Resources' : 'Links';
  const iconClass = type === 'translations'
    ? 'fa-solid fa-language'
    : type === 'resources'
      ? 'fa-solid fa-book-open-reader'
      : 'fa-solid fa-link';

  if (existing) {
    if (verseContext) {
      existing.verseContext = verseContext;
    }
    existing.title = title;
    existing.iconClass = iconClass;
    existing.updatedAt = now;
    return existing;
  }

  const created: PanelTab = {
    id: `tab-${type}-${now}`,
    type,
    title,
    iconClass,
    createdAt: now,
    updatedAt: now,
  };

  if (verseContext) {
    created.verseContext = verseContext;
  }

  state.tabs.push(created);
  return created;
};

export const refreshTranslations = createAsyncThunk(
  'bible/refreshTranslations',
  async (forceRefresh: boolean = false, thunkApi) => {
    const state = thunkApi.getState() as { ui?: { sourceUrls?: string[] } };
    const sourceUrls = Array.isArray(state.ui?.sourceUrls) ? state.ui.sourceUrls : [];
    const translations = await bibleService.refreshAvailableTranslations(forceRefresh, sourceUrls);
    return {
      translations,
      extraLanguages: bibleService.getExtraLanguages(),
    };
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
    removeLoadedTranslations: (state, action: PayloadAction<string[]>) => {
      const blocked = new Set(
        action.payload
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
      );

      if (blocked.size === 0) {
        return;
      }

      for (const id of Object.keys(state.loadedTranslations)) {
        if (blocked.has(id)) {
          delete state.loadedTranslations[id];
        }
      }
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
        if (!duplicate.searchResults) {
          Object.assign(duplicate, updateSearchTab(duplicate, searchResults, action.payload.translationIds));
        }
        state.activeTabId = duplicate.id;
        return;
      }

      const searchTab = createSearchTab(searchResults, action.payload.translationIds);
      state.tabs.push(searchTab);
      state.activeTabId = searchTab.id;
    },
    createDeferredSearchTab: (state, action: PayloadAction<{ query: string; translationIds: string[] }>) => {
      const deferredTab = createDeferredSearchPanelTab(action.payload.query, action.payload.translationIds);
      if (!deferredTab) {
        return;
      }

      const duplicate = state.tabs.find(
        (tab) =>
          tab.type === 'search' &&
          tab.title.toLowerCase() === deferredTab.title.toLowerCase()
      );

      if (duplicate) {
        duplicate.translationIds = action.payload.translationIds;
        return;
      }

      state.tabs.push(deferredTab);
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
    setActiveTab: (state, action: PayloadAction<string | {
      tabId: string;
      verseContext?: { book: string; chapter: number; verse: number } | null;
    }>) => {
      const tabId = typeof action.payload === 'string' ? action.payload : action.payload.tabId;
      const verseContext = typeof action.payload === 'string' ? undefined : action.payload.verseContext;
      const target = state.tabs.find((tab) => tab.id === tabId);
      if (!target) {
        return;
      }

      if (target.type === 'translations' || target.type === 'resources' || target.type === 'links') {
        state.lastVersePanelType = target.type;
      }

      state.activeTabId = tabId;

      // When a verse panel becomes visible, bind it to the selected verse (or clear).
      if (isVersePanelTab(target) && verseContext !== undefined) {
        applyVerseContextToTab(target, verseContext, Date.now());
      }
    },
    closeTab: (state, action: PayloadAction<string | {
      tabId: string;
      verseContext?: { book: string; chapter: number; verse: number } | null;
    }>) => {
      const tabId = typeof action.payload === 'string' ? action.payload : action.payload.tabId;
      const verseContext = typeof action.payload === 'string' ? undefined : action.payload.verseContext;
      const closeIndex = state.tabs.findIndex((tab) => tab.id === tabId);
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

      const fallbackTab = state.tabs[fallbackIndex];
      if (fallbackTab.type === 'translations' || fallbackTab.type === 'resources' || fallbackTab.type === 'links') {
        state.lastVersePanelType = fallbackTab.type;
        if (verseContext !== undefined) {
          applyVerseContextToTab(fallbackTab, verseContext, Date.now());
        }
      }
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
    updateActiveVerseTabContext: (state, action: PayloadAction<{ book: string; chapter: number; verse: number }>) => {
      // Only the visible verse tab should react; inactive tabs keep their last rendered context
      // until they are selected (see setActiveTab verseContext sync).
      applyVerseContextToActiveVerseTab(state, action.payload);
    },
    clearVerseTabContexts: (state) => {
      applyVerseContextToVerseTabs(state, null);
    },
    openVerseTabs: (state, action: PayloadAction<{ book: string; chapter: number; verse: number; hasResources: boolean }>) => {
      const { book, chapter, verse, hasResources } = action.payload;
      const now = Date.now();
      const verseContext = { book, chapter, verse };

      const preferredType = hasResources
        ? state.lastVersePanelType
        : state.lastVersePanelType === 'resources'
          ? 'translations'
          : state.lastVersePanelType;

      // Ensure tabs exist, but only bind verseContext on the tab that will be shown.
      const translationsTab = upsertVerseTab(
        state,
        'translations',
        preferredType === 'translations' ? verseContext : null,
        now
      );
      let resourcesTab: PanelTab | null = null;

      if (hasResources) {
        resourcesTab = upsertVerseTab(
          state,
          'resources',
          preferredType === 'resources' ? verseContext : null,
          now
        );
      } else {
        state.tabs = state.tabs.filter((tab) => tab.type !== 'resources');
      }

      const linksTab = upsertVerseTab(
        state,
        'links',
        preferredType === 'links' ? verseContext : null,
        now
      );

      if (preferredType === 'resources' && resourcesTab) {
        state.activeTabId = resourcesTab.id;
      } else if (preferredType === 'links') {
        state.activeTabId = linksTab.id;
      } else {
        state.activeTabId = translationsTab.id;
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
        state.availableTranslations = action.payload.translations;
        state.extraLanguages = action.payload.extraLanguages;
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
        state.loadedTranslations = {
          [action.meta.arg]: action.payload
        };
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
        state.loadedTranslations = action.payload;

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
  removeLoadedTranslations,
  setError,
  runSearch,
  runSearchInNewTab,
  createDeferredSearchTab,
  runSearchInTab,
  setActiveTab,
  closeTab,
  setPanelDetached,
  clearSearch,
  updateActiveVerseTabContext,
  clearVerseTabContexts,
  openVerseTabs
} = bibleSlice.actions;

export default bibleSlice.reducer;
