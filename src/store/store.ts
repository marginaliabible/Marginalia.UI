import { configureStore } from '@reduxjs/toolkit';
import bibleReducer from './slices/bibleSlice';
import uiReducer from './slices/uiSlice';

export const store = configureStore({
  reducer: {
    bible: bibleReducer,
    ui: uiReducer
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      // Keep dev safety checks on, but avoid noisy warnings for large startup state.
      serializableCheck: { warnAfter: 128 },
      immutableCheck: { warnAfter: 128 }
    })
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
