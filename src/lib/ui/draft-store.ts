"use client";
import { useUIActions } from "@/components/ui-context";
import { useStoredJson,writeStoredJson } from "@/lib/use-stored-json";

export function useDraft<T>(kind: string, id: string, fallback: T) {
  const { scope } = useUIActions();
  return useStoredJson<T>(`tacos.draft.v1.${scope}.${kind}.${id}`, fallback);
}
export function persistDraft<T>(scope: string, kind: string, id: string, value: T) {
  writeStoredJson(`tacos.draft.v1.${scope}.${kind}.${id}`,value);
}
