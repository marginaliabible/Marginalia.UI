import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { ThemePreference } from '../../models/bible';

export interface TranslationRecord {
  id: string;
  starred: boolean;
}

interface UiState {
  selectedTranslationId: string;
  selectedTranslationIds: string[];
  translationRecords: TranslationRecord[];
  selectedBook: string | null;
  selectedChapter: number;
  focusVerse: number | null;
  searchTerm: string;
  selectedLanguages: string[];
  theme: ThemePreference;
  ready: boolean;
}

const initialState: UiState = {
  selectedTranslationId: 'KJV',
  selectedTranslationIds: ['KJV'],
  translationRecords: [{ id: 'KJV', starred: true }],
  selectedBook: null,
  selectedChapter: 1,
  focusVerse: null,
  searchTerm: '',
  selectedLanguages: [],
  theme: 'light',
  ready: false
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setSelectedTranslationId: (state, action: PayloadAction<string>) => {
      state.selectedTranslationId = action.payload;
      if (!state.selectedTranslationIds.includes(action.payload)) {
        state.selectedTranslationIds = [action.payload, ...state.selectedTranslationIds];
      }
    },
    setSelectedTranslationIds: (state, action: PayloadAction<string[]>) => {
      const unique = Array.from(new Set(action.payload.filter((entry) => entry.trim().length > 0)));
      state.selectedTranslationIds = unique.length > 0 ? unique : ['KJV'];
      if (!state.selectedTranslationIds.includes(state.selectedTranslationId)) {
        state.selectedTranslationId = state.selectedTranslationIds[0];
      }
    },
    setSelectedBook: (state, action: PayloadAction<string | null>) => {
      state.selectedBook = action.payload;
    },
    setSelectedChapter: (state, action: PayloadAction<number>) => {
      state.selectedChapter = action.payload;
    },
    setFocusVerse: (state, action: PayloadAction<number | null>) => {
      state.focusVerse = action.payload;
    },
    setSearchTerm: (state, action: PayloadAction<string>) => {
      state.searchTerm = action.payload;
    },
    setSelectedLanguages: (state, action: PayloadAction<string[]>) => {
      state.selectedLanguages = action.payload;
    },
    setTheme: (state, action: PayloadAction<ThemePreference>) => {
      state.theme = action.payload;
    },
    setReady: (state, action: PayloadAction<boolean>) => {
      state.ready = action.payload;
    },
    restoreState: (state, action: PayloadAction<Partial<UiState>>) => {
      return {
        ...state,
        ...action.payload
      };
    },
    setTranslationRecords: (state, action: PayloadAction<TranslationRecord[]>) => {
      const records = action.payload
        .filter((r) => r && r.id && r.id.trim().length > 0)
        .map((r) => ({ id: r.id.trim(), starred: Boolean(r.starred) }));
      
      if (records.length === 0) {
        state.translationRecords = [{ id: 'KJV', starred: true }];
      } else {
        state.translationRecords = records;
        if (!state.translationRecords.some((r) => r.starred)) {
          state.translationRecords[0].starred = true;
        }
      }
    },
    addTranslationRecord: (state, action: PayloadAction<string>) => {
      const translationId = action.payload.trim();
      if (!translationId || state.translationRecords.some((r) => r.id === translationId)) {
        return;
      }
      state.translationRecords.push({ id: translationId, starred: false });
    },
    removeTranslationRecord: (state, action: PayloadAction<string>) => {
      const translationId = action.payload.trim();
      const recIndex = state.translationRecords.findIndex((r) => r.id === translationId);
      if (recIndex < 0) {
        return;
      }

      const targetRecord = state.translationRecords[recIndex];
      const starredCount = state.translationRecords.filter((r) => r.starred).length;
      if (targetRecord.starred && starredCount === 1) {
        return;
      }
      state.translationRecords.splice(recIndex, 1);
      
      // Ensure at least one record exists
      if (state.translationRecords.length === 0) {
        state.translationRecords = [{ id: 'KJV', starred: true }];
      }
    },
    toggleStarTranslation: (state, action: PayloadAction<string>) => {
      const translationId = action.payload.trim();
      const recordIndex = state.translationRecords.findIndex((r) => r.id === translationId);
      if (recordIndex < 0) {
        return;
      }

      const record = state.translationRecords[recordIndex];

      // Cannot unstar if it's the last starred
      if (record.starred && state.translationRecords.filter((r) => r.starred).length === 1) {
        return;
      }

      state.translationRecords.splice(recordIndex, 1);

      record.starred = !record.starred;

      if (record.starred) {
        const firstUnstarredIndex = state.translationRecords.findIndex((r) => !r.starred);
        const insertIndex = firstUnstarredIndex === -1 ? state.translationRecords.length : firstUnstarredIndex;
        state.translationRecords.splice(insertIndex, 0, record);
        return;
      }

      const firstUnstarredIndex = state.translationRecords.findIndex((r) => !r.starred);
      const insertIndex = firstUnstarredIndex === -1 ? state.translationRecords.length : firstUnstarredIndex;
      state.translationRecords.splice(insertIndex, 0, record);
    },
    reorderTranslations: (state, action: PayloadAction<{ fromIndex: number; toIndex: number }>) => {
      const { fromIndex, toIndex } = action.payload;
      if (fromIndex < 0 || toIndex < 0 || fromIndex >= state.translationRecords.length || toIndex >= state.translationRecords.length) {
        return;
      }

      if (fromIndex === toIndex) {
        return;
      }

      const fromRecord = state.translationRecords[fromIndex];
      const targetStarState = state.translationRecords[toIndex].starred;

      // Remove and insert
      state.translationRecords.splice(fromIndex, 1);
      fromRecord.starred = targetStarState;
      state.translationRecords.splice(toIndex, 0, fromRecord);

      // Keep at least one starred translation available for main panel rendering.
      if (!state.translationRecords.some((record) => record.starred)) {
        state.translationRecords[0].starred = true;
      }
    }
  }
});

export const {
  setSelectedTranslationId,
  setSelectedTranslationIds,
  setSelectedBook,
  setSelectedChapter,
  setFocusVerse,
  setSearchTerm,
  setSelectedLanguages,
  setTheme,
  setReady,
  restoreState,
  setTranslationRecords,
  addTranslationRecord,
  removeTranslationRecord,
  toggleStarTranslation,
  reorderTranslations
} = uiSlice.actions;

export default uiSlice.reducer;
