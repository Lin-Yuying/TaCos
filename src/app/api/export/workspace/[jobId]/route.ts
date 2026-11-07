import { errorResponse } from "@/lib/api-auth";
import { TacosError } from "@/lib/tacos-error";
import { getTransferJob, toJobView } from "@/lib/transfer/jobs";
import { requireTransferRole } from "@/lib/transfer/permissions";

export async function GET(_req: Request, ctx: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await ctx.params;
    const job = await getTransferJob(jobId);
    if (!job || job.kind !== "export") throw new TacosError("Export not found", 404);
    await requireTransferRole(job.workspaceId);
    return Response.json(toJobView(job), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
