// Identity is independent from title, language, transient filters and reading position.
export function tabIdentity(href: string): string {
  const url = new URL(href, "https://tacos.local");
  const parts = url.pathname.split("/").filter(Boolean);
  const [workspace, kind, id] = parts;
  if (kind === "docs" && id) return `${workspace}:document:${id}`;
  if (kind === "projects" && id) return `${workspace}:project:${id}`;
  if (kind === "agent") return `${workspace}:agent`;
  const params = new URLSearchParams();
  for (const key of ["view", "project", "assignee", "label"]) {
    const value = url.searchParams.get(key);
    if (value && !(key === "view" && value === "all")) params.set(key, value);
  }
  params.sort();
  return `${url.pathname}?${params}`;
}

// A tab's key has no hash, so a page that keeps its section in the hash records it here
// and switching back to the tab lands on that section again.
const tabHashes = new Map<string, string>();
export function rememberTabHash(key: string, hash: string) {
  tabHashes.set(key, hash);
}
export function tabHref(key: string): string {
  return `${key}${tabHashes.get(key) ?? ""}`;
}

// Following a link inside a page keeps the strip the same length: the page replaces the tab
// it was opened from. A pinned tab stays put, and so does a tab opened on purpose as a new
// one — ⌘-click, the palette's +, or any sidebar entry.
export function placeInTabs(
  tabs: string[],
  current: string,
  { from, fixed, newTab }: { from: string | null; fixed: string[]; newTab: boolean }
): string[] {
  if (tabs.includes(current)) return tabs;
  const same = tabs.findIndex((key) => tabIdentity(key) === tabIdentity(current));
  if (same >= 0) return tabs.map((key, i) => (i === same ? current : key));
  const at = newTab || !from || fixed.includes(from) ? -1 : tabs.indexOf(from);
  if (at < 0) return [...tabs, current];
  return tabs.map((key, i) => (i === at ? current : key));
}

// How many tabs the strip can show at their narrowest; the active tab is always one of them.
export function fitTabs(tabs: string[], current: string, limit: number) {
  const room = Math.max(1, limit);
  if (tabs.length <= room) return { shown: tabs, hidden: [] as string[] };
  const head = tabs.slice(0, room);
  const shown = !tabs.includes(current) || head.includes(current) ? head : [...head.slice(0, room - 1), current];
  return { shown, hidden: tabs.filter((key) => !shown.includes(key)) };
}
