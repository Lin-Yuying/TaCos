// U-12: read-only view of the members' desktop runners for the System page.
// The server never starts, restarts or controls a runner; it only reports what each
// computer last said about itself and which runs failed.
import { getDb } from "@/db/client";
import type { RunnerHarness, RunnerAdminRow, RunnerRunError } from "./shared";

const OFFLINE_AFTER_MS = 70_000;

type RunnerRow = {
  userId: string;
  displayName: string;
  username: string;
  lastSeenAt: string | null;
  capabilities: string | null;
};

type RunRow = {
  id: string;
  userId: string;
  status: string;
  error: string | null;
  finishedAt: string | null;
};

type CapabilityShape = {
  harnesses?: Array<{
    id?: unknown;
    label?: unknown;
    ready?: unknown;
    version?: unknown;
    error?: unknown;
  }>;
};

function parseHarnesses(capabilities: string | null): RunnerHarness[] {
  if (!capabilities) return [];
  try {
    const parsed = JSON.parse(capabilities) as CapabilityShape;
    if (!Array.isArray(parsed.harnesses)) return [];
    return parsed.harnesses.map((item) => ({
      id: typeof item.id === "string" ? item.id : "unknown",
      label: typeof item.label === "string" ? item.label : String(item.id ?? "Unknown"),
      ready: item.ready === true,
      version: typeof item.version === "string" ? item.version : null,
      error: typeof item.error === "string" ? item.error : null,
    }));
  } catch {
    return [];
  }
}

export function runnerAdminRows(workspaceId: string): RunnerAdminRow[] {
  try {
    return runnerAdminRowsUnsafe(workspaceId);
  } catch {
    // A damaged database still gets the rest of the health page.
    return [];
  }
}

function runnerAdminRowsUnsafe(workspaceId: string): RunnerAdminRow[] {
  const db = getDb().$client;
  const members = db
    .prepare(
      `SELECT wm.user_id AS userId, u.display_name AS displayName, u.username AS username,
              rs.last_seen_at AS lastSeenAt, rs.capabilities AS capabilities
       FROM workspace_members wm
       JOIN users u ON u.id = wm.user_id
       LEFT JOIN runner_status rs ON rs.user_id = wm.user_id
       WHERE wm.workspace_id = ?
       ORDER BY u.display_name COLLATE NOCASE, u.username`
    )
    .all(workspaceId) as RunnerRow[];
  const failures = db
    .prepare(
      `SELECT id, user_id AS userId, status, error, finished_at AS finishedAt
       FROM agent_runs
       WHERE workspace_id = ? AND source = 'runner' AND status IN ('failed', 'cancelled') AND error IS NOT NULL
       ORDER BY finished_at DESC LIMIT 120`
    )
    .all(workspaceId) as RunRow[];
  const byUser = new Map<string, RunnerRunError[]>();
  for (const run of failures) {
    const list = byUser.get(run.userId) ?? [];
    if (list.length >= 3) continue;
    list.push({
      id: run.id,
      status: run.status,
      error: run.error ?? "",
      finishedAt: run.finishedAt,
    });
    byUser.set(run.userId, list);
  }
  const now = Date.now();
  return members.map((member) => ({
    userId: member.userId,
    displayName: member.displayName,
    username: member.username,
    online: member.lastSeenAt
      ? now - new Date(member.lastSeenAt).getTime() < OFFLINE_AFTER_MS
      : false,
    lastSeenAt: member.lastSeenAt,
    lastSeenAgeSeconds: member.lastSeenAt
      ? Math.max(0, Math.floor((now - Date.parse(member.lastSeenAt)) / 1000))
      : null,
    harnesses: parseHarnesses(member.capabilities),
    recentErrors: byUser.get(member.userId) ?? [],
  }));
}
