export function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// People read an issue as "<project name>-<number>". The stored identifier keeps the
// project's short key because that is what the REST API, MCP and activity rows use, so
// this is display-only — lookups still go through `identifier`.
export function issueRef(issue: {
  projectName?: string | null;
  number?: number | null;
  identifier: string;
}): string {
  return issue.projectName && issue.number != null
    ? `${issue.projectName}-${issue.number}`
    : issue.identifier;
}

export function actorLabel(actor: string): string {
  if (actor === "you") return "You";
  if (actor === "mcp") return "MCP agent";
  if (actor.startsWith("api:")) return `API · ${actor.slice(4)}`;
  return actor;
}
