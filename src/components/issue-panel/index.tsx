"use client";

import { useEffect, useRef, useState } from "react";
import { useLiveTick } from "@/components/live-refresh";
import { ISSUE_DELETED, useUI, type DeletedIssue } from "@/components/ui-context";
import { addCommentAction, addDependencyAction, createIssueAction, deleteIssueAction, removeDependencyAction, reportBlockerAction, updateIssueDetailAction } from "@/app/actions";
import type { Label, Member } from "@/lib/issues";
import { PanelHeader } from "./header";
import { PropertiesRow } from "./properties";
import { DueRow } from "./due-row";
import { Subtasks } from "./subtasks";
import { Dependencies } from "./dependencies";
import { BlockerReport } from "./blocker-report";
import { ClaimRow } from "./claim-row";
import { SourceChatRow } from "./source-chat-row";
import { AdvanceButton } from "./advance-button";
import { HandoffRow } from "./handoff-row";
import { DescriptionSection } from "./description";
import { ChangelogSection } from "./changelog";
import { CommentsSection } from "./comments";
import type { FlatDetail, IssuePatch } from "./types";
import { useT } from "@/components/i18n-context";

export function IssuePanelHost({
  workspaceId,
  currentUserId,
}: {
  workspaceId: string;
  currentUserId: string;
}) {
  const { openIssueId, closeIssue, panelExpanded, setPanelExpanded } = useUI();
  if (!openIssueId) return null;
  // Below ~600px of card width a side-by-side split leaves neither column usable, so
  // the panel becomes an opaque sheet over the list instead of a cramped second column.
  return (
    <aside
      className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-bg shadow-[0_1px_2px_rgba(0,0,0,0.05)] ${
        panelExpanded
          ? "min-w-0 flex-1"
          : "w-[min(50%,460px)] min-w-[280px] shrink-0 @max-[600px]:absolute @max-[600px]:inset-0 @max-[600px]:z-20 @max-[600px]:w-auto @max-[600px]:min-w-0"
      }`}
    >
      <IssuePanel
        key={openIssueId}
        workspaceId={workspaceId}
        currentUserId={currentUserId}
        id={openIssueId}
        onClose={closeIssue}
        expanded={panelExpanded}
        onToggleExpanded={() => setPanelExpanded(!panelExpanded)}
      />
    </aside>
  );
}

function IssuePanel({
  workspaceId,
  currentUserId,
  id,
  onClose,
  expanded,
  onToggleExpanded,
}: {
  workspaceId: string;
  currentUserId: string;
  id: string;
  onClose: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const t = useT();
  const [detail, setDetail] = useState<FlatDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [allLabels, setAllLabels] = useState<Label[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // A handed-off task just ended, and its result is a new comment.
  const [finished, setFinished] = useState(0);
  const { toast } = useUI();
  // H-COLLAB-13: reload the task when another member changes something.
  const live = useLiveTick();

  // A task that vanished underneath the panel (deleted here, on another device, or from
  // the Inbox) has nothing left to show — close the pane and say so instead of leaving
  // an empty "not found" card sitting in the split view.
  useEffect(() => {
    if (!notFound) return;
    toast(t("Task deleted — it is in Trash"));
    onClose();
  }, [notFound, toast, onClose, t]);

  const scrollToComposer = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  };

  // The panel is remounted per issue id, so loading state starts clean without resets here.
  useEffect(() => {
    if (live === 0 && finished === 0) return;
    let cancelled = false;
    fetch(`/api/internal/${workspaceId}/issues/${encodeURIComponent(id)}`)
      .then(async (res) => {
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return null;
        }
        return res.ok ? res.json() : null;
      })
      .then((data) => {
        if (!cancelled && data) {
          const row = data as FlatDetail;
          setDetail({
            ...row,
            children: row.children ?? [],
            dependencies: row.dependencies ?? [],
            blocked: row.blocked ?? false,
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [live, finished, id, workspaceId]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/internal/${workspaceId}/issues/${encodeURIComponent(id)}`)
      .then(async (res) => {
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (!cancelled && data) {
          const row = data as FlatDetail;
          setDetail({
            ...row,
            children: row.children ?? [],
            dependencies: row.dependencies ?? [],
            blocked: row.blocked ?? false,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load task");
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

  async function update(patch: IssuePatch) {
    if (!detail) return false;
    setBusy(true);
    const result = await updateIssueDetailAction(workspaceId, detail.id, patch);
    setBusy(false);
    if (result.ok) {
      setDetail({ ...result.data.issue, comments: result.data.comments, events: result.data.events, children: result.data.children, dependencies: result.data.dependencies, blocked: result.data.blocked });
      return true;
    }
    setError(result.error);
    return false;
  }

  async function addSubtask(title: string) {
    if (!detail || busy) return false;
    setBusy(true);
    const result = await createIssueAction(workspaceId, {
      title,
      project: detail.projectKey,
      parent: detail.id,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    setDetail({
      ...detail,
      children: [
        ...detail.children,
        {
          id: result.data.id,
          identifier: result.data.identifier,
          title: result.data.title,
          status: result.data.status,
        },
      ],
    });
    return true;
  }

  async function addTaskDependency(identifier: string) {
    if (!detail || busy) return false;
    setBusy(true);
    const result = await addDependencyAction(workspaceId, detail.id, identifier);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    setDetail({
      ...result.data.issue,
      comments: result.data.comments,
      events: result.data.events,
      children: result.data.children,
      dependencies: result.data.dependencies,
      blocked: result.data.blocked,
    });
    return true;
  }

  async function removeTaskDependency(identifier: string) {
    if (!detail || busy) return false;
    setBusy(true);
    const result = await removeDependencyAction(workspaceId, detail.id, identifier);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    setDetail({
      ...result.data.issue,
      comments: result.data.comments,
      events: result.data.events,
      children: result.data.children,
      dependencies: result.data.dependencies,
      blocked: result.data.blocked,
    });
    return true;
  }

  async function submitBlocker(body: string) {
    if (!detail || busy) return false;
    setBusy(true);
    const result = await reportBlockerAction(workspaceId, detail.id, body);
    setBusy(false);
    if (result.ok) {
      setDetail({ ...result.data.issue, comments: result.data.comments, events: result.data.events, children: result.data.children, dependencies: result.data.dependencies, blocked: result.data.blocked });
      return true;
    }
    setError(result.error);
    return false;
  }

  async function submitComment() {
    if (!detail || !comment.trim() || busy) return;
    setBusy(true);
    const result = await addCommentAction(workspaceId, detail.id, comment);
    setBusy(false);
    if (result.ok) {
      setComment("");
      setDetail({ ...result.data.issue, comments: result.data.comments, events: result.data.events, children: result.data.children, dependencies: result.data.dependencies, blocked: result.data.blocked });
      requestAnimationFrame(scrollToComposer);
    } else {
      setError(result.error);
    }
  }

  async function remove() {
    if (!detail) return;
    const result = await deleteIssueAction(workspaceId, detail.id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Documents that reference this task turn the chip back into text right away,
    // rather than waiting for the refreshed page to replace the task list.
    window.dispatchEvent(
      new CustomEvent<DeletedIssue>(ISSUE_DELETED, {
        detail: { id: result.data, identifier: detail.identifier, title: detail.title },
      })
    );
    toast(t("Task deleted — it is in Trash"));
    onClose();
  }

  if (notFound) {
    return <div className="flex-1 p-5 text-body text-muted">{t("Loading…")}</div>;
  }

  if (!detail) {
    return <div className="flex-1 p-5 text-body text-muted">{t("Loading…")}</div>;
  }

  const comments = [...detail.comments].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  );
  // "commented" events duplicate the comment bodies above, so the changelog only
  // carries the field changes and state transitions.
  const changelog = detail.events
    .filter((event) => event.type !== "commented")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const canChangeStatus = detail.assignees.some(
    (assignee) => assignee.id === currentUserId
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelHeader
        detail={detail}
        canChangeStatus={canChangeStatus}
        onUpdate={update}
        onRemove={() => void remove()}
        onClose={onClose}
        expanded={expanded}
        onToggleExpanded={onToggleExpanded}
      />

      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col space-y-5 overflow-y-auto p-4">
        <input
          key={`${detail.id}-title`}
          defaultValue={detail.title}
          placeholder={t("Task title")}
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
          className="w-full bg-transparent text-title font-semibold text-text"
        />

        <PropertiesRow
          detail={detail}
          members={members}
          allLabels={allLabels}
          onUpdate={update}
        />

        <ClaimRow
          workspaceId={workspaceId}
          detail={detail}
          members={members}
          currentUserId={currentUserId}
          onDetail={(next) => setDetail({ ...next.issue, comments: next.comments, events: next.events, children: next.children, dependencies: next.dependencies, blocked: next.blocked })}
          onError={setError}
        />

        <AdvanceButton
          workspaceId={workspaceId}
          detail={detail}
          currentUserId={currentUserId}
          onClaimed={() => setDetail({ ...detail, claimedBy: currentUserId })}
          onError={setError}
        />

        <HandoffRow
          workspaceId={workspaceId}
          detail={detail}
          currentUserId={currentUserId}
          onFinished={() => setFinished((count) => count + 1)}
        />

        <SourceChatRow workspaceId={workspaceId} threadId={detail.sourceThreadId} />

        <DueRow detail={detail} onUpdate={update} />

        <Subtasks children={detail.children} busy={busy} onAdd={addSubtask} />

        <Dependencies
          dependencies={detail.dependencies}
          blocked={detail.blocked}
          busy={busy}
          onAdd={addTaskDependency}
          onRemove={removeTaskDependency}
        />

        <BlockerReport events={detail.events} busy={busy} onSubmit={submitBlocker} />

        <DescriptionSection
          workspaceId={workspaceId}
          issueId={id}
          description={detail.description}
          onUpdate={update}
        />

        <div className="shrink-0 space-y-2 border-t border-border pt-4">
          <ChangelogSection events={changelog} />
          <CommentsSection
            members={members}
            comments={comments}
            comment={comment}
            busy={busy}
            onCommentChange={setComment}
            onSubmit={() => void submitComment()}
          />
        </div>

        {error && <div className="text-small text-danger">{t(error)}</div>}
      </div>
    </div>
  );
}
