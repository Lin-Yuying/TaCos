"use client";
import { useUI } from "@/components/ui-context";
import { useStoredJson } from "@/lib/use-stored-json";

export function useDraft<T>(kind: string, id: string, fallback: T) {
  const { scope } = useUI();
  return useStoredJson<T>(`tacos.draft.v1.${scope}.${kind}.${id}`, fallback);
}
export function persistDraft<T>(scope: string, kind: string, id: string, value: T) {
  try { localStorage.setItem(`tacos.draft.v1.${scope}.${kind}.${id}`, JSON.stringify(value)); }
  catch { window.dispatchEvent(new Event("tacos:storage-error")); }
}
