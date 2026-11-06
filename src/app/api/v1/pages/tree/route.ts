import { assertKeyProject, errorResponse, requireApiKey } from "@/lib/api-auth";
import { filterPagesForKey } from "@/lib/api-pages";
import { listPageTree, listProjectPageTree } from "@/lib/pages";

// The same flat depth list the document sidebar builds from: parents come before their
// children and `depth` says how deep each one sits. A hidden parent makes its child a
// root, exactly as the web UI shows it.
export async function GET(req: Request) {
  try {
    const key = await requireApiKey(req);
    const params = new URL(req.url).searchParams;
    const projectParam = params.get("project");
    const project = projectParam ? await assertKeyProject(key, projectParam) : undefined;
    const pages = project
      ? await listProjectPageTree(key.workspaceId, project.id, key.createdBy)
      : await listPageTree(key.workspaceId, key.createdBy);
    const allowed = filterPagesForKey(key, pages);
    return Response.json(allowed, { headers: { "X-Total-Count": String(allowed.length) } });
  } catch (err) {
    return errorResponse(err);
  }
}
