import { requireWorkspace, type WorkspaceContext } from "@/lib/auth";
import { TacosError } from "@/lib/tacos-error";

/**
 * U-05: workspace data belongs to the owner and its admins. A member or guest cannot
 * read or write a whole-workspace archive, even though they can see the workspace.
 */
export async function requireTransferRole(workspaceId: string): Promise<WorkspaceContext & { isOwner: boolean }> {
  const context = await requireWorkspace(workspaceId);
  const isOwner = context.workspace.createdBy === context.user.id;
  if (!isOwner && context.role !== "admin") {
    throw new TacosError(
      "Only the workspace owner or an admin can export or import workspace data",
      403
    );
  }
  return { ...context, isOwner };
}
