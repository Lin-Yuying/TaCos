import { errorResponse, readJsonBody, requireApiKey } from "@/lib/api-auth";
import { createProject, listProjects, TacosError } from "@/lib/issues";

// A project-scoped key works inside its allowlist; creating a project would land
// outside it, so that needs an "all projects" key.
function assertCanCreateProject(key: { projectIds: string[] | null }): void {
  if (key.projectIds === null) return;
  throw new TacosError(
    "This API key is limited to a project allowlist and cannot create projects.",
    403,
    'Use a key with "All projects" to create one, or create it in the web UI.'
  );
}

export async function GET(req: Request) {
  try {
    const key = await requireApiKey(req);
    const projects = await listProjects(key.workspaceId, key.createdBy);
    const allowed =
      key.projectIds === null
        ? projects
        : projects.filter((project) => key.projectIds!.includes(project.id));
    return Response.json(allowed, { headers: { "X-Total-Count": String(allowed.length) } });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const key = await requireApiKey(req);
    assertCanCreateProject(key);
    const body = await readJsonBody(req);
    if (typeof body.name !== "string" || !body.name.trim()) {
      return Response.json(
        { error: "name is required", hint: "Provide a short project name, e.g. \"Mobile app\"" },
        { status: 400 }
      );
    }
    if (body.description !== undefined && typeof body.description !== "string") {
      return Response.json({ error: "description must be a string" }, { status: 400 });
    }
    const project = await createProject({
      workspaceId: key.workspaceId,
      name: body.name,
      description: typeof body.description === "string" ? body.description : undefined,
      createdBy: key.createdBy,
    });
    return Response.json(project, {
      status: 201,
      headers: { Location: `/api/v1/projects/${project.key}` },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
