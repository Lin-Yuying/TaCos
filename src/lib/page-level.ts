// No database here: client components read these. A reader of a shared document holds one
// level; each level includes the ones before it.
export const PAGE_LEVELS = ["view", "comment", "edit"] as const;
export type PageLevel = (typeof PAGE_LEVELS)[number];

export function isPageLevel(value: string): value is PageLevel {
  return (PAGE_LEVELS as readonly string[]).includes(value);
}

export function levelAllows(level: PageLevel | null, needed: PageLevel): boolean {
  if (!level) return false;
  return PAGE_LEVELS.indexOf(level) >= PAGE_LEVELS.indexOf(needed);
}
