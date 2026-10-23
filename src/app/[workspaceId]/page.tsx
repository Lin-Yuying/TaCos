import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { listIssues, listMembers, listProjects, type Status } from "@/lib/issues";
import { ListHeader } from "@/components/list-header";
import { IssueLayout } from "@/components/issue-layout";

type View = "all" | "active" | "my" | "unassigned" | Status;

export default async function WorkspaceIssuesPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<div className="p-6 text-[13px] text-muted">Loading…</div>}>
      <IssuesView params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function IssuesView({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const { workspaceId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const sp = await searchParams;
  const view = typeof sp.view === "string" ? sp.view : "all";
  const q = typeof sp.q === "string" ? sp.q : "";
  const label = typeof sp.label === "string" ? sp.label : "";
  const projectId = typeof sp.project === "string" ? sp.project : undefined;
  const assigneeParam = typeof sp.assignee === "string" ? sp.assignee : undefined;

  const projects = await listProjects(workspaceId);
  const [project] = projectId
    ? projects.filter((p) => p.id === projectId || p.key.toUpperCase() === projectId.toUpperCase())
    : [undefined];

  // ?assignee=<user id> comes from the sidebar's member list; me/none are shortcuts.
  const members = await listMembers(workspaceId);
  const assigneeMember =
    assigneeParam && assigneeParam !== "me" && assigneeParam !== "none"
      ? members.find((m) => m.id === assigneeParam)
      : undefined;

  const issues = await listIssues(workspaceId, {
    status:
      view === "active"
        ? "active"
        : view === "todo" || view === "in_progress" || view === "done" || view === "canceled"
          ? (view as Status)
          : undefined,
    q: q || undefined,
    label: label || undefined,
    projectId: project?.id,
    assigneeId:
      assigneeParam === "me"
        ? user.id
        : assigneeParam === "none"
          ? null
          : (assigneeMember?.id ?? undefined),
  });

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <ListHeader
        view={view === "all" || view === "active" ? view : (view as Status)}
        q={q}
        label={label}
        count={issues.length}
        projectParam={project?.id ?? projectId}
        projectName={project?.name}
        assigneeParam={assigneeParam}
        assigneeName={assigneeMember?.displayName}
      />
      <IssueLayout issues={issues} />
    </div>
  );
}
