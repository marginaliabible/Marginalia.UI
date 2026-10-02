import { useCallback, useEffect, useRef, useState } from 'react';
import type { FederatedProvider } from '../models/bible';
import { fetchCloudSyncStatus, type CloudSyncStatus } from '../services/cloudControlService';

const MIN_POLL_MS = 3_000;
const MAX_POLL_MS = 60_000;
const ERROR_RETRY_MS = 60_000;

interface UseCloudSyncStatusOptions {
  userId: string | null | undefined;
  providers: FederatedProvider[];
  enabled: boolean;
}

function clampPollDelay(pollAfterMs: unknown): number {
  const delay = typeof pollAfterMs === 'number' && Number.isFinite(pollAfterMs) ? pollAfterMs : MAX_POLL_MS;
  return Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, delay));
}

export function useCloudSyncStatus({ userId, providers, enabled }: UseCloudSyncStatusOptions) {
  const [latest, setLatest] = useState<{ userId: string; status: CloudSyncStatus; fetchId: number } | null>(null);
  const pollNowRef = useRef<() => void>(() => {});

  const requestUserId = String(userId ?? '').trim();
  const providersKey = Array.from(new Set(providers)).sort().join(',');
  const active = enabled && requestUserId.length > 0 && providersKey.length > 0;

  useEffect(() => {
    if (!active) {
      return;
    }

    const requestProviders = providersKey.split(',') as FederatedProvider[];
    let timer: number | undefined;
    let controller: AbortController | null = null;
    let disposed = false;

    const clearTimer = () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
    };

    const schedule = (delayMs: number) => {
      clearTimer();
      if (disposed || document.visibilityState === 'hidden') {
        return;
      }

      timer = window.setTimeout(() => {
        timer = undefined;
        void poll();
      }, delayMs);
    };

    const poll = async () => {
      clearTimer();
      controller?.abort();
      if (disposed || document.visibilityState === 'hidden') {
        return;
      }

      const current = new AbortController();
      controller = current;
      try {
        const next = await fetchCloudSyncStatus({
          userId: requestUserId,
          providers: requestProviders,
          signal: current.signal,
        });
        if (current.signal.aborted || !next) {
          return;
        }

        setLatest((previous) => ({ userId: requestUserId, status: next, fetchId: (previous?.fetchId ?? 0) + 1 }));
        schedule(clampPollDelay(next.pollAfterMs));
      } catch {
        if (!current.signal.aborted) {
          schedule(ERROR_RETRY_MS);
        }
      } finally {
        if (controller === current) {
          controller = null;
        }
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        clearTimer();
        controller?.abort();
        return;
      }

      void poll();
    };

    pollNowRef.current = () => {
      void poll();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    void poll();

    return () => {
      disposed = true;
      pollNowRef.current = () => {};
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearTimer();
      controller?.abort();
    };
  }, [active, providersKey, requestUserId]);

  const refresh = useCallback(() => {
    pollNowRef.current();
  }, []);

  // Kept while disabled so reopening shows the last known state until the first poll lands.
  const status = latest?.userId === requestUserId ? latest.status : null;
  // Increments on every successful fetch, so callers can tell a fresh poll from the kept status.
  const fetchId = latest?.fetchId ?? 0;
  return { status, fetchId, refresh };
}
