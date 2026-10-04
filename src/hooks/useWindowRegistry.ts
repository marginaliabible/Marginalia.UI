import { useEffect } from 'react';
import { useAppDispatch } from '../store/hooks';
import { setPanelDetached } from '../store/slices/bibleSlice';
import { useChannelWindows, windowChannel } from '../services/windowChannel';
import type { WindowInfo } from '../models/windowMessages';

interface UseWindowRegistryOptions {
  label: string | null;
}

/**
 * Announces this window's label to the other windows. Bible and Document windows hide their docked
 * panel while any panel window exists.
 */
export const useWindowRegistry = ({ label }: UseWindowRegistryOptions): readonly WindowInfo[] => {
  const dispatch = useAppDispatch();
  const windows = useChannelWindows();
  const hasPanelWindow = windows.some((entry) => entry.type === 'panel');

  useEffect(() => {
    windowChannel.update({ label });
  }, [label]);

  useEffect(() => {
    if (!windowChannel.isPanelWindow) {
      dispatch(setPanelDetached(hasPanelWindow));
    }
  }, [dispatch, hasPanelWindow]);

  return windows;
};
