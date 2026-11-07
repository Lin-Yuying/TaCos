import { ListSkeleton } from "@/components/ui/skeleton";
import { Suspense } from "react";
import { ProjectPage } from "@/components/project-page";

export default function ProjectPageRoute({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; projectId: string }>;
  searchParams: Promise<Record<string,string|string[]|undefined>>;
}) {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <ProjectPage searchParams={searchParams} params={params} initialTab="overview" />
    </Suspense>
  );
}
