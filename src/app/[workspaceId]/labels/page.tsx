import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getSessionUser, requireWorkspace } from "@/lib/auth";
import { listLabelsWithCounts } from "@/lib/issues";
import { LabelsManager } from "@/components/labels-manager";

export default async function LabelsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  return (
    <Suspense fallback={<div className="p-6 text-[13px] text-muted">Loading…</div>}>
      <View params={params} />
    </Suspense>
  );
}

async function View({ params }: { params: Promise<{ workspaceId: string }> }) {
  await connection();
  const { workspaceId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  await requireWorkspace(workspaceId);
  const labels = await listLabelsWithCounts(workspaceId);
  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <h1 className="text-[14px] font-semibold">Labels</h1>
        <span className="rounded-full bg-elevated px-2 py-0.5 text-[11px] text-muted">
          {labels.length}
        </span>
      </header>
      <LabelsManager workspaceId={workspaceId} initialLabels={labels} />
    </>
  );
}
