import { requireOpsAdmin } from "@/lib/ops/auth";
import { buildDiagnosticsBundle } from "@/lib/ops/diagnostics";
import { recordServerEvent } from "@/lib/ops/server-log";

// U-12: diagnostics download. Admin-only, redacted, capped, and never a database dump.
export async function GET(_request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await params;
    const context = await requireOpsAdmin(workspaceId);
    const bundle = await buildDiagnosticsBundle();
    recordServerEvent("info", "diagnostics bundle downloaded", {
      actor: context.user.username,
      bytes: bundle.bytes,
      truncated: bundle.truncated,
    });
    return new Response(bundle.body, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${bundle.filename}"`,
        "Cache-Control": "no-store",
        "X-TaCos-Diagnostics-Bytes": String(bundle.bytes),
      },
    });
  } catch {
    return new Response("Diagnostics are available to the instance admin only.", { status: 403 });
  }
}
