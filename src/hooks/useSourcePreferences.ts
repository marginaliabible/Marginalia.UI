import { useMemo } from 'react';
import { useAppSelector } from '../store/hooks';
import { EMPTY_SOURCE_PREFERENCES, type SourcePreferences } from '../utils/sourceSubscriptions';

export function useSourcePreferences(): SourcePreferences {
  const disabledSourceItems = useAppSelector((state) => state.ui.disabledSourceItems);
  const resourceTagOverrides = useAppSelector((state) => state.ui.resourceTagOverrides);

  return useMemo(() => {
    const disabled = Array.isArray(disabledSourceItems) ? disabledSourceItems : [];
    const overrides = resourceTagOverrides ?? {};
    if (disabled.length === 0 && Object.keys(overrides).length === 0) {
      return EMPTY_SOURCE_PREFERENCES;
    }
    return { disabledSourceItems: disabled, resourceTagOverrides: overrides };
  }, [disabledSourceItems, resourceTagOverrides]);
}
