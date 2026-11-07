import { ListSkeleton } from "@/components/ui/skeleton";
import { Suspense } from "react";
import { ProjectPage } from "@/components/project-page";

// Kept so bookmarks and saved window tabs still land on the Issues list; the
// pills themselves switch tabs without navigating.
export default function ProjectIssuesRoute({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; projectId: string }>;
  searchParams: Promise<Record<string,string|string[]|undefined>>;
}) {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <ProjectPage searchParams={searchParams} params={params} initialTab="issues" />
    </Suspense>
  );
}
