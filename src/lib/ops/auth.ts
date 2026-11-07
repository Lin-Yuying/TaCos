// U-12: instance operations are narrower than ordinary workspace administration.
// The System page is for site admins who also administer this workspace; destructive
// restore is reserved for the workspace owner because it replaces everyone's data.
import { requireAdmin, type WorkspaceContext } from "@/lib/auth";
import { TacosError } from "@/lib/tacos-error";

export async function requireOpsAdmin(workspaceId: string): Promise<WorkspaceContext> {
  const context = await requireAdmin(workspaceId);
  if (context.user.siteRole !== "admin") {
    throw new TacosError("Only the instance admin can manage this server", 403);
  }
  return context;
}

export async function requireOpsOwner(workspaceId: string): Promise<WorkspaceContext> {
  const context = await requireOpsAdmin(workspaceId);
  if (context.workspace.createdBy !== context.user.id) {
    throw new TacosError(
      "Only the workspace owner can restore a backup",
      403,
      "Ask the workspace owner to sign in and run the restore."
    );
  }
  return context;
}
