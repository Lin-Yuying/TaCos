import { Suspense } from "react";
import { ProjectPage } from "@/components/project-page";

export default function ProjectPageRoute({
  params,
}: {
  params: Promise<{ workspaceId: string; projectId: string }>;
}) {
  return (
    <Suspense fallback={<div className="p-6 text-[13px] text-muted">Loading…</div>}>
      <ProjectPage params={params} initialTab="overview" />
    </Suspense>
  );
}
