import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit';
import type { BibleData, BibleTranslationMeta, SearchResultSet } from '../../models/bible';
import { bibleService } from '../../services/bibleService';

interface BibleState {
  availableTranslations: BibleTranslationMeta[];
  currentBible: BibleData | null;
  isLoading: boolean;
  error: string | null;
  searchResults: SearchResultSet | null;
}

const initialState: BibleState = {
  availableTranslations: [{
    id: 'KJV',
    label: 'KJV (King James Version)',
    source: 'data/bibles/KJV.json',
    isLocal: true,
    language: 'en'
  }],
  currentBible: null,
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
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
    runSearch: (state, action: PayloadAction<string>) => {
      const query = action.payload.trim();
      if (!state.currentBible || !query) {
        state.searchResults = null;
        return;
      }

      const result = bibleService.runSearch(state.currentBible, query);
      state.searchResults = result;
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
        state.currentBible = action.payload;
        state.isLoading = false;
      })
      .addCase(loadTranslation.rejected, (state, action) => {
        state.error = action.error.message || 'Failed to load translation';
        state.isLoading = false;
      });
  }
});

export const {
  setAvailableTranslations,
  setCurrentBible,
  setError,
  runSearch,
  clearSearch
} = bibleSlice.actions;

export default bibleSlice.reducer;
