import { configureStore } from '@reduxjs/toolkit';
import bibleReducer from './slices/bibleSlice';
import uiReducer from './slices/uiSlice';

export const store = configureStore({
  reducer: {
    bible: bibleReducer,
    ui: uiReducer
  }
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
