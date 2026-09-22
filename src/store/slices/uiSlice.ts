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
  selectedVerseTranslationId: string | null;
  selectedVerses: number[];
  selectionAnchorVerse: number | null;
  searchTerm: string;
  selectedLanguages: string[];
  sourceUrls: string[];
  resourceHiddenTags: string[];
  pdfViewer: {
    isOpen: boolean;
    kind: 'pdf' | 'markup';
    sourceUrl: string | null;
    title: string | null;
    page: number;
    matchRaw: string | null;
    /** Bumps on every open so re-clicking the same page still triggers scroll-into-view. */
    focusNonce: number;
  };
  theme: ThemePreference;
  ready: boolean;
  // Email of the first cloud account ever connected; internal reference only.
  userId: string | null;
}

const initialState: UiState = {
  selectedTranslationId: 'KJV',
  selectedTranslationIds: ['KJV'],
  translationRecords: [{ id: 'KJV', starred: true }],
  selectedBook: null,
  selectedChapter: 1,
  selectedVerseTranslationId: null,
  selectedVerses: [],
  selectionAnchorVerse: null,
  searchTerm: '',
  selectedLanguages: [],
  sourceUrls: [],
  resourceHiddenTags: [],
  pdfViewer: {
    isOpen: false,
    kind: 'pdf',
    sourceUrl: null,
    title: null,
    page: 1,
    matchRaw: null,
    focusNonce: 0,
  },
  theme: 'light',
  ready: false,
  userId: null
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
    setVerseSelection: (
      state,
      action: PayloadAction<{
        translationId: string | null;
        verses: number[];
        anchorVerse?: number | null;
      }>
    ) => {
      const translationId = action.payload.translationId?.trim() ?? '';
      const normalizedVerses = Array.from(new Set(
        action.payload.verses
          .filter((verse): verse is number => Number.isInteger(verse) && verse > 0)
          .map((verse) => Number(verse))
      )).sort((a, b) => a - b);

      if (!translationId || normalizedVerses.length === 0) {
        state.selectedVerseTranslationId = null;
        state.selectedVerses = [];
        state.selectionAnchorVerse = null;
        return;
      }

      state.selectedVerseTranslationId = translationId;
      state.selectedVerses = normalizedVerses;
      state.selectionAnchorVerse = action.payload.anchorVerse ?? normalizedVerses[0];
    },
    clearVerseSelection: (state) => {
      state.selectedVerseTranslationId = null;
      state.selectedVerses = [];
      state.selectionAnchorVerse = null;
    },
    setSearchTerm: (state, action: PayloadAction<string>) => {
      state.searchTerm = action.payload;
    },
    setSelectedLanguages: (state, action: PayloadAction<string[]>) => {
      state.selectedLanguages = action.payload;
    },
    setSourceUrls: (state, action: PayloadAction<string[]>) => {
      state.sourceUrls = Array.from(new Set(
        action.payload
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
      ));
    },
    setResourceHiddenTags: (state, action: PayloadAction<string[]>) => {
      state.resourceHiddenTags = Array.from(new Set(
        action.payload
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
      ));
    },
    openPdfViewer: (
      state,
      action: PayloadAction<{
        sourceUrl: string;
        title?: string;
        page?: number;
        matchRaw?: string | null;
        kind?: 'pdf' | 'markup';
      }>
    ) => {
      const nextPage = typeof action.payload.page === 'number' && Number.isFinite(action.payload.page)
        ? Math.max(1, Math.floor(action.payload.page))
        : 1;

      state.pdfViewer = {
        isOpen: true,
        kind: action.payload.kind === 'markup' ? 'markup' : 'pdf',
        sourceUrl: action.payload.sourceUrl,
        title: action.payload.title?.trim() || null,
        page: nextPage,
        matchRaw: action.payload.matchRaw?.trim() || null,
        focusNonce: (state.pdfViewer.focusNonce || 0) + 1,
      };
    },
    openDocumentViewer: (
      state,
      action: PayloadAction<{
        sourceUrl: string;
        title?: string;
        page?: number;
        matchRaw?: string | null;
        kind?: 'pdf' | 'markup';
      }>
    ) => {
      const nextPage = typeof action.payload.page === 'number' && Number.isFinite(action.payload.page)
        ? Math.max(1, Math.floor(action.payload.page))
        : 1;

      state.pdfViewer = {
        isOpen: true,
        kind: action.payload.kind === 'markup' ? 'markup' : 'pdf',
        sourceUrl: action.payload.sourceUrl,
        title: action.payload.title?.trim() || null,
        page: nextPage,
        matchRaw: action.payload.matchRaw?.trim() || null,
        focusNonce: (state.pdfViewer.focusNonce || 0) + 1,
      };
    },
    closePdfViewer: (state) => {
      state.pdfViewer.isOpen = false;
    },
    closeDocumentViewer: (state) => {
      state.pdfViewer.isOpen = false;
    },
    setPdfViewerPage: (state, action: PayloadAction<number>) => {
      if (!state.pdfViewer.isOpen) {
        return;
      }

      const normalizedPage = Math.max(1, Math.floor(action.payload));
      state.pdfViewer.page = normalizedPage;
    },
    toggleResourceHiddenTag: (state, action: PayloadAction<string>) => {
      const tag = action.payload.trim();
      if (!tag) {
        return;
      }

      if (state.resourceHiddenTags.includes(tag)) {
        state.resourceHiddenTags = state.resourceHiddenTags.filter((entry) => entry !== tag);
        return;
      }

      state.resourceHiddenTags.push(tag);
    },
    addSourceUrl: (state, action: PayloadAction<string>) => {
      const next = action.payload.trim();
      if (!next || state.sourceUrls.includes(next)) {
        return;
      }

      state.sourceUrls.push(next);
    },
    removeSourceUrl: (state, action: PayloadAction<string>) => {
      const target = action.payload.trim();
      state.sourceUrls = state.sourceUrls.filter((entry) => entry !== target);
    },
    removeTranslationsByIds: (state, action: PayloadAction<string[]>) => {
      const blocked = new Set(
        action.payload
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0 && entry !== 'KJV')
      );

      if (blocked.size === 0) {
        return;
      }

      state.translationRecords = state.translationRecords.filter((record) => !blocked.has(record.id));
      state.selectedTranslationIds = state.selectedTranslationIds.filter((id) => !blocked.has(id));

      if (state.translationRecords.length === 0) {
        state.translationRecords = [{ id: 'KJV', starred: true }];
      }

      if (!state.translationRecords.some((record) => record.starred)) {
        state.translationRecords[0].starred = true;
      }

      if (state.selectedTranslationIds.length === 0) {
        state.selectedTranslationIds = state.translationRecords.map((record) => record.id);
      }

      if (!state.selectedTranslationIds.includes(state.selectedTranslationId)) {
        state.selectedTranslationId = state.selectedTranslationIds[0] ?? state.translationRecords[0]?.id ?? 'KJV';
      }

      if (state.selectedVerseTranslationId && blocked.has(state.selectedVerseTranslationId)) {
        state.selectedVerseTranslationId = null;
        state.selectedVerses = [];
        state.selectionAnchorVerse = null;
      }
    },
    setTheme: (state, action: PayloadAction<ThemePreference>) => {
      state.theme = action.payload;
    },
    setUserId: (state, action: PayloadAction<string>) => {
      if (!state.userId) {
        state.userId = action.payload;
      }
    },
    setReady: (state, action: PayloadAction<boolean>) => {
      state.ready = action.payload;
    },
    restoreState: (state, action: PayloadAction<Partial<UiState>>) => {
      // A user ID, once established, must never be replaced by a restore (local or cloud-originated).
      const nextUserId = state.userId || action.payload.userId || null;
      const next = {
        ...state,
        ...action.payload,
        userId: nextUserId,
      };
      if (next.pdfViewer && next.pdfViewer.kind !== 'markup' && next.pdfViewer.kind !== 'pdf') {
        next.pdfViewer = { ...next.pdfViewer, kind: 'pdf' };
      }
      if (next.pdfViewer && typeof next.pdfViewer.focusNonce !== 'number') {
        next.pdfViewer = { ...next.pdfViewer, focusNonce: 0 };
      }
      return next;
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
  setVerseSelection,
  clearVerseSelection,
  setSearchTerm,
  setSelectedLanguages,
  setSourceUrls,
  setResourceHiddenTags,
  openPdfViewer,
  openDocumentViewer,
  closePdfViewer,
  closeDocumentViewer,
  setPdfViewerPage,
  toggleResourceHiddenTag,
  addSourceUrl,
  removeSourceUrl,
  removeTranslationsByIds,
  setTheme,
  setUserId,
  setReady,
  restoreState,
  setTranslationRecords,
  addTranslationRecord,
  removeTranslationRecord,
  toggleStarTranslation,
  reorderTranslations
} = uiSlice.actions;

export default uiSlice.reducer;
