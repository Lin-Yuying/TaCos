"use client";

import { useEffect, useState } from "react";
import { Lock, Trash2, Users } from "lucide-react";
import { useUI } from "@/components/ui-context";
import { Menu, MenuItem } from "@/components/menu";
import {
  LabelPill,
  PRIORITY_META,
  PriorityIcon,
  STATUS_META,
  StatusIcon,
  ViaBadge,
} from "@/components/icons";
import { AssigneeAvatar, AssigneeStack } from "@/components/issue-table";
import {
  addCommentAction,
  deleteIssueAction,
  updateIssueDetailAction,
} from "@/app/actions";
import {
  STATUS_ORDER,
  type Priority,
  type Status,
} from "@/lib/constants";
import type { ActivityEvent, Comment, Issue, Label, Member } from "@/lib/issues";
import { formatDate, issueRef, timeAgo } from "@/lib/format";

type FlatDetail = Issue & {
  labels: Label[];
  comments: Comment[];
  events: ActivityEvent[];
};

function actorName(entry: { actor: { displayName: string } | null; agentActor: string | null }): string {
  if (entry.actor) return entry.actor.displayName;
  if (entry.agentActor === "mcp") return "MCP agent";
  if (entry.agentActor?.startsWith("api:")) return `API · ${entry.agentActor.slice(4)}`;
  return entry.agentActor ? "Agent" : "Deleted user";
}

function commentAuthorName(comment: Comment): string {
  return actorName({ actor: comment.author, agentActor: comment.agentAuthor });
}

export function IssuePanelHost({
  workspaceId,
  currentUserId,
}: {
  workspaceId: string;
  currentUserId: string;
}) {
  const { openIssueId, closeIssue } = useUI();
  if (!openIssueId) return null;
  return (
    <aside className="flex w-[460px] shrink-0 flex-col border-l border-border bg-surface/60">
      <IssuePanel
        workspaceId={workspaceId}
        currentUserId={currentUserId}
        id={openIssueId}
        onClose={closeIssue}
      />
    </aside>
  );
}

function eventText(event: ActivityEvent): string | null {
  switch (event.type) {
    case "created":
      return "created the issue";
    case "status_changed": {
      const from = event.data.from as Status;
      const to = event.data.to as Status;
      return `moved ${STATUS_META[from]?.label ?? from} → ${STATUS_META[to]?.label ?? to}`;
    }
    case "priority_changed": {
      const to = event.data.to as Priority;
      return `set priority to ${PRIORITY_META[to]?.label ?? to}`;
    }
    case "title_changed":
      return `renamed to “${String(event.data.to ?? "").slice(0, 48)}”`;
    case "description_changed":
      return "updated the description";
    case "assignee_changed": {
      const to = event.data.to;
      const names = Array.isArray(to) ? to.map(String) : [String(to ?? "")];
      const label = names.filter(Boolean).join(", ");
      return label ? `assigned to ${label}` : "unassigned";
    }
    case "labels_changed": {
      const added = (event.data.added as string[]) ?? [];
      const removed = (event.data.removed as string[]) ?? [];
      const parts = [
        ...added.map((name) => `+${name}`),
        ...removed.map((name) => `−${name}`),
      ];
      return parts.length > 0 ? `labels ${parts.join(", ")}` : null;
    }
    default:
      return null;
  }
}

