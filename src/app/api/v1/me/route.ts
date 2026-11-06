import { errorResponse, readApiKey } from "@/lib/api-auth";
import { listMembers, listProjects } from "@/lib/issues";

export async function GET(req: Request) {
  try {
    const key = await readApiKey(req);
    if (!key) {
      return Response.json(
        {
          product: "tacos",
          authenticated: false,
          hint: "Create a key in Settings → Agent access, then send Authorization: Bearer <key>",
        },
        { status: 200 }
      );
    }
    const [members, allProjects] = await Promise.all([
      listMembers(key.workspaceId),
      listProjects(key.workspaceId),
    ]);
    const allowlist = key.projectIds;
    const projects =
      allowlist === null
        ? allProjects
        : allProjects.filter((project) => allowlist.includes(project.id));
    return Response.json({
      product: "tacos",
      authenticated: true,
      keyName: key.name,
      keyPrefix: key.keyPrefix,
      last4: key.last4,
      scopes: key.scopes ?? ["read", "write"],
      // null means every project; a list means only those projects.
      projectIds: key.projectIds,
      projectCount: projects.length,
      expiresAt: key.expiresAt,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt,
      lastUsedIp: key.lastUsedIp,
      workspace: { id: key.workspaceId },
      members: members.map((m) => ({ id: m.id, username: m.username, displayName: m.displayName })),
      projects: projects.map((p) => ({ id: p.id, key: p.key, name: p.name })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
