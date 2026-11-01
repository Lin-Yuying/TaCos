import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getSessionUser, requireWorkspace } from "@/lib/auth";
import { listIssues, listMembers, listPersonProjects, listProjects } from "@/lib/issues";
import { listPageTree } from "@/lib/pages";
import { PersonPage } from "@/components/person-page";

export default async function PersonRoute({
  params,
}: {
  params: Promise<{ workspaceId: string; userId: string }>;
}) {
  return (
    <Suspense fallback={<div className="p-6 text-[13px] text-muted">Loading…</div>}>
      <Person params={params} />
    </Suspense>
  );
}

async function Person({ params }: { params: Promise<{ workspaceId: string; userId: string }> }) {
  await connection();
  const { workspaceId, userId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const ctx = await requireWorkspace(workspaceId);

  const members = await listMembers(workspaceId);
  const person = members.find((member) => member.id === userId);
  if (!person) redirect(`/${workspaceId}`);

  const [visibleProjects, personProjects, issues, pages] = await Promise.all([
    listProjects(workspaceId, user.id),
    listPersonProjects(workspaceId, person.id),
    // Visibility follows the workspace switch: a member outside a project does not
    // learn what the person is doing there.
    listIssues(workspaceId, { assigneeId: person.id, viewerId: user.id }),
    listPageTree(workspaceId, user.id),
  ]);
  const visible = new Set(visibleProjects.map((project) => project.id));

  return (
    <PersonPage
      workspaceId={workspaceId}
      person={person}
      workspaceRole={
        ctx.workspace.createdBy === person.id
          ? "Owner"
          : person.role === "admin"
            ? "Admin"
            : "Member"
      }
      projects={personProjects.filter((project) => visible.has(project.id))}
      issues={issues}
      // Private pages of someone else are already filtered out by listPageTree.
      documents={pages.filter((page) => page.createdBy === person.id)}
      currentUserId={user.id}
    />
  );
}
