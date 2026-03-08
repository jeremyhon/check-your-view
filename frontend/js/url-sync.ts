import { buildShareUrlFromState } from "./pose-state";
import type { ViewState } from "./types";

type UrlSyncControllerOptions = {
  state: ViewState;
  throttleMs?: number;
  debounceMs?: number;
  preservedQueryKeys?: string[];
};

export type UrlSyncController = {
  buildShareUrl: () => string;
  syncNow: () => void;
  syncThrottled: () => void;
  syncDebounced: () => void;
  dispose: () => void;
};

const DEFAULT_THROTTLE_MS = 100;
const DEFAULT_DEBOUNCE_MS = 180;

export function createUrlSyncController({
  state,
  throttleMs = DEFAULT_THROTTLE_MS,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  preservedQueryKeys = ["debug"],
}: UrlSyncControllerOptions): UrlSyncController {
  let throttledSyncTimerId: number | null = null;
  let debouncedSyncTimerId: number | null = null;

  function clearThrottledTimer(): void {
    if (throttledSyncTimerId !== null) {
      window.clearTimeout(throttledSyncTimerId);
      throttledSyncTimerId = null;
    }
  }

  function clearDebouncedTimer(): void {
    if (debouncedSyncTimerId !== null) {
      window.clearTimeout(debouncedSyncTimerId);
      debouncedSyncTimerId = null;
    }
  }

  function buildShareUrl(): string {
    const nextUrl = new URL(buildShareUrlFromState(state, window.location));
    const currentParams = new URLSearchParams(window.location.search);
    preservedQueryKeys.forEach((key) => {
      const value = currentParams.get(key);
      if (value !== null) {
        nextUrl.searchParams.set(key, value);
      }
    });
    return nextUrl.toString();
  }

  function syncNow(): void {
    clearThrottledTimer();
    clearDebouncedTimer();
    window.history.replaceState({}, "", buildShareUrl());
  }

  function syncThrottled(): void {
    if (throttledSyncTimerId !== null) {
      return;
    }
    throttledSyncTimerId = window.setTimeout(() => {
      throttledSyncTimerId = null;
      window.history.replaceState({}, "", buildShareUrl());
    }, throttleMs);
  }

  function syncDebounced(): void {
    clearDebouncedTimer();
    debouncedSyncTimerId = window.setTimeout(() => {
      debouncedSyncTimerId = null;
      window.history.replaceState({}, "", buildShareUrl());
    }, debounceMs);
  }

  function dispose(): void {
    clearThrottledTimer();
    clearDebouncedTimer();
  }

  return {
    buildShareUrl,
    syncNow,
    syncThrottled,
    syncDebounced,
    dispose,
  };
}
