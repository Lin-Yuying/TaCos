import { requireWorkspace } from "@/lib/auth";
import { aiEngineOptions } from "@/lib/ai";
import { TacosError } from "@/lib/issues";

// The inline AI panels live deep inside client editors, so they ask for the same model
// list the Agent tab is rendered with instead of threading it through every prop.
export async function GET(request: Request) {
  try {
    const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
    if (!workspaceId) throw new TacosError("Workspace is required", 400);
    await requireWorkspace(workspaceId);
    return Response.json({ engines: await aiEngineOptions(workspaceId) });
  } catch (err) {
    const status = err instanceof TacosError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Could not load the models";
    return Response.json({ error: message }, { status });
  }
}
