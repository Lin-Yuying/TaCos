import crypto from "node:crypto";
import { getDb } from "@/db/client";
import { events } from "@/db/schema";

export type TransferAuditActor =
  | { kind: "user"; userId: string; displayName: string }
  | { kind: "agent"; label: string };

/**
 * U-05 audit. Exports and imports are workspace-level actions, so they land in the
 * existing events store as `object_type = workspace` rows instead of on a task. The
 * Settings pages list the same jobs next to their owner and time.
 */
export async function recordTransferAudit(input: {
  workspaceId: string;
  type: "export_started" | "export_completed" | "export_failed" | "import_completed" | "import_failed";
  actor: TransferAuditActor;
  data: Record<string, unknown>;
}): Promise<void> {
  const actorFields =
    input.actor.kind === "user"
      ? { actorId: input.actor.userId, agentActor: null }
      : { actorId: null, agentActor: input.actor.label };
  await getDb().insert(events).values({
    id: crypto.randomUUID(),
    // Workspace rows have no task; the empty id keeps the column shape used by
    // workspace-deletion notices.
    issueId: "",
    type: input.type,
    data: JSON.stringify(input.data),
    workspaceId: input.workspaceId,
    objectType: "workspace",
    objectId: input.workspaceId,
    visibility: "workspace",
    createdAt: new Date().toISOString(),
    ...actorFields,
  });
}
