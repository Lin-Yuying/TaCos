"use client";

import { useCallback, useMemo, useEffect, useRef, useSyncExternalStore, type SetStateAction } from "react";

// Per-browser state that the server never renders. Falls back to memory when storage is blocked.
const listeners = new Map<string, Set<() => void>>();
const memory = new Map<string, string>();
const volatile = new Set<string>();

function read(key: string): string | null {
  if (volatile.has(key)) return memory.get(key) ?? null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
  return raw;
}

export function useStoredJson<T>(key: string, fallback: T): [T, (next: SetStateAction<T>) => void] {
  const fallbackRef = useRef(fallback); useEffect(()=>{fallbackRef.current=fallback;},[fallback]);
  const subscribe = useCallback(
    (listener: () => void) => {
      const set = listeners.get(key) ?? new Set();
      listeners.set(key, set);
      set.add(listener);
      const changed = (event: StorageEvent) => { if(event.key === key) listener(); };
      window.addEventListener("storage", changed);
      return () => {set.delete(listener);window.removeEventListener("storage", changed);};
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
    (next: SetStateAction<T>) => {
      let current = fallbackRef.current;
      try {const raw = read(key); if(raw !== null) current = JSON.parse(raw) as T;} catch { /* use fallback */ }
      const value = typeof next === "function" ? (next as (old:T)=>T)(current) : next;
      const text = JSON.stringify(value);
      memory.set(key, text);
      try {
        window.localStorage.setItem(key, text);
        volatile.delete(key);
      } catch {
        volatile.add(key);
        window.dispatchEvent(new Event("tacos:storage-error"));
      }
      for (const listener of listeners.get(key) ?? []) listener();
    },
    [key]
  );
  return [value, set];
}
