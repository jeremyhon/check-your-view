import { buildShareUrlFromState } from "./pose-state";
import type { ViewState } from "./types";

type UrlSyncControllerOptions = {
  state: ViewState;
  throttleMs?: number;
  preservedQueryKeys?: string[];
};

export type UrlSyncController = {
  buildShareUrl: () => string;
  syncNow: () => void;
  syncThrottled: () => void;
  dispose: () => void;
};

const DEFAULT_THROTTLE_MS = 100;

export function createUrlSyncController({
  state,
  throttleMs = DEFAULT_THROTTLE_MS,
  preservedQueryKeys = ["debug"],
}: UrlSyncControllerOptions): UrlSyncController {
  let syncTimerId: number | null = null;

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
    if (syncTimerId !== null) {
      window.clearTimeout(syncTimerId);
      syncTimerId = null;
    }
    window.history.replaceState({}, "", buildShareUrl());
  }

  function syncThrottled(): void {
    if (syncTimerId !== null) {
      return;
    }
    syncTimerId = window.setTimeout(() => {
      syncTimerId = null;
      window.history.replaceState({}, "", buildShareUrl());
    }, throttleMs);
  }

  function dispose(): void {
    if (syncTimerId !== null) {
      window.clearTimeout(syncTimerId);
      syncTimerId = null;
    }
  }

  return {
    buildShareUrl,
    syncNow,
    syncThrottled,
    dispose,
  };
}
