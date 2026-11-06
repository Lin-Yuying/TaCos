"use client";

import { useCallback } from "react";
import type { SearchHit } from "@/lib/search";
import type { SearchGroup } from "@/lib/search-query";
import { useStoredJson } from "./use-stored-json";

export type RecentSearch = { text: string; group: SearchGroup; at: string };
export type RecentItem = Pick<
  SearchHit,
  "kind" | "id" | "openId" | "title" | "ref" | "target" | "href" | "context"
> & { at: string };

const MAX = 8;

/**
 * Per-person, per-workspace history. The palette and the search page share the keys,
 * so a query started in one is offered in the other.
 */
export function useSearchRecents(scope: string) {
  const [searches, setSearches] = useStoredJson<RecentSearch[]>(
    `tacos.search.recent.queries.${scope}`,
    []
  );
  const [items, setItems] = useStoredJson<RecentItem[]>(
    `tacos.search.recent.items.${scope}`,
    []
  );

  const rememberSearch = useCallback(
    (text: string, group: SearchGroup) => {
      const query = text.trim();
      if (!query) return;
      setSearches((previous) => [
        { text: query, group, at: new Date().toISOString() },
        ...previous.filter((entry) => entry.text !== query || entry.group !== group),
      ].slice(0, MAX));
    },
    [setSearches]
  );

  const rememberItem = useCallback(
    (hit: SearchHit) => {
      setItems((previous) => [
        {
          kind: hit.kind,
          id: hit.id,
          openId: hit.openId,
          title: hit.title,
          ref: hit.ref,
          target: hit.target,
          href: hit.href,
          context: hit.context,
          at: new Date().toISOString(),
        },
        ...previous.filter((entry) => entry.kind !== hit.kind || entry.id !== hit.id),
      ].slice(0, MAX));
    },
    [setItems]
  );

  const clearSearches = useCallback(() => setSearches([]), [setSearches]);
  const clearItems = useCallback(() => setItems([]), [setItems]);

  return {
    searches,
    items,
    rememberSearch,
    rememberItem,
    clearSearches,
    clearItems,
  };
}
