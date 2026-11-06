import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { getSessionUser, requireWorkspace } from "@/lib/auth";
import { listMembers, listProjects } from "@/lib/issues";
import { SearchPageView, type SearchInitial } from "@/components/search-page";
import { isSearchGroup, isSearchSort, type SearchGroup, type SearchSort } from "@/lib/search-query";
import { STATUS_ORDER, type Status } from "@/lib/constants";

const DATE_PRESETS = ["1d", "7d", "30d", "90d"];

function one(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

function initialFrom(
  params: Record<string, string | string[] | undefined>
): SearchInitial {
  const kind: SearchGroup = isSearchGroup(one(params.kind)) ? (one(params.kind) as SearchGroup) : "all";
  const sort: SearchSort = isSearchSort(one(params.sort)) ? (one(params.sort) as SearchSort) : "relevance";
  const status: Status | "" = (STATUS_ORDER as readonly string[]).includes(one(params.status))
    ? (one(params.status) as Status)
    : "";
  const page = Number(one(params.page) || 1);
  return {
    query: one(params.q),
    kind,
    sort,
    project: one(params.project),
    assignee: one(params.assignee),
    status,
    created: DATE_PRESETS.includes(one(params.created)) ? one(params.created) : "",
    updated: DATE_PRESETS.includes(one(params.updated)) ? one(params.updated) : "",
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  };
}

export default function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<div className="p-6 text-body text-muted">Loading…</div>}>
      <SearchContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function SearchContent({
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
  await requireWorkspace(workspaceId);
  const [projects, members, search] = await Promise.all([
    listProjects(workspaceId, user.id),
    listMembers(workspaceId),
    searchParams,
  ]);
  const initial = initialFrom(search);
  // A palette link re-renders this page with new params; keying the view makes it
  // initialize from them without a setState-in-effect sync.
  const key = [
    initial.query,
    initial.kind,
    initial.sort,
    initial.project,
    initial.assignee,
    initial.status,
    initial.created,
    initial.updated,
    initial.page,
  ].join("|");
  return (
    <SearchPageView
      key={key}
      workspaceId={workspaceId}
      initial={initial}
      projects={projects.map((project) => ({
        id: project.id,
        name: project.name,
        key: project.key,
      }))}
      members={members.map((member) => ({
        id: member.id,
        displayName: member.displayName,
        username: member.username,
      }))}
    />
  );
}
