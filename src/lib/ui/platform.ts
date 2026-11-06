"use client";
import { useSyncExternalStore } from "react";
const subscribe = () => () => {};
export function usePrimaryModifier() {
  return useSyncExternalStore(
    subscribe,
    () => (/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+"),
    () => "Ctrl+",
  );
}
