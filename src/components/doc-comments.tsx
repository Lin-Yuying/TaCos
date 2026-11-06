"use client";

import { useDraft } from "@/lib/ui/draft-store";
import { useEffect, useRef, useState } from "react";
import { SidePanel } from "@/components/ui/side-panel";
import { editPageCommentAction, restorePageCommentAction } from "@/app/pages-actions";
import { Check, MessageSquare, RotateCcw, Trash2, X } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { AssigneeAvatar } from "@/components/issue-table";
import { MentionBox } from "@/components/mention-box";
import { useLocale, useT } from "@/components/i18n-context";
import { timeAgo } from "@/lib/format";
import type { DocAnchor } from "@/lib/doc-anchor";
import type { Member } from "@/lib/issues";
import type { PageComment } from "@/lib/page-comments";

export function DocCommentsPanel({
  comments,
  workspaceId,
  onChanged,
  onReload,
  loadError,
  loading,
  pageId,
  members,
  userId,
  isOwner,
  canComment,
  compact,
  located,
  draftAnchor,
  active,
  busy,
  onAdd,
  onResolve,
  onRemove,
  onSelect,
  onClearDraft,
  onClose,
}: {
  workspaceId:string;
  onChanged:(comments:PageComment[])=>void;
  onReload:()=>void;
  loadError:string|null;
  loading:boolean;
  comments: PageComment[];
  pageId: string;
  members: Member[];
  userId: string | null;
  isOwner: boolean;
  canComment: boolean;
  compact: boolean;
  // Comments whose quote can still be found in the text.
  located: Set<string>;
  draftAnchor: DocAnchor | null;
  active: string | null;
  busy: boolean;
  onAdd: (body: string,parentId?:string) => Promise<boolean>;
  onResolve: (id: string, resolved: boolean) => void;
  onRemove: (id: string) => void;
  onSelect: (id: string) => void;
  onClearDraft: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [draft,setDraft]=useDraft<{body:string;parentId:string|null}>("document-comment-v2",`${pageId}.${draftAnchor?.quote??"document"}`,{body:"",parentId:null});
  const body=draft.body,replyTo=draft.parentId;
  const setBody=(body:string)=>setDraft(old=>({...old,body}));
  const setReplyTo=(parentId:string|null)=>setDraft(old=>({...old,parentId}));
  const [editDraft,setEditDraft]=useDraft<{id:string|null;body:string}>("document-comment-edit-v2",pageId,{id:null,body:""});
  const editId=editDraft.id,editBody=editDraft.body;
  const setEditId=(id:string|null)=>setEditDraft(old=>({...old,id}));
  const setEditBody=(body:string)=>setEditDraft(old=>({...old,body}));
  const [actionError,setActionError]=useState<string|null>(null),[pending,setPending]=useState(false);
  const list=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(active)list.current?.querySelector(`[data-comment-id="${CSS.escape(active)}"]`)?.scrollIntoView({block:"nearest"});},[active,comments]);
  async function change(work:()=>Promise<{ok:boolean;data?:PageComment[];error?:string}>){if(pending)return;setPending(true);try{const result=await work();if(!result.ok){setActionError(result.error??"Could not save. Retry.");return;}if(result.data)onChanged(result.data);setEditId(null);setActionError(null);}catch{setActionError("Could not save. Retry.");}finally{setPending(false);}}
  const [showResolved, setShowResolved] = useState(false);
  const open = comments.filter((comment) => !comment.resolvedAt);
  const resolved = comments.filter((comment) => comment.resolvedAt);

  async function submit() {
    if (await onAdd(body,replyTo??undefined)) {setBody("");setReplyTo(null);}
  }

  function row(comment: PageComment) {
    const canRemove = isOwner || comment.author?.id === userId;
    return (
      <div
        key={comment.id}
        style={{marginLeft:comment.parentId?16:0}}
        data-doc-comment
        data-comment-id={comment.id}
        onClick={() => comment.quote && onSelect(comment.id)}
        className={`group rounded-md px-2 py-2 ${comment.quote ? "cursor-pointer" : ""} ${
          active === comment.id ? "bg-elevated/60" : "hover:bg-elevated/40"
        }`}
      >
        <div className="flex items-center gap-2">
          {comment.author && (
            <AssigneeAvatar displayName={comment.author.displayName} avatar={comment.author.avatar} size={16} />
          )}
          <span className="min-w-0 truncate text-small font-medium text-muted">{comment.author?.displayName}</span>
          <span suppressHydrationWarning className="text-caption text-faint">
            {timeAgo(comment.createdAt, locale)}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            {canComment&&!comment.deletedAt&&<button disabled={pending} onClick={e=>{e.stopPropagation();setReplyTo(comment.id);}} className="rounded p-1 text-small">{t("Reply")}</button>}
            {canComment&&comment.author?.id===userId&&!comment.deletedAt&&<button disabled={pending} onClick={e=>{e.stopPropagation();if(editId!==comment.id)setEditDraft({id:comment.id,body:comment.body});}} className="rounded p-1 text-small">{t("Edit")}</button>}
            {comment.deletedAt&&canRemove&&canComment&&<button disabled={pending} onClick={e=>{e.stopPropagation();void change(()=>restorePageCommentAction(workspaceId,pageId,comment.id));}} className="rounded p-1 text-small">{t("Restore")}</button>}
            {canComment && !comment.deletedAt && <button
              type="button"
              title={comment.resolvedAt ? t("Reopen") : t("Resolve")}
              aria-label={comment.resolvedAt ? t("Reopen") : t("Resolve")}
              onClick={(event) => {
                event.stopPropagation();
                onResolve(comment.id, !comment.resolvedAt);
              }}
              className="rounded p-1 text-faint hover:bg-elevated hover:text-text"
            >
              {comment.resolvedAt ? <RotateCcw size={12} /> : <Check size={12} />}
            </button>}
            {canRemove && !comment.deletedAt && (
              <button
                type="button"
                title={t("Delete comment")}
                aria-label={t("Delete comment")}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove(comment.id);
                }}
                className="rounded p-1 text-faint hover:bg-elevated hover:text-danger"
              >
                <Trash2 size={12} />
              </button>
            )}
          </span>
        </div>
        {comment.quote && (
          <blockquote className="mt-1 line-clamp-2 border-l-2 border-border-strong pl-2 text-small text-muted">
            {comment.quote}
          </blockquote>
        )}
        {comment.quote && !comment.resolvedAt && !located.has(comment.id) && (
          <p className="mt-1 text-small text-faint">{t("The quoted text has changed.")}</p>
        )}
        <div className="mt-1 text-body leading-relaxed text-text">
          {comment.deletedAt?<p className="text-muted">{t("Deleted comment")}</p>:editId===comment.id?<div onClick={e=>e.stopPropagation()}><textarea disabled={pending} aria-label={t("Edit comment")} value={editBody} onChange={e=>setEditBody(e.target.value)} className="w-full rounded border border-border bg-bg p-2"/><div className="flex gap-3 text-small"><button disabled={pending} onClick={()=>void change(()=>editPageCommentAction(workspaceId,pageId,comment.id,editBody))}>{t("Save")}</button><button onClick={()=>setEditId(null)}>{t("Cancel")}</button></div></div>:<Markdown source={comment.body} />}
          {comment.editedAt&&!comment.deletedAt&&<span className="text-caption text-faint">{t("Edited")}</span>}
        </div>
      </div>
    );
  }

  return (
    <SidePanel name="document-discussion" compact={compact}><aside
      data-doc-comments
      className={`flex min-h-0 flex-col border-l border-border bg-bg ${
        compact ? "w-full border-l-0" : "w-full shrink-0"
      }`}
    >
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border px-3 text-body font-medium text-text">
        <MessageSquare size={13} />
        {t("Comments")}
        <button
          type="button"
          onClick={onClose}
          aria-label={t("Close comments")}
          title={t("Close comments")}
          className="ml-auto rounded p-1 text-muted hover:bg-elevated hover:text-text"
        >
          <X size={14} />
        </button>
      </div>
      <div className="flex gap-3 px-3 py-1 text-small"><button disabled={loading||busy||pending} onClick={onReload}>{t("Refresh")}</button>{loading&&t("Loading…")}</div>
      {(loadError||actionError)&&<p role="alert" className="px-3 text-small text-danger">{t(actionError??loadError??"")}</p>}
      <div ref={list} className="min-h-0 flex-1 overflow-y-auto p-2">
        {!loading&&!loadError&&comments.length === 0 && <p className="px-2 py-2 text-body text-faint">{t("No comments yet.")}</p>}
        {open.map(row)}
        {resolved.length > 0 && (
          <button
            type="button"
            onClick={() => setShowResolved((value) => !value)}
            className="mt-2 px-2 text-small text-faint hover:text-text"
          >
            {t(showResolved ? "Hide {count} resolved" : "Show {count} resolved", { count: resolved.length })}
          </button>
        )}
        {showResolved && resolved.map(row)}
      </div>
      {canComment && <div className="shrink-0 border-t border-border p-2">
        {draftAnchor && (
          <div className="mb-1.5 flex items-start gap-1">
            <blockquote className="line-clamp-2 min-w-0 flex-1 border-l-2 border-border-strong pl-2 text-small text-muted">
              {draftAnchor.quote}
            </blockquote>
            <button
              type="button"
              onClick={onClearDraft}
              aria-label={t("Comment on the whole document")}
              title={t("Comment on the whole document")}
              className="rounded p-0.5 text-faint hover:text-text"
            >
              <X size={12} />
            </button>
          </div>
        )}
        {replyTo&&<div className="flex gap-2 text-small text-muted">{t("Reply")}: {comments.find(comment=>comment.id===replyTo)?.body.slice(0,80)}<button onClick={()=>setReplyTo(null)}>{t("Cancel")}</button></div>}
        <fieldset disabled={busy}><MentionBox value={body} members={members} busy={busy} onChange={setBody} onSubmit={() => void submit()} focusOn={draftAnchor} /></fieldset>
      </div>}
    </aside></SidePanel>
  );
}
