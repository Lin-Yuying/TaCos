import { errorResponse, readJsonBody } from "@/lib/api-auth";
import { startWorkspaceImport } from "@/lib/import/job";
import { TacosError } from "@/lib/tacos-error";

export async function POST(req: Request, ctx: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await ctx.params;
  try {
    const body = await readJsonBody(req);
    const sourceId = typeof body.sourceId === "string" ? body.sourceId.trim() : "";
    if (!sourceId) throw new TacosError("sourceId is required. Preview the import again.", 400);
    const job = await startWorkspaceImport({
      workspaceId,
      sourceId,
      options: {
        includeAttachments: body.includeAttachments !== false,
        ...(typeof body.workspaceName === "string" && body.workspaceName.trim()
          ? { workspaceName: body.workspaceName.trim() }
          : {}),
        ...(typeof body.attachmentCapBytes === "number" && body.attachmentCapBytes > 0
          ? { attachmentCapBytes: body.attachmentCapBytes }
          : {}),
      },
    });
    return Response.json(job, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
