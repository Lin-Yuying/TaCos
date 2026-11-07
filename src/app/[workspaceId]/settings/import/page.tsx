import { ListSkeleton } from "@/components/ui/skeleton";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { resolveLocale } from "@/lib/locale";
import { translator } from "@/lib/i18n";
import { attachmentCapBytes } from "@/lib/transfer/format";
import { listTransferJobs } from "@/lib/transfer/jobs";
import { requireTransferRole } from "@/lib/transfer/permissions";
import { ImportView } from "@/components/import-view";

async function View({ params }: { params: Promise<{ workspaceId: string }> }) {
  await connection();
  const { workspaceId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const t = translator(await resolveLocale(user));
  try {
    await requireTransferRole(workspaceId);
  } catch {
    return (
      <div className="min-w-0 flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-4xl space-y-3" data-testid="import-page">
          <h1 className="text-heading font-semibold">{t("Import workspace")}</h1>
          <p className="text-body text-muted">
            {t("Only the workspace owner or an admin can import workspace data.")}
          </p>
          <Link className="text-small text-accent underline" href={`/${workspaceId}/settings`}>
            {t("Workspace settings")}
          </Link>
        </div>
      </div>
    );
  }
  const jobs = (await listTransferJobs(workspaceId, "import", 5)).map((job) => ({
    id: job.id,
    status: job.status,
    phase: job.phase,
    progress: job.progress,
    error: job.error,
    summary: job.summary,
    targetWorkspaceId: job.targetWorkspaceId,
    createdAt: job.createdAt,
  }));
  return <ImportView workspaceId={workspaceId} initialJobs={jobs} capBytes={attachmentCapBytes()} />;
}

export default function ImportSettingsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <View params={params} />
    </Suspense>
  );
}
