"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { LoaderCircle, Sparkles, Users, X } from "lucide-react";
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
import { draftIssueAction } from "@/app/ai-actions";
import { STATUS_ORDER, type Priority, type Status } from "@/lib/constants";
import type { Label, Member, Project } from "@/lib/issues";
import { useT } from "@/components/i18n-context";

export function NewIssueDialog({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const { composerOpen, composerStatus, composerSeed, setComposerOpen, openIssue, aiReady } = useUI();
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
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    if (!composerOpen) return;
    setTitle(composerSeed?.title ?? "");
    setDescription(composerSeed?.description ?? "");
    setStatus(composerStatus ?? "todo");
    setPriority(0);
    setAssigneeIds([]);
    setLabelNames([]);
    setError(null);
    setBusy(false);
    setAiOpen(false);
    setAiPrompt("");
    setAiBusy(false);
    setAiError(null);
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
  }, [composerOpen, composerStatus, composerSeed, workspaceId, activeProjectId]);

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
      // Pages that opened the composer from a passage use this to drop the task
      // reference exactly where the passage was.
      composerSeed?.onCreated?.(result.data);
      setComposerOpen(false);
      openIssue(result.data.id);
    } else {
      setError(t(result.error));
    }
  }

  const project = projects.find((p) => p.id === projectId);

  async function aiDraft() {
    if (!aiPrompt.trim() || aiBusy) return;
    setAiBusy(true);
    setAiError(null);
    const result = await draftIssueAction(workspaceId, {
      prompt: aiPrompt,
      projectId: projectId || undefined,
    });
    setAiBusy(false);
    if (!result.ok) {
      setAiError(t(result.error));
      return;
    }
    const task = result.data;
    setTitle(task.title);
    setDescription(task.description);
    setPriority(task.priority);
    if (task.labels.length > 0) {
      setLabelNames((prev) => [...new Set([...prev, ...task.labels])]);
    }
    setAiOpen(false);
    setAiPrompt("");
  }

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
              {t("New task")}
              {project ? (
                <span className="ml-1 inline-flex items-center gap-1 text-muted">
                  <ProjectIcon color={project.color} icon={project.icon} size={12} />
                  {project.name}
                </span>
              ) : null}
            </span>
            <button
              type="button"
              onClick={() => setComposerOpen(false)}
              aria-label={t("Close")}
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
              placeholder={t("Issue title")}
              className="w-full bg-transparent text-[18px] font-semibold text-text placeholder:text-faint"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("Add description…")}
              rows={4}
              className="mt-2 w-full resize-none bg-transparent text-[13px] leading-relaxed text-muted placeholder:text-faint"
            />
            {aiReady && (
              <div className="mt-2">
                {aiOpen ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      autoFocus
                      value={aiPrompt}
                      onChange={(event) => setAiPrompt(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void aiDraft();
                        }
                        if (event.key === "Escape") setAiOpen(false);
                      }}
                      placeholder={t("Describe the task, e.g. 修复微信登录回调偶发失败")}
                      className="min-w-0 flex-1 rounded-md border border-border bg-elevated/40 px-2.5 py-1.5 text-[12.5px] text-text placeholder:text-faint focus:border-border-strong"
                    />
                    <button
                      type="button"
                      onClick={() => void aiDraft()}
                      disabled={!aiPrompt.trim() || aiBusy}
                      className="flex shrink-0 items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-[12px] font-medium text-white disabled:opacity-40"
                    >
                      {aiBusy ? <LoaderCircle size={11} className="animate-spin" /> : <Sparkles size={11} />}
                      {aiBusy ? t("Drafting…") : t("Draft")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAiOpen(false)}
                      aria-label={t("Close AI draft")}
                      className="shrink-0 rounded p-1 text-faint hover:bg-elevated hover:text-text"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAiOpen(true)}
                    className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-muted transition-colors hover:bg-elevated hover:text-text"
                  >
                    <Sparkles size={12} /> AI draft
                  </button>
                )}
                {aiError && <div className="mt-1 text-[11.5px] text-danger">{t(aiError)}</div>}
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Menu
                width={200}
                trigger={
                  <>
                    <span className="text-muted">{t("Project")}</span>
                    {project ? (
                      <span className="flex items-center gap-1 text-[12px] text-muted">
                        <ProjectIcon color={project.color} icon={project.icon} size={12} />
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
                        <ProjectIcon color={option.color} icon={option.icon} size={13} />
                        {option.name}
                      </MenuItem>
                    ))}
                    {projects.length === 0 && (
                      <div className="px-2 py-1.5 text-[12px] text-faint">
                        {t("No projects yet — create one in Settings.")}
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
                    {t(STATUS_META[status].label)}
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
                        {t(STATUS_META[option].label)}
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
                    {t(PRIORITY_META[priority].label)}
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
                        {t(PRIORITY_META[option].label)}
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
                      t("Assignee…")
                    ) : (
                      <>
                        <AssigneeStack
                          assignees={members.filter((member) => assigneeIds.includes(member.id))}
                          size={16}
                        />
                        <span className="max-w-[140px] truncate">
                          {assigneeIds.length === 1
                            ? members.find((member) => member.id === assigneeIds[0])?.displayName ??
                              t("Assignee")
                            : t("{count} assignees", { count: assigneeIds.length })}
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
                      <span className="text-faint">—</span> {t("Unassigned")}
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
                      <Users size={14} className="text-muted" /> {t("Everyone")}
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
                    <span>{t("Labels")}</span>
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
                        {t("No labels yet — create some on the Labels page.")}
                      </div>
                    )}
                  </>
                )}
              </Menu>

              <div className="ml-auto flex items-center gap-2">
                {error && <span className="text-[12px] text-danger">{t(error)}</span>}
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={!title.trim() || !project || busy}
                  className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
                >
                  {t("Create task")}
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
