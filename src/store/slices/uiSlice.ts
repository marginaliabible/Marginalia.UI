import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { ThemePreference } from '../../models/bible';

interface UiState {
  selectedTranslationId: string;
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
    }
  }
});

export const {
  setSelectedTranslationId,
  setSelectedBook,
  setSelectedChapter,
  setFocusVerse,
  setSearchTerm,
  setSelectedLanguages,
  setTheme,
  setReady,
  restoreState
} = uiSlice.actions;

export default uiSlice.reducer;
