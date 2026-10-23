"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import {
  addProjectMemberAction,
  removeProjectMemberAction,
  updateProjectAction,
} from "@/app/actions";
import { StatusIcon } from "@/components/icons";
import { AssigneeAvatar } from "@/components/issue-table";
import { Menu, MenuItem } from "@/components/menu";
import { MarkdownEditor } from "@/components/markdown-editor";
import { useUI } from "@/components/ui-context";
import { STATUS_META, STATUS_ORDER, type Status } from "@/lib/constants";
import type { Member, Project, ProjectMember } from "@/lib/issues";

type Counts = Record<Status, number> & { total: number };
type ProjectDetail = Project & { doc: string; createdBy: string | null };

export function ProjectOverview({
  workspaceId,
  project,
  counts,
  members,
  workspaceMembers,
  onFilterStatus,
}: {
  workspaceId: string;
  project: ProjectDetail;
  counts: Counts;
  members: ProjectMember[];
  workspaceMembers: Member[];
  onFilterStatus: (status: Status) => void;
}) {
  const router = useRouter();
  const { setComposerOpen } = useUI();
  const [summary, setSummary] = useState(project.description);
  const [doc, setDoc] = useState(project.doc);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function save(patch: { description?: string; doc?: string }) {
    setError(null);
    const result = await updateProjectAction(workspaceId, project.id, patch);
    if (!result.ok) setError(result.error);
    return result.ok;
  }

  function flushDoc() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    if (next === null) return;
    pending.current = null;
    setSaved(false);
    void save({ doc: next }).then((ok) => ok && setSaved(true));
  }

  // Notion writes quietly in the background. One request per keystroke would make the
  // document feel like it was fighting the network, so typing only schedules a write.
  function editDoc(next: string) {
    setDoc(next);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flushDoc, 700);
  }

  // Leaving the page inside the debounce window must not lose the last edit, so the
  // unmount path writes whatever is still pending straight through.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      const next = pending.current;
      pending.current = null;
      if (next !== null) void updateProjectAction(workspaceId, project.id, { doc: next });
    },
    [workspaceId, project.id]
  );

  function saveSummary() {
    const trimmed = summary.trim();
    if (trimmed === project.description.trim()) return;
    void save({ description: trimmed }).then((ok) => ok && router.refresh());
  }

  const lead = members.find((member) => member.role === "lead") ?? null;
  const others = members.filter((member) => member.role !== "lead");
  const candidates = workspaceMembers.filter(
    (member) => !members.some((m) => m.id === member.id)
  );

  async function changeMember(userId: string, add: boolean) {
    setError(null);
    const result = add
      ? await addProjectMemberAction(workspaceId, project.id, userId)
      : await removeProjectMemberAction(workspaceId, project.id, userId);
    if (!result.ok) setError(result.error);
    else router.refresh();
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-5 py-6">
        <input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          onBlur={saveSummary}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setSummary(project.description);
          }}
          placeholder="Add a one-line summary…"
          aria-label="Project summary"
          className="w-full rounded-md bg-transparent text-[15px] font-medium text-muted placeholder:text-faint hover:bg-elevated/40 focus:bg-bg focus:text-text focus:outline-none"
        />
        {error && <div className="mt-2 text-[12px] text-danger">{error}</div>}

        <div className="mt-6 space-y-2.5 text-[13px]">
          <div className="flex items-center gap-3">
            <span className="w-20 shrink-0 text-[12.5px] text-faint">Properties</span>
            <span className="shrink-0 text-muted">
              {counts.total} {counts.total === 1 ? "issue" : "issues"}
            </span>
            {lead && (
              <span
                className="flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-border bg-elevated/40 py-0.5 pl-0.5 pr-2 text-[12px] text-text"
                title="Project lead"
              >
                <AssigneeAvatar
                  displayName={lead.displayName}
                  avatar={lead.avatar}
                  size={18}
                />
                {lead.displayName}
              </span>
            )}
            {others.map((member) => (
              <span
                key={member.id}
                className="group flex shrink-0 items-center gap-1.5 rounded-full border border-border py-0.5 pl-0.5 pr-1.5 text-[12px] text-muted"
              >
                <AssigneeAvatar
                  displayName={member.displayName}
                  avatar={member.avatar}
                  size={18}
                />
                {member.displayName}
                <button
                  type="button"
                  aria-label={`Remove ${member.displayName}`}
                  onClick={() => void changeMember(member.id, false)}
                  className="text-faint transition-colors hover:text-danger group-hover:opacity-100"
                >
                  <X size={11} />
                </button>
              </span>
            ))}
            <Menu
              width={220}
              triggerClassName="flex h-[22px] shrink-0 items-center gap-1 rounded-full border border-dashed border-border px-2 text-[12px] text-muted transition-colors hover:border-border-strong hover:text-text"
              trigger={
                <>
                  <span className="sr-only">Add member</span>
                  <Plus size={12} />
                </>
              }
            >
              {(close) => (
                <>
                  {candidates.map((member) => (
                    <MenuItem
                      key={member.id}
                      onSelect={() => {
                        close();
                        void changeMember(member.id, true);
                      }}
                    >
                      <AssigneeAvatar
                        displayName={member.displayName}
                        avatar={member.avatar}
                        size={18}
                      />
                      {member.displayName}
                    </MenuItem>
                  ))}
                  {candidates.length === 0 && (
                    <div className="px-2 py-1.5 text-[12px] text-faint">
                      Everyone in the workspace already joined.
                    </div>
                  )}
                </>
              )}
            </Menu>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-20 shrink-0 text-[12.5px] text-faint">By status</span>
            <span className="flex flex-wrap items-center gap-1.5">
              {STATUS_ORDER.map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => onFilterStatus(status)}
                  className="flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[12px] text-muted transition-colors hover:border-border-strong hover:text-text"
                >
                  <StatusIcon status={status} size={12} />
                  {STATUS_META[status].label}
                  <span className="text-faint">{counts[status]}</span>
                </button>
              ))}
            </span>
          </div>
        </div>

        <div className="mt-8 border-t border-border pt-5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-[13px] font-semibold text-muted">Description</h2>
            <div className="flex items-center gap-2.5">
              <span
                className={`text-[11.5px] text-faint transition-opacity duration-300 ${
                  saved ? "opacity-100" : "opacity-0"
                }`}
              >
                Saved
              </span>
              <button
                type="button"
                onClick={() => setComposerOpen(true)}
                className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[12px] font-medium text-muted transition-colors hover:border-border-strong hover:text-text"
              >
                <Plus size={13} /> New issue
              </button>
            </div>
          </div>
          <MarkdownEditor value={doc} onChange={editDoc} />
        </div>
      </div>
    </div>
  );
}
