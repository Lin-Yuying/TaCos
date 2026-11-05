"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

// Per-browser state that the server never renders. Falls back to memory when storage is blocked.
const listeners = new Map<string, Set<() => void>>();
const memory = new Map<string, string>();

function read(key: string): string | null {
  if (memory.has(key)) return memory.get(key) ?? null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    /* storage unavailable: this page view starts empty */
  }
  if (raw !== null) memory.set(key, raw);
  return raw;
}

export function useStoredJson<T>(key: string, fallback: T): [T, (next: T) => void] {
  const subscribe = useCallback(
    (listener: () => void) => {
      const set = listeners.get(key) ?? new Set();
      listeners.set(key, set);
      set.add(listener);
      return () => set.delete(listener);
    },
    [key]
  );
  const raw = useSyncExternalStore(subscribe, () => read(key), () => null);
  const value = useMemo(() => {
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }, [raw, fallback]);
  const set = useCallback(
    (next: T) => {
      const text = JSON.stringify(next);
      memory.set(key, text);
      try {
        window.localStorage.setItem(key, text);
      } catch {
        /* storage unavailable: it still applies for this page view */
      }
      for (const listener of listeners.get(key) ?? []) listener();
    },
    [key]
  );
  return [value, set];
}
