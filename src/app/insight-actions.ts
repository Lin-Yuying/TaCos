"use server";

import { requireWorkspace } from "@/lib/auth";
import { createInsightView } from "@/lib/task-views";
import { parseInsightSavedConfig } from "@/lib/insights.shared";
import { invalidatePath as revalidatePath } from "@/lib/revalidation";
import type { ActionResult } from "./actions";

/**
 * U-02: a report becomes a shared workspace view through U-09's view table. Only
 * workspace members reach this action, which matches the sharing decision (no guests).
 */
export async function saveInsightViewAction(
  workspaceId: string,
  input: { name: string; config: unknown }
): Promise<ActionResult<{ id: string; name: string }>> {
  try {
    const { user } = await requireWorkspace(workspaceId);
    const config = parseInsightSavedConfig(input.config);
    if (!config) return { ok: false, error: "Enter a valid report range and filters" };
    const view = createInsightView(workspaceId, user.id, String(input.name ?? ""), config);
    revalidatePath(`/${workspaceId}/insights`);
    return { ok: true, data: { id: view.id, name: view.name } };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not save the view",
    };
  }
}
