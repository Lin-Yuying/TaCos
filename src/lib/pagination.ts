import { TacosError } from "./issues";

/**
 * Keyset cursors for the list tools and routes. A cursor names the last row's stable
 * sort key and id, so deleting that row between pages still resumes at the next one.
 */
export type ListCursor = { k: string; id: string };

export const PAGE_DEFAULT = 50;
export const PAGE_MAX = 200;

export function pageLimit(value: number | undefined, fallback = PAGE_DEFAULT): number {
  return Math.min(PAGE_MAX, Math.max(1, Math.trunc(value ?? fallback)));
}

export function encodeListCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeListCursor(raw: string): ListCursor {
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as ListCursor;
    if (typeof value.k !== "string" || typeof value.id !== "string") throw new Error();
    return value;
  } catch {
    throw new TacosError(
      "Invalid cursor. Use the nextCursor value returned by the previous call.",
      400
    );
  }
}

// Ascending keyset: rows after the cursor have a larger key, or the same key and a
// larger id.
export function paginateList<T>(
  items: T[],
  limit: number,
  cursor: string | undefined,
  key: (item: T) => ListCursor,
  compare: (a: T, b: T) => number
): { page: T[]; nextCursor: string | null } {
  const sorted = [...items].sort(compare);
  const after = cursor ? decodeListCursor(cursor) : null;
  const rest = after
    ? sorted.filter((item) => {
        const current = key(item);
        return current.k > after.k || (current.k === after.k && current.id > after.id);
      })
    : sorted;
  const page = rest.slice(0, limit);
  const last = page.at(-1);
  return {
    page,
    nextCursor: rest.length > limit && last ? encodeListCursor(key(last)) : null,
  };
}

// Descending keyset for newest-first lists: rows after the cursor have a smaller key,
// or the same key and a larger id.
export function paginateListDesc<T>(
  items: T[],
  limit: number,
  cursor: string | undefined,
  key: (item: T) => ListCursor,
  compare: (a: T, b: T) => number
): { page: T[]; nextCursor: string | null } {
  const sorted = [...items].sort(compare);
  const after = cursor ? decodeListCursor(cursor) : null;
  const rest = after
    ? sorted.filter((item) => {
        const current = key(item);
        return current.k < after.k || (current.k === after.k && current.id > after.id);
      })
    : sorted;
  const page = rest.slice(0, limit);
  const last = page.at(-1);
  return {
    page,
    nextCursor: rest.length > limit && last ? encodeListCursor(key(last)) : null,
  };
}
