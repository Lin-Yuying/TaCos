"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DetailNavigation } from "@/components/detail-navigation";
import { useScrollMemory } from "@/lib/ui/scroll-memory";
import { useLiveTick } from "@/components/live-refresh";
import { ISSUE_DELETED, useUI, type DeletedIssue } from "@/components/ui-context";
import { getIssueDetailAction, addCommentAction, addDependencyAction, createIssueAction, removeDependencyAction, reportBlockerAction, deleteIssueAction, restoreIssueAction, changeIssueCollectionAction, updateIssueDetailAction } from "@/app/actions";
import type { Label, Member } from "@/lib/issues";
import { EditableTitle } from "@/components/ui/editable-title";
import { readJson, RequestError } from "@/lib/ui/request";
import { useDraft } from "@/lib/ui/draft-store";
import { PanelHeader } from "./header";
import { PropertiesRow } from "./properties";
import { DueRow } from "./due-row";
import { RecurrenceRow } from "./recurrence-row";
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
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-bg"
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
  const [attempt, setAttempt] = useState(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const request = useRef(0);
  const [allLabels, setAllLabels] = useState<Label[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [comment, setComment] = useDraft("task-comment", id, "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const requestedComment=useSearchParams().get("comment");
  useScrollMemory(scrollRef,`task.${id}`,undefined,!!detail&&!requestedComment);
  const locatedComment=useRef<string|null>(null);
  useEffect(()=>{if(!detail||!requestedComment||locatedComment.current===requestedComment)return;const target=scrollRef.current?.querySelector<HTMLElement>(`[data-comment-id="${CSS.escape(requestedComment)}"]`);if(target){locatedComment.current=requestedComment;target.scrollIntoView({block:"center"});target.focus();}},[requestedComment,detail]);
  // A handed-off task just ended, and its result is a new comment.
  const [finished, setFinished] = useState(0);
  const { toast, confirm } = useUI();
  // H-COLLAB-13: reload the task when another member changes something.
  const live = useLiveTick();

  const scrollToComposer = () => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; };
  useEffect(() => {
    const controller = new AbortController();
    const seq = request.current;
    void readJson(`/api/internal/${workspaceId}/issues/${encodeURIComponent(id)}`, (data): data is FlatDetail => !!data && typeof data === "object" && typeof (data as FlatDetail).id === "string" && Array.isArray((data as FlatDetail).comments) && Array.isArray((data as FlatDetail).labels), controller.signal)
      .then((data) => { if (!controller.signal.aborted && seq === request.current) {setDetail(data);setError(null);} })
      .catch((err) => { if (!controller.signal.aborted) {if (err instanceof RequestError && err.status === 404) {toast(t("Task deleted — it is in Trash"));onClose();} else {if (err instanceof RequestError && err.status === 403) setDetail(null);setError(err.message);}} });
    for (const kind of ["labels", "members"] as const) {
      void readJson(`/api/internal/${workspaceId}/${kind}`, (data): data is Label[] & Member[] => Array.isArray(data), controller.signal)
        .then((data) => {if(!controller.signal.aborted) {if(kind === "labels")setAllLabels(data);else setMembers(data);} })
        .catch((err) => {if(!controller.signal.aborted)setError(err.message);});
    }
    return () => controller.abort();
  }, [id, workspaceId, live, finished, attempt]);

  async function mutate(work: () => ReturnType<typeof updateIssueDetailAction>) {
    const seq = ++request.current; setBusy(true); setError(null);
    const pending = queue.current.then(work); queue.current = pending.catch(() => {});
    try {
      const result = await pending;
      if (!result.ok) {setError(result.error);return false;}
      if (seq === request.current) setDetail({...result.data.issue,comments:result.data.comments,events:result.data.events,children:result.data.children,dependencies:result.data.dependencies,blocked:result.data.blocked});
      return true;
    } catch {setError("Could not save. Retry.");return false;}
    finally {if(seq === request.current)setBusy(false);}
  }
  async function update(patch: IssuePatch) { return mutate(() => updateIssueDetailAction(workspaceId,id,patch)); }
  function changeCollection(change: {kind:"assignee"|"label";value:string;selected:boolean}) {
    setDetail((current) => {
      if(!current)return current;
      if(change.kind === "assignee") {
        const person=members.find((member)=>member.id===change.value);
        return {...current,assignees:change.selected && person ? [...current.assignees.filter((p)=>p.id!==change.value),person] : current.assignees.filter((p)=>p.id!==change.value)};
      }
      const label=allLabels.find((label)=>label.name===change.value);
      return {...current,labels:change.selected && label ? [...current.labels.filter((l)=>l.name!==change.value),label] : current.labels.filter((l)=>l.name!==change.value)};
    });
    void mutate(() => changeIssueCollectionAction(workspaceId,id,change));
  }

  async function addSubtask(title: string) {
    if (!detail) return false;
    return mutate(async () => {
      const result = await createIssueAction(workspaceId, { title, project: detail!.projectKey, parent: detail.id });
      if (!result.ok) return result;
      return getIssueDetailAction(workspaceId, id);
    });
  }
  async function addTaskDependency(identifier: string) {
    return mutate(() => addDependencyAction(workspaceId, id, identifier));
  }
  async function removeTaskDependency(identifier: string) {
    return mutate(() => removeDependencyAction(workspaceId, id, identifier));
  }

  async function submitBlocker(body: string) { return mutate(() => reportBlockerAction(workspaceId,id,body)); }

  async function submitComment() {
    if (!detail || !comment.trim() || busy) return;
    setBusy(true);
    try {
    const result = await addCommentAction(workspaceId, detail.id, comment);
    if (result.ok) {
      setComment("");
      setDetail({ ...result.data.issue, comments: result.data.comments, events: result.data.events, children: result.data.children, dependencies: result.data.dependencies, blocked: result.data.blocked });
      requestAnimationFrame(scrollToComposer);
    } else {
      setError(result.error);
    }
    }catch{setError("Could not save. Retry.");}finally{setBusy(false);}
  }

  async function remove() {
    if (!detail || !(await confirm(t("Move “{title}” to Trash?", {title:detail.title})))) return;
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
    toast(t("Task deleted — it is in Trash"), {label:t("Undo"),run:async()=>{const result=await restoreIssueAction(workspaceId,id);if(!result.ok)toast(t(result.error));}});
    onClose();
  }

  if (!detail) return <div className="flex flex-1 flex-col items-center justify-center gap-3 p-5 text-body text-muted"><p role={error ? "alert" : "status"}>{error ? t(error) : t("Loading…")}</p>{error && <button onClick={()=>{setError(null);setAttempt((n)=>n+1);}}>{t("Retry")}</button>}<button onClick={onClose}>{t("Close")}</button></div>;

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
      <div className="border-b border-border px-3 py-1"><DetailNavigation kind="task" id={id} workspaceId={workspaceId} panel/></div>
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
        {error && <div role="alert" className="text-small text-danger">{t(error)} <button onClick={()=>setAttempt((n)=>n+1)}>{t("Retry")}</button></div>}
        <EditableTitle id={`task.${id}`} value={detail.title} onSave={(title)=>update({title})}/>
        <button className="self-start text-small text-muted" onClick={scrollToComposer}>{t("Write a comment")}</button>

        <PropertiesRow
          detail={detail}
          members={members}
          allLabels={allLabels}
          onCollection={changeCollection}
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

        <RecurrenceRow detail={detail} onUpdate={update} />

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
