import { errorResponse, readJsonBody } from "@/lib/api-auth";
import { startWorkspaceExport } from "@/lib/export/job";
import { TacosError } from "@/lib/tacos-error";

/**
 * U-05 ops export. The owner or an admin starts one export at a time; the response is
 * the job row, not the archive. `GET /api/export/workspace/[jobId]` reports progress and
 * a signed download URL valid for 15 minutes.
 */
export async function POST(req: Request) {
  try {
    const body = await readJsonBody(req);
    const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
    if (!workspaceId) throw new TacosError("workspaceId is required", 400);
    const job = await startWorkspaceExport(workspaceId, {
      includeAttachments: body.includeAttachments !== false,
    });
    return Response.json(job, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
