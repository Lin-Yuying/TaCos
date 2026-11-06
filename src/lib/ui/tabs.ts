// Identity is independent from title, language, transient filters and reading position.
export function tabIdentity(href: string): string {
  const url = new URL(href, "https://tacos.local");
  const parts = url.pathname.split("/").filter(Boolean);
  const [workspace, kind, id] = parts;
  if (kind === "docs" && id) return `${workspace}:document:${id}`;
  if (kind === "projects" && id) return `${workspace}:project:${id}`;
  if (kind === "agent") return `${workspace}:agent`;
  const params = new URLSearchParams();
  for (const key of ["view", "project", "assignee"]) {
    const value = url.searchParams.get(key);
    if (value && !(key === "view" && value === "all")) params.set(key, value);
  }
  params.sort();
  return `${url.pathname}?${params}`;
}
