import type { Locale } from "./i18n";

// In Chinese the relative time carries its own "ago" (前), so templates that say
// "{time} ago" in English translate without one.
export function timeAgo(iso: string, locale: Locale = "en"): string {
  const zh = locale === "zh";
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return zh ? "刚刚" : "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return zh ? `${minutes} 分钟前` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return zh ? `${hours} 小时前` : `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return zh ? `${days} 天前` : `${days}d`;
  return new Date(iso).toLocaleDateString(zh ? "zh-CN" : "en-US", { month: "short", day: "numeric" });
}

export function formatDate(iso: string, locale: Locale = "en"): string {
  return new Date(iso).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", {
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
