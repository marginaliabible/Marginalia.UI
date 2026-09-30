import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TranslationRecord } from '../models/bible';
import type { SubscriptionChanges, SubscriptionsBinding } from '../models/subscription';
import type { SubscriptionLibrary } from '../services/subscriptionCatalogService';
import { stableStringify } from '../services/cloudConfigMerge';
import {
  normalizeDisabledSourceItems,
  normalizeResourceTagOverrides,
  parseSourceItemKey,
  typeItemKey,
  type ResourceTagOverride,
  type ResourceTagOverrides,
  type SubscriptionDocumentType,
} from '../utils/sourceSubscriptions';

export interface SubscriptionStagingState {
  disconnected: string[];
  disabled: string[];
  overrides: ResourceTagOverrides;
}

export interface StarredTranslationTarget {
  libraryKey: string;
  type: SubscriptionDocumentType;
  documentKey: string;
}

const EMPTY_BINDING_STATE: SubscriptionStagingState = { disconnected: [], disabled: [], overrides: {} };

function baselineFrom(binding: SubscriptionsBinding | undefined): SubscriptionStagingState {
  if (!binding) {
    return EMPTY_BINDING_STATE;
  }

  return {
    disconnected: [],
    disabled: normalizeDisabledSourceItems(binding.disabledSourceItems),
    overrides: normalizeResourceTagOverrides(binding.resourceTagOverrides),
  };
}

/**
 * Returns the first starred translation row to reveal when Apply would leave no starred translation
 * enabled, or null when at least one stays enabled. Starred ids missing from the catalog count as
 * enabled (their library may simply not have loaded).
 */
export function findStarredTranslationBlock(
  libraries: SubscriptionLibrary[],
  translationRecords: TranslationRecord[],
  staging: SubscriptionStagingState
): StarredTranslationTarget | null {
  const starredIds = translationRecords.filter((record) => record.starred).map((record) => record.id);
  if (starredIds.length === 0) {
    return null;
  }

  const disconnected = new Set(staging.disconnected);
  const disabled = new Set(staging.disabled);
  const disabledIds = new Set(
    staging.disabled
      .map((key) => parseSourceItemKey(key))
      .filter((parsed) => parsed?.kind === 'translation')
      .map((parsed) => parsed!.rest)
  );

  let firstBlocked: StarredTranslationTarget | null = null;
  for (const id of starredIds) {
    let found = false;
    for (const library of libraries) {
      const document = library.types.translation?.find((entry) => entry.itemId === id);
      if (!document) {
        continue;
      }

      found = true;
      const blocked = disconnected.has(library.key)
        || disabled.has(typeItemKey(library.key, 'translation'))
        || disabledIds.has(id);
      if (!blocked) {
        return null;
      }

      firstBlocked ??= { libraryKey: library.key, type: 'translation', documentKey: document.key };
    }

    if (!found) {
      return null;
    }
  }

  return firstBlocked;
}

export function useSubscriptionStaging(binding: SubscriptionsBinding | undefined) {
  const baseline = useMemo(
    () => baselineFrom(binding),
    // Rebuilt only when the persisted values change, not on every new array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stableStringify(binding?.disabledSourceItems ?? []), stableStringify(binding?.resourceTagOverrides ?? {}), Boolean(binding)]
  );
  const [staging, setStaging] = useState<SubscriptionStagingState>(baseline);

  useEffect(() => {
    setStaging(baseline);
  }, [baseline]);

  const sourceUrls = binding?.sourceUrls;
  useEffect(() => {
    // A disconnect that went through leaves nothing to stage.
    setStaging((current) => {
      const stillConnected = current.disconnected.filter((key) => sourceUrls?.includes(key));
      return stillConnected.length === current.disconnected.length ? current : { ...current, disconnected: stillConnected };
    });
  }, [sourceUrls]);

  const isDirty = staging.disconnected.length > 0
    || stableStringify(staging.disabled) !== stableStringify(baseline.disabled)
    || stableStringify(staging.overrides) !== stableStringify(baseline.overrides);

  const toggleDisconnect = useCallback((libraryKey: string) => {
    setStaging((current) => ({
      ...current,
      disconnected: current.disconnected.includes(libraryKey)
        ? current.disconnected.filter((key) => key !== libraryKey)
        : [...current.disconnected, libraryKey],
    }));
  }, []);

  const toggleDisabled = useCallback((itemKey: string) => {
    setStaging((current) => ({
      ...current,
      disabled: current.disabled.includes(itemKey)
        ? current.disabled.filter((key) => key !== itemKey)
        : [...current.disabled, itemKey].sort(),
    }));
  }, []);

  const setTagOverride = useCallback((resourceKey: string, override: ResourceTagOverride | null) => {
    setStaging((current) => {
      const overrides = { ...current.overrides };
      if (override) {
        overrides[resourceKey] = override;
      } else {
        delete overrides[resourceKey];
      }
      return { ...current, overrides: normalizeResourceTagOverrides(overrides) };
    });
  }, []);

  const reset = useCallback(() => {
    setStaging(baseline);
  }, [baseline]);

  const toChanges = useCallback((): SubscriptionChanges => ({
    disconnectLibraryKeys: [...staging.disconnected],
    disabledSourceItems: [...staging.disabled],
    resourceTagOverrides: { ...staging.overrides },
  }), [staging]);

  return {
    staging,
    isDirty,
    toggleDisconnect,
    toggleDisabled,
    setTagOverride,
    reset,
    toChanges,
  };
}

export type SubscriptionStaging = ReturnType<typeof useSubscriptionStaging>;
