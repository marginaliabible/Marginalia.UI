import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit';
import type { BibleData, BibleTranslationMeta, SearchResultSet } from '../../models/bible';
import { bibleService } from '../../services/bibleService';
import { searchIndexService } from '../../services/searchIndexService';

interface BibleState {
  availableTranslations: BibleTranslationMeta[];
  currentBible: BibleData | null;
  loadedTranslations: Record<string, BibleData>;
  isLoading: boolean;
  error: string | null;
  searchResults: SearchResultSet | null;
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
  searchResults: null
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
      const query = action.payload.query.trim();
      if (!query) {
        state.searchResults = null;
        return;
      }

      const metadataById = new Map(
        state.availableTranslations.map((translation) => [translation.id, translation.label] as const)
      );

      let allMatches = action.payload.translationIds.flatMap((translationId) => {
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
        return result.matches.map(
          (match) => ({
            id: `${translationId}-${match.book}-${match.chapter}-${match.verse}`,
            book: match.book,
            chapter: match.chapter,
            verse: match.verse,
            text: match.text,
            translationId,
            translationLabel: label
          })
        );
      });

      // Dedupe by verse location (book, chapter, verse), keeping first occurrence
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
      state.searchResults = {
        query,
        matches: limitedMatches,
        total,
        limited: limitedMatches.length < total
      };
    },
    clearSearch: (state) => {
      state.searchResults = null;
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
  clearSearch
} = bibleSlice.actions;

export default bibleSlice.reducer;
