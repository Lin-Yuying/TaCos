import { ListSkeleton } from "@/components/ui/skeleton";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { resolveLocale } from "@/lib/locale";
import { translator } from "@/lib/i18n";
import { attachmentCapBytes } from "@/lib/transfer/format";
import { listTransferJobs, toJobView } from "@/lib/transfer/jobs";
import { requireTransferRole } from "@/lib/transfer/permissions";
import { ExportView } from "@/components/export-view";

async function View({ params }: { params: Promise<{ workspaceId: string }> }) {
  await connection();
  const { workspaceId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const t = translator(await resolveLocale(user));
  let workspaceName: string;
  try {
    const context = await requireTransferRole(workspaceId);
    workspaceName = context.workspace.name;
  } catch {
    return (
      <div className="min-w-0 flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-3xl space-y-3" data-testid="export-page">
          <h1 className="text-heading font-semibold">{t("Export workspace")}</h1>
          <p className="text-body text-muted">
            {t("Only the workspace owner or an admin can export workspace data.")}
          </p>
          <Link className="text-small text-accent underline" href={`/${workspaceId}/settings`}>
            {t("Workspace settings")}
          </Link>
        </div>
      </div>
    );
  }
  const jobs = (await listTransferJobs(workspaceId, "export", 10)).map(toJobView);
  return (
    <ExportView
      workspaceId={workspaceId}
      workspaceName={workspaceName}
      initialJobs={jobs}
      capBytes={attachmentCapBytes()}
    />
  );
}

export default function ExportSettingsPage({
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
