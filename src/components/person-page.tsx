"use client";

import { useMemo, useState } from "react";
import { PAGE_HEADER, PAGE_INSET, PAGE_TITLE } from "@/lib/page-chrome";
import Link from "next/link";
import { ArrowUpRight, FileText, Lock, Search, Users, X } from "lucide-react";
import { IssueLayout, LayoutToggle } from "@/components/issue-layout";
import { ProjectIcon } from "@/components/icons";
import { AssigneeAvatar } from "@/components/issue-table";
import { issueRef } from "@/lib/format";
import type { PageSummary } from "@/lib/pages";
import type { IssueWithLabels, Member, PersonProject } from "@/lib/issues";
import { useT } from "@/components/i18n-context";

type PersonTab = "projects" | "tasks" | "documents";

// One teammate's page: what they own, what they were added to, the tasks on their
// plate and the documents they wrote. Same pills and same list/board switch as a
// project page, so it is a place in the workspace rather than a report about a user.
export function PersonPage({
  workspaceId,
  person,
  workspaceRole,
  projects,
  issues,
  documents,
  currentUserId,
}: {
  workspaceId: string;
  person: Member;
  workspaceRole: string;
  projects: PersonProject[];
  issues: IssueWithLabels[];
  documents: PageSummary[];
  currentUserId: string;
}) {
  const t = useT();
  const [tab, setTab] = useState<PersonTab>("projects");
  const [q, setQ] = useState("");

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return issues;
    return issues.filter(
      (issue) =>
        issue.title.toLowerCase().includes(needle) ||
        issue.identifier.toLowerCase().includes(needle) ||
        issueRef(issue).toLowerCase().includes(needle)
    );
  }, [issues, q]);

  const tabs: { key: PersonTab; label: string; count: number }[] = [
    { key: "projects", label: t("Projects"), count: projects.length },
    { key: "tasks", label: t("Tasks"), count: issues.length },
    { key: "documents", label: t("Documents"), count: documents.length },
  ];

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className={`${PAGE_HEADER} ${PAGE_INSET}`}>
        <div className="flex min-w-0 items-center gap-2.5">
          <AssigneeAvatar displayName={person.displayName} avatar={person.avatar} size={26} />
          <h1 className={PAGE_TITLE}>
            {person.displayName}
          </h1>
          <span className="inline-flex h-[18px] items-center rounded-[5px] px-1.5 whitespace-nowrap shrink-0 bg-elevated text-caption text-muted">
            {t(workspaceRole)}
          </span>
        </div>
        <nav className="ml-auto flex flex-wrap items-center gap-1">
          {tabs.map((item) => {
            const active = item.key === tab;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-small transition-colors ${
                  active
                    ? "bg-elevated font-medium text-text"
                    : "text-muted hover:text-text"
                }`}
              >
                {item.label}
                {item.count > 0 && (
                  <span className={active ? "text-muted" : "text-faint"}>{item.count}</span>
                )}
              </button>
            );
          })}
        </nav>
      </header>

      {tab === "projects" ? (
        <div className="flex-1 overflow-y-auto">
          <div className={`w-full py-5 ${PAGE_INSET}`}>
            {projects.length === 0 ? (
              <p className="text-body text-faint">
                {firstName(person.displayName)} does not own or belong to any project yet.
              </p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border">
                {projects.map((project, index) => (
                  <Link
                    key={project.id}
                    href={`/${workspaceId}/projects/${project.id}`}
                    className={`group flex items-center gap-2.5 px-3.5 py-2 text-body text-text transition-colors hover:bg-elevated/60 ${
                      index > 0 ? "border-t border-border" : ""
                    }`}
                  >
                    <span className="flex w-4 shrink-0 items-center justify-center">
                      <ProjectIcon color={project.color} icon={project.icon} size={15} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{project.name}</span>
                    {/* Owner is the project's creator; everyone else in the list was
                        added through project membership, so the badge says which. */}
                    <span
                      className={`inline-flex h-[18px] items-center rounded-[5px] px-1.5 whitespace-nowrap shrink-0 text-caption ${
                        project.role === "owner"
                          ? "bg-elevated font-medium text-text"
                          : "border border-border text-muted"
                      }`}
                    >
                      {project.role === "owner" ? t("Owner") : t("Member")}
                    </span>
                    <ArrowUpRight
                      size={13}
                      className="shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100"
                    />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : tab === "documents" ? (
        <div className="flex-1 overflow-y-auto">
          <div className={`w-full py-5 ${PAGE_INSET}`}>
            {documents.length === 0 ? (
              <p className="text-body text-faint">
                {firstName(person.displayName)} has not written any documents you can see.
              </p>
            ) : (
              <div className="space-y-0.5">
                {documents.map((page) => (
                  <Link
                    key={page.id}
                    href={`/${workspaceId}/docs/${page.id}`}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-body text-text transition-colors hover:bg-elevated/60"
                  >
                    <span className="flex w-4 shrink-0 items-center justify-center text-faint">
                      {page.icon ? (
                        <span className="text-body leading-none">{page.icon}</span>
                      ) : (
                        <FileText size={14} />
                      )}
                    </span>
                    <span className="truncate">{page.title}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-1 text-caption text-faint">
                      {page.shared ? <Users size={11} /> : <Lock size={11} />}
                      {page.shared ? t("Shared") : t("Private")}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <header className={`flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-border py-1.5 ${PAGE_INSET}`}>
            <span className="text-body font-medium text-muted">{t("Tasks")}</span>
            <span className="inline-flex h-[18px] items-center rounded-[5px] px-1.5 whitespace-nowrap bg-elevated text-caption text-muted">
              {shown.length}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <div className="flex w-60 items-center gap-2 rounded-md border border-border bg-elevated/50 px-2 py-1.5 focus-within:border-border-strong">
                <Search size={13} className="shrink-0 text-faint" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t("Search tasks…")}
                  className="w-full bg-transparent text-body text-text placeholder:text-faint"
                />
                {q && (
                  <button
                    type="button"
                    onClick={() => setQ("")}
                    aria-label={t("Clear search")}
                    className="text-faint hover:text-muted"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              <LayoutToggle />
            </div>
          </header>
          <IssueLayout issues={shown} workspaceId={workspaceId} currentUserId={currentUserId} />
        </>
      )}
    </div>
  );
}

function firstName(displayName: string): string {
  return displayName.split(" ")[0] || displayName;
}
