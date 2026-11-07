"use server";

import { requireWorkspace } from "@/lib/auth";
import {
  listWorkspaceActivity,
  type ActivityScope,
  type ActivityObjectType,
  type WorkspaceActivityPage,
} from "@/lib/activity";
import type { ActionResult } from "./actions";

export type ActivityQueryInput = {
  scope?: ActivityScope;
  objectType?: ActivityObjectType;
  projectId?: string;
  personId?: string;
  cursor?: string | null;
};

export async function loadActivityAction(
  workspaceId: string,
  query: ActivityQueryInput = {}
): Promise<ActionResult<WorkspaceActivityPage>> {
  try {
    const { user } = await requireWorkspace(workspaceId);
    const data = await listWorkspaceActivity(workspaceId, user.id, {
      scope: query.scope,
      objectType: query.objectType,
      projectId: query.projectId,
      personId: query.personId,
      cursor: query.cursor ?? null,
    });
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong" };
  }
}
