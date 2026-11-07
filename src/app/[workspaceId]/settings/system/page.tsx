import { ListSkeleton } from "@/components/ui/skeleton";
import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { requireOpsAdmin } from "@/lib/ops/auth";
import { buildSystemSnapshot } from "@/lib/ops/snapshot";
import { SystemView } from "@/components/system-view";

// U-12: Settings → System. Instance health, diagnostics, backups, updates and runners.
// Only a site admin who also administers this workspace may open it.
export default function SystemPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <View params={params} />
    </Suspense>
  );
}

async function View({ params }: { params: Promise<{ workspaceId: string }> }) {
  await connection();
  const { workspaceId } = await params;
  let owner = false;
  try {
    const context = await requireOpsAdmin(workspaceId);
    owner = context.workspace.createdBy === context.user.id;
  } catch {
    redirect(`/${workspaceId}/settings`);
  }
  const snapshot = await buildSystemSnapshot(workspaceId);
  return <SystemView workspaceId={workspaceId} snapshot={snapshot} isOwner={owner} />;
}
