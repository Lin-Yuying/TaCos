import { Suspense } from "react";
import { ProjectPage } from "@/components/project-page";

// Kept so bookmarks and saved window tabs still land on the Issues list; the
// pills themselves switch tabs without navigating.
export default function ProjectIssuesRoute({
  params,
}: {
  params: Promise<{ workspaceId: string; projectId: string }>;
}) {
  return (
    <Suspense fallback={<div className="p-6 text-[13px] text-muted">Loading…</div>}>
      <ProjectPage params={params} initialTab="issues" />
    </Suspense>
  );
}