function IssuePanel({
  workspaceId,
  currentUserId,
  id,
  onClose,
}: {
  workspaceId: string;
  currentUserId: string;
  id: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<FlatDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [allLabels, setAllLabels] = useState<Label[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    fetch(`/api/internal/${workspaceId}/issues/${encodeURIComponent(id)}`)
      .then(async (res) => {
        if (res.status === 404) {
          setNotFound(true);
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (data) setDetail(data as FlatDetail);
      })
      .catch(() => setError("Failed to load issue"));

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setNotFound(false);
    setError(null);
    fetch(`/api/internal/${workspaceId}/issues/${encodeURIComponent(id)}`)
      .then(async (res) => {
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (!cancelled && data) setDetail(data as FlatDetail);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load issue");
      });
    fetch(`/api/internal/${workspaceId}/labels`)
      .then((res) => res.json())
      .then((data) => !cancelled && setAllLabels(data as Label[]))
      .catch(() => {});
    fetch(`/api/internal/${workspaceId}/members`)
      .then((res) => res.json())
      .then((data) => !cancelled && setMembers(data as Member[]))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id, workspaceId]);

  async function update(patch: Parameters<typeof updateIssueDetailAction>[2]) {
    if (!detail) return;
    setBusy(true);
    const result = await updateIssueDetailAction(workspaceId, detail.id, patch);
    setBusy(false);
    if (result.ok) {
      setDetail({ ...result.data.issue, comments: result.data.comments, events: result.data.events });
    } else {
      setError(result.error);
    }
  }

  async function submitComment() {
    if (!detail || !comment.trim() || busy) return;
    setBusy(true);
    const result = await addCommentAction(workspaceId, detail.id, comment);
    setBusy(false);
    if (result.ok) {
      setComment("");
      setDetail({ ...result.data.issue, comments: result.data.comments, events: result.data.events });
    } else {
      setError(result.error);
    }
  }

  async function remove() {
    if (!detail) return;
    await deleteIssueAction(workspaceId, detail.id);
    onClose();
  }

  if (notFound) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-[13px] text-muted">
        Issue not found — it may have been deleted.
        <button type="button" onClick={onClose} className="text-accent hover:underline">
          Close
        </button>
      </div>
    );
  }

  if (!detail) {
    return <div className="flex-1 p-5 text-[13px] text-muted">Loading…</div>;
  }

  const timeline: Array<
    { kind: "comment"; item: Comment } | { kind: "event"; item: ActivityEvent }
  > = [
    ...detail.comments.map((item) => ({ kind: "comment" as const, item })),
    ...detail.events
      .filter((e) => e.type !== "commented")
      .map((item) => ({ kind: "event" as const, item })),
  ].sort((a, b) => a.item.createdAt.localeCompare(b.item.createdAt));

  const currentLabelNames = detail.labels.map((l) => l.name);
  const allAssigned = members.every((member) =>
    detail.assignees.some((assignee) => assignee.id === member.id)
  );
  const canChangeStatus =
    detail.createdBy === currentUserId ||
    detail.assignees.some((assignee) => assignee.id === currentUserId) ||
    // Agent-created issues with nobody assigned have no owner to protect; mirrors
    // the server-side rule in updateIssue.
    (!detail.createdBy && detail.assignees.length === 0);
  void load;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <span className="max-w-[240px] truncate font-mono text-[12px] text-faint">
          {issueRef(detail)}
        </span>
        {canChangeStatus ? (
          <Menu
            width={180}
            trigger={
              <>
                <StatusIcon status={detail.status} size={13} />
                {STATUS_META[detail.status].label}
              </>
            }
          >
            {(close) => (
              <>
                {STATUS_ORDER.map((status) => (
                  <MenuItem
                    key={status}
                    active={status === detail.status}
                    onSelect={() => {
                      close();
                      void update({ status });
                    }}
                  >
                    <StatusIcon status={status} size={13} />
                    {STATUS_META[status].label}
                  </MenuItem>
                ))}
              </>
            )}
          </Menu>
        ) : (
          <span
            title="Only the issue's creator or assignees can change its status"
            className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[13px] text-muted"
          >
            <StatusIcon status={detail.status} size={13} />
            {STATUS_META[detail.status].label}
            <Lock size={11} className="text-faint" />
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => void remove()}
            aria-label="Move to Trash"
            title="Move to Trash"
            className="rounded-md p-1.5 text-muted transition-colors hover:bg-elevated hover:text-danger"
          >
            <Trash2 size={15} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-1.5 py-1 text-[16px] leading-none text-muted transition-colors hover:bg-elevated hover:text-text"
            aria-label="Close panel"
          >
            ×
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        <input
          key={`${detail.id}-title`}
          defaultValue={detail.title}
          placeholder="Issue title"
          onBlur={(e) => {
            const title = e.target.value.trim();
            if (title && title !== detail.title) void update({ title });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          className="w-full bg-transparent text-[17px] font-semibold text-text"
        />

        <div className="flex flex-wrap items-center gap-2">
          <Menu
            width={180}
            trigger={
              <>
                <PriorityIcon priority={detail.priority} size={13} />
                {PRIORITY_META[detail.priority].label}
              </>
            }
          >
            {(close) => (
              <>
                {([4, 3, 2, 1, 0] as Priority[]).map((priority) => (
                  <MenuItem
                    key={priority}
                    active={priority === detail.priority}
                    onSelect={() => {
                      close();
                      void update({ priority });
                    }}
                  >
                    <PriorityIcon priority={priority} size={13} />
                    {PRIORITY_META[priority].label}
                  </MenuItem>
                ))}
              </>
            )}
          </Menu>

          <Menu
            width={220}
            trigger={
              <>
                {detail.assignees.length === 0 ? (
                  "Assignee…"
                ) : (
                  <>
                    <AssigneeStack assignees={detail.assignees} size={16} />
                    <span className="max-w-[140px] truncate">
                      {detail.assignees.length === 1
                        ? detail.assignees[0].displayName
                        : `${detail.assignees.length} assignees`}
                    </span>
                  </>
                )}
              </>
            }
          >
            {(close) => (
              <>
                <MenuItem
                  active={detail.assignees.length === 0}
                  onSelect={() => {
                    close();
                    void update({ assigneeIds: [] });
                  }}
                >
                  <span className="text-faint">—</span> Unassigned
                </MenuItem>
                <MenuItem
                  active={members.length > 0 && allAssigned}
                  onSelect={() => {
                    close();
                    void update({ assigneeIds: members.map((member) => member.id) });
                  }}
                >
                  <Users size={14} className="text-muted" /> Everyone
                </MenuItem>
                <div className="my-1 border-t border-border" />
                {members.map((member) => {
                  const on = detail.assignees.some((assignee) => assignee.id === member.id);
                  return (
                    <MenuItem
                      key={member.id}
                      active={on}
                      onSelect={() => {
                        const next = on
                          ? detail.assignees
                              .filter((assignee) => assignee.id !== member.id)
                              .map((assignee) => assignee.id)
                          : [...detail.assignees.map((assignee) => assignee.id), member.id];
                        void update({ assigneeIds: next });
                      }}
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
                <span className="text-muted">Labels</span>
                {detail.labels.length > 0 && (
                  <span className="text-faint">· {detail.labels.length}</span>
                )}
              </>
            }
          >
            {() => (
              <>
                {allLabels.map((label) => {
                  const on = currentLabelNames.includes(label.name);
                  return (
                    <MenuItem
                      key={label.id}
                      active={on}
                      onSelect={() => {
                        const next = on
                          ? currentLabelNames.filter((n) => n !== label.name)
                          : [...currentLabelNames, label.name];
                        void update({ labelNames: next });
                      }}
                    >
                      <LabelPill name={label.name} color={label.color} small />
                    </MenuItem>
                  );
                })}
                {allLabels.length === 0 && (
                  <div className="px-2 py-1.5 text-[12px] text-faint">
                    No labels yet — create some on the Labels page.
                  </div>
                )}
              </>
            )}
          </Menu>

          <div className="ml-auto flex items-center gap-2 text-[12px] text-faint">
            <ViaBadge via={detail.createdVia} />
            created {formatDate(detail.createdAt)}
          </div>
        </div>

        <textarea
          key={`${detail.id}-${detail.updatedAt}-desc`}
          defaultValue={detail.description}
          placeholder="Add a description…"
          rows={3}
          onBlur={(e) => {
            if (e.target.value !== detail.description) void update({ description: e.target.value });
          }}
          className="w-full resize-y rounded-md bg-transparent text-[13px] leading-relaxed text-muted placeholder:text-faint"
        />

        <div className="space-y-2 border-t border-border pt-4">
          <div className="rounded-lg border border-border bg-elevated/40 p-2">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  void submitComment();
                }
              }}
              placeholder="Leave a comment…"
              rows={2}
              className="w-full resize-none bg-transparent text-[13px] text-text placeholder:text-faint"
            />
            <div className="flex justify-end pt-1">
              <button
                type="button"
                disabled={!comment.trim() || busy}
                onClick={() => void submitComment()}
                className="rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
              >
                Comment
              </button>
            </div>
          </div>

          {timeline.map((entry) =>
            entry.kind === "comment" ? (
              <div key={entry.item.id} className="px-1 py-1">
                <div className="flex items-baseline gap-2">
                  {entry.item.author ? (
                    <AssigneeAvatar
                      displayName={entry.item.author.displayName}
                      avatar={entry.item.author.avatar}
                      size={16}
                    />
                  ) : null}
                  <span className="text-[12px] font-medium text-muted">
                    {commentAuthorName(entry.item)}
                  </span>
                  <span suppressHydrationWarning className="text-[11px] text-faint">
                    {timeAgo(entry.item.createdAt)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-text">
                  {entry.item.body}
                </p>
              </div>
            ) : (
              (() => {
                const text = eventText(entry.item);
                if (!text) return null;
                return (
                  <div key={entry.item.id} className="flex items-baseline gap-2 px-1">
                    <span className="text-[12px] text-faint">
                      <span className="text-muted">{actorName(entry.item)}</span> {text}
                    </span>
                    <span suppressHydrationWarning className="text-[11px] text-faint">
                      {timeAgo(entry.item.createdAt)}
                    </span>
                  </div>
                );
              })()
            )
          )}
        </div>

        {error && <div className="text-[12px] text-danger">{error}</div>}
      </div>
    </div>
  );
}
