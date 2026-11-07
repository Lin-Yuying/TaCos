import { errorResponse } from "@/lib/api-auth";
import { getImportJob } from "@/lib/import/job";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ workspaceId: string; jobId: string }> }
) {
  try {
    const { workspaceId, jobId } = await ctx.params;
    return Response.json(await getImportJob(workspaceId, jobId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
