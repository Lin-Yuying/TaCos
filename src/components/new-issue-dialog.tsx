"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Users, X } from "lucide-react";
import { useUI } from "@/components/ui-context";
import { Menu, MenuItem } from "@/components/menu";
import {
  LabelPill,
  PRIORITY_META,
  PriorityIcon,
  ProjectIcon,
  STATUS_META,
  StatusIcon,
} from "@/components/icons";
import { AssigneeAvatar, AssigneeStack } from "@/components/issue-table";
import { createIssueAction } from "@/app/actions";
import { STATUS_ORDER, type Priority, type Status } from "@/lib/constants";
import type { Label, Member, Project } from "@/lib/issues";

export function NewIssueDialog({ workspaceId }: { workspaceId: string }) {
  const { composerOpen, composerStatus, setComposerOpen, openIssue } = useUI();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  // Opened from a project's Overview page, the composer should stay in that project.
  const activeProjectId =
    searchParams.get("project") ?? pathname.match(/\/projects\/([^/]+)/)?.[1] ?? "";
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<Status>("todo");
  const [priority, setPriority] = useState<Priority>(0);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [labelNames, setLabelNames] = useState<string[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!composerOpen) return;
    setTitle("");
    setDescription("");
    setStatus(composerStatus ?? "todo");
    setPriority(0);
    setAssigneeIds([]);
    setLabelNames([]);
    setError(null);
    setBusy(false);
    fetch(`/api/internal/${workspaceId}/projects`)
      .then((res) => res.json())
      .then((data: Project[]) => {
        setProjects(data);
        setProjectId(
          data.find((p) => p.id === activeProjectId)?.id ?? data[0]?.id ?? ""
        );
      })
      .catch(() => setProjects([]));
    fetch(`/api/internal/${workspaceId}/labels`)
      .then((res) => res.json())
      .then((data) => setLabels(data as Label[]))
      .catch(() => setLabels([]));
    fetch(`/api/internal/${workspaceId}/members`)
      .then((res) => res.json())
      .then((data) => setMembers(data as Member[]))
      .catch(() => setMembers([]));
  }, [composerOpen, composerStatus, workspaceId, activeProjectId]);

  useEffect(() => {
    if (!composerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setComposerOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [composerOpen, setComposerOpen]);

  if (!composerOpen) return null;

  async function submit() {
    const project = projects.find((p) => p.id === projectId);
    if (!title.trim() || !project || busy) return;
    setBusy(true);
    const result = await createIssueAction(workspaceId, {
      title,
      description,
      status,
      priority,
      assigneeIds,
      labelNames,
      project: project.id,
    });
    setBusy(false);
    if (result.ok) {
      setComposerOpen(false);
      openIssue(result.data.id);
    } else {
      setError(result.error);
    }
  }

  const project = projects.find((p) => p.id === projectId);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setComposerOpen(false)} />
      <div className="fixed inset-x-0 top-[12vh] z-50 mx-auto w-[640px] max-w-[94vw]">
        <div
          className="rounded-xl border border-border bg-overlay shadow-2xl shadow-black/15"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-2 text-[12px] text-faint">
            <span>
              New issue
              {project ? (
                <span className="ml-1 inline-flex items-center gap-1 text-muted">
                  <ProjectIcon color={project.color} size={12} />
                  {project.name}
                </span>
              ) : null}
            </span>
            <button
              type="button"
              onClick={() => setComposerOpen(false)}
              aria-label="Close"
              className="rounded p-1 transition-colors hover:bg-elevated hover:text-text"
            >
              <X size={14} />
            </button>
          </div>
          <div className="p-4">
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder="Issue title"
              className="w-full bg-transparent text-[18px] font-semibold text-text placeholder:text-faint"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add description…"
              rows={4}
              className="mt-2 w-full resize-none bg-transparent text-[13px] leading-relaxed text-muted placeholder:text-faint"
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Menu
                width={200}
                trigger={
                  <>
                    <span className="text-muted">Project</span>
                    {project ? (
                      <span className="flex items-center gap-1 text-[12px] text-muted">
                        <ProjectIcon color={project.color} size={12} />
                        {project.name}
                      </span>
                    ) : null}
                  </>
                }
              >
                {(close) => (
                  <>
                    {projects.map((option) => (
                      <MenuItem
                        key={option.id}
                        active={option.id === projectId}
                        onSelect={() => {
                          setProjectId(option.id);
                          close();
                        }}
                      >
                        <ProjectIcon color={option.color} size={13} />
                        {option.name}
                      </MenuItem>
                    ))}
                    {projects.length === 0 && (
                      <div className="px-2 py-1.5 text-[12px] text-faint">
                        No projects yet — create one in Settings.
                      </div>
                    )}
                  </>
                )}
              </Menu>

              <Menu
                width={180}
                trigger={
                  <>
                    <StatusIcon status={status} size={13} />
                    {STATUS_META[status].label}
                  </>
                }
              >
                {(close) => (
                  <>
                    {STATUS_ORDER.map((option) => (
                      <MenuItem
                        key={option}
                        active={option === status}
                        onSelect={() => {
                          setStatus(option);
                          close();
                        }}
                      >
                        <StatusIcon status={option} size={13} />
                        {STATUS_META[option].label}
                      </MenuItem>
                    ))}
                  </>
                )}
              </Menu>

              <Menu
                width={180}
                trigger={
                  <>
                    <PriorityIcon priority={priority} size={13} />
                    {PRIORITY_META[priority].label}
                  </>
                }
              >
                {(close) => (
                  <>
                    {([4, 3, 2, 1, 0] as Priority[]).map((option) => (
                      <MenuItem
                        key={option}
                        active={option === priority}
                        onSelect={() => {
                          setPriority(option);
                          close();
                        }}
                      >
                        <PriorityIcon priority={option} size={13} />
                        {PRIORITY_META[option].label}
                      </MenuItem>
                    ))}
                  </>
                )}
              </Menu>

              <Menu
                width={220}
                trigger={
                  <>
                    {assigneeIds.length === 0 ? (
                      "Assignee…"
                    ) : (
                      <>
                        <AssigneeStack
                          assignees={members.filter((member) => assigneeIds.includes(member.id))}
                          size={16}
                        />
                        <span className="max-w-[140px] truncate">
                          {assigneeIds.length === 1
                            ? members.find((member) => member.id === assigneeIds[0])?.displayName ??
                              "Assignee"
                            : `${assigneeIds.length} assignees`}
                        </span>
                      </>
                    )}
                  </>
                }
              >
                {(close) => (
                  <>
                    <MenuItem
                      active={assigneeIds.length === 0}
                      onSelect={() => {
                        setAssigneeIds([]);
                        close();
                      }}
                    >
                      <span className="text-faint">—</span> Unassigned
                    </MenuItem>
                    <MenuItem
                      active={
                        members.length > 0 &&
                        members.every((member) => assigneeIds.includes(member.id))
                      }
                      onSelect={() => {
                        setAssigneeIds(members.map((member) => member.id));
                        close();
                      }}
                    >
                      <Users size={14} className="text-muted" /> Everyone
                    </MenuItem>
                    <div className="my-1 border-t border-border" />
                    {members.map((member) => {
                      const on = assigneeIds.includes(member.id);
                      return (
                        <MenuItem
                          key={member.id}
                          active={on}
                          onSelect={() =>
                            setAssigneeIds((ids) =>
                              on ? ids.filter((id) => id !== member.id) : [...ids, member.id]
                            )
                          }
                        >
                          <AssigneeAvatar
                            displayName={member.displayName}
                            avatar={member.avatar}
                            size={16}
                          />
                          {member.displayName}
                        </MenuItem>
                      );
                    })}
                  </>
                )}
              </Menu>

              <Menu
                width={220}
                trigger={
                  <>
                    <span>Labels</span>
                    {labelNames.length > 0 && (
                      <span className="text-faint">· {labelNames.length}</span>
                    )}
                  </>
                }
              >
                {() => (
                  <>
                    {labels.map((label) => {
                      const on = labelNames.includes(label.name);
                      return (
                        <MenuItem
                          key={label.id}
                          active={on}
                          onSelect={() => {
                            setLabelNames((names) =>
                              on
                                ? names.filter((n) => n !== label.name)
                                : [...names, label.name]
                            );
                          }}
                        >
                          <LabelPill name={label.name} color={label.color} small />
                        </MenuItem>
                      );
                    })}
                    {labels.length === 0 && (
                      <div className="px-2 py-1.5 text-[12px] text-faint">
                        No labels yet — create some on the Labels page.
                      </div>
                    )}
                  </>
                )}
              </Menu>

              <div className="ml-auto flex items-center gap-2">
                {error && <span className="text-[12px] text-danger">{error}</span>}
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={!title.trim() || !project || busy}
                  className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
                >
                  Create issue
                  <span className="ml-2 text-[11px] opacity-75">⌘↵</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
