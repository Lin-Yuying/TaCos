"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { useUI, NOTIFICATIONS_READ } from "@/components/ui-context";
import {
  clearNotificationsAction,
  deleteNotificationAction,
  markNotificationReadAction,
  markNotificationsReadAction,
} from "@/app/workspace-misc-actions";
import type { NotificationRow } from "@/lib/issues";
import { issueRef, timeAgo } from "@/lib/format";
import { useLocale, useT } from "@/components/i18n-context";
import { PAGE_INSET } from "@/lib/page-chrome";

export function NotificationsView({
  workspaceId,
  items,
}: {
  workspaceId: string;
  items: NotificationRow[];
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const { openIssue, openPage, confirm } = useUI();
  const [marking, setMarking] = useState(false);
  const [clearing, setClearing] = useState(false);
  // Rows the user has opened since this view loaded. The server data refreshes a
  // moment later, but the dot should disappear the instant they click.
  const [opened, setOpened] = useState<string[]>([]);
  // Rows removed here; the refresh lands a moment later, but the list should shrink
  // the instant the trash icon is clicked.
  const [removed, setRemoved] = useState<string[]>([]);

  const visible = items.filter((item) => !removed.includes(item.id));

  function isUnread(item: NotificationRow) {
    return !item.readAt && !opened.includes(item.id);
  }

  const locks=useRef(new Set<string>());
  const [pending,setPending]=useState<string[]>([]);
  const [errors,setErrors]=useState<Record<string,{message:string;retry:()=>void}>>({});
  async function perform(key:string,work:()=>Promise<{ok:boolean;error?:string}>,optimistic:()=>void,rollback:()=>void){
    if(locks.current.has(key)||locks.current.has("all")||(key==="all"&&locks.current.size))return;
    locks.current.add(key);setPending([...locks.current]);optimistic();setErrors(old=>{const next={...old};delete next[key];return next;});
    try{const result=await work();if(!result.ok)throw new Error(result.error);window.dispatchEvent(new Event(NOTIFICATIONS_READ));router.refresh();}
    catch(error){rollback();setErrors(old=>({...old,[key]:{message:error instanceof Error?error.message:"Could not save. Retry.",retry:()=>void perform(key,work,optimistic,rollback)}}));}
    finally{locks.current.delete(key);setPending([...locks.current]);}
  }
  function open(item:NotificationRow){
    if(item.pageId)openPage(item.pageId);else if(item.type!=="workspace_deleted")openIssue(item.issueId);
    if(!isUnread(item))return;
    void perform(item.id,()=>markNotificationReadAction(workspaceId,item.id),()=>setOpened(old=>[...old,item.id]),()=>setOpened(old=>old.filter(id=>id!==item.id)));
  }
  async function markAll(){setMarking(true);try{const previous=opened;await perform("all",()=>markNotificationsReadAction(workspaceId),()=>setOpened(items.map(item=>item.id)),()=>setOpened(previous));}finally{setMarking(false);}}
  async function remove(item:NotificationRow){await perform(item.id,()=>deleteNotificationAction(workspaceId,item.id),()=>setRemoved(old=>[...old,item.id]),()=>setRemoved(old=>old.filter(id=>id!==item.id)));}
  async function clearAll(){if(!visible.length||pending.length||!await confirm(t("Delete all {count} inbox notifications? This cannot be undone.",{count:visible.length})))return;setClearing(true);try{const previous=removed;await perform("all",()=>clearNotificationsAction(workspaceId),()=>setRemoved(items.map(item=>item.id)),()=>setRemoved(previous));}finally{setClearing(false);}}

  const unread = visible.filter(isUnread).length;

  return (
    <div className="flex-1 overflow-y-auto">
      <header className={`flex h-12 shrink-0 items-center gap-3 border-b border-border ${PAGE_INSET}`}>
        <h1 className="text-body font-semibold">{t("Inbox")}</h1>
        <span className="rounded-full bg-elevated px-2 py-0.5 text-caption text-muted">
          {t("{count} unread", { count: unread })}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => void markAll()}
            disabled={marking||pending.length>0}
            className="rounded-md border border-border px-2.5 py-1 text-small text-muted transition-colors hover:text-text"
          >
            {t("Mark all read")}
          </button>
          {visible.length > 0 && (
            <button
              type="button"
              onClick={() => void clearAll()}
              disabled={clearing||pending.length>0}
              className="rounded-md border border-border px-2.5 py-1 text-small text-muted transition-colors hover:border-danger/40 hover:text-danger"
            >
              {t("Clear all")}
            </button>
          )}
        </div>
      </header>
      {Object.entries(errors).map(([id,error])=><p key={id} role="alert" className="px-4 py-2 text-small text-danger">{t(error.message)} <button disabled={pending.length>0} onClick={error.retry}>{t("Retry")}</button></p>)}
      <div className={`divide-y divide-border pb-8 ${PAGE_INSET}`}>
        {visible.length === 0 && (
          <div className="p-6 text-body text-faint">
            {t("Nothing yet — you'll see mentions, assignments, and comments here.")}
          </div>
        )}
        {visible.map((item) => (
          <div
            key={item.id}
            data-inbox-read={isUnread(item) ? "false" : "true"}
            className="group flex items-center gap-3 py-3 transition-colors hover:bg-elevated/40"
          >
            <button
              type="button"
              disabled={pending.includes(item.id)||pending.includes("all")}
              onClick={() => open(item)}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: isUnread(item) ? "var(--color-accent)" : "transparent" }}
              />
              <span className="min-w-0 flex-1">
                <span
                  className={`block truncate text-body ${isUnread(item) ? "font-medium text-text" : "text-muted"}`}
                >
                  {noticeText(item.type, item.body, t)}
                </span>
                <span className="block text-caption text-faint">
                  {item.type === "workspace_deleted"
                    ? t("Workspace deleted")
                    : item.pageId
                      ? item.pageTitle ?? t("Deleted document")
                      : `${issueRef({
                        projectName: item.issueProjectName,
                        number: item.issueNumber,
                        identifier: item.issueIdentifier,
                      })} · ${item.issueTitle}`}
                </span>
              </span>
            </button>
            <span suppressHydrationWarning className="shrink-0 text-caption text-faint">
              {timeAgo(item.createdAt, locale)}
            </span>
            <button
              type="button"
              aria-label={t("Delete notification")}
              disabled={pending.includes(item.id)||pending.includes("all")}
              onClick={() => void remove(item)}
              className="shrink-0 rounded p-1 text-faint opacity-0 transition-opacity hover:bg-elevated hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// Claim notices store only the actor's name, so the sentence follows the reader's language.
function noticeText(type: string, body: string, t: ReturnType<typeof useT>): string {
  if (type === "claimed") return t("{name} claimed a task you follow", { name: body });
  if (type === "released") return t("{name} released a task you follow", { name: body });
  if (type === "due_soon") return t("Due {date}: reminder", { date: body });
  if (type === "mentioned") return t("{name} mentioned you", { name: body });
  if (type === "doc_mentioned") return t("{name} mentioned you in a document", { name: body });
  if (type === "doc_commented") return t("{name} commented on your document", { name: body });
  if (type === "handoff_done") return t("Your Agent finished {task}", { task: body });
  if (type === "handoff_failed") return t("Your Agent could not finish {task}", { task: body });
  if (type === "handoff_waiting") return t("Your Agent needs your approval on {task}", { task: body });
  if (type === "claim_transferred") return t("{name} handed a task to you", { name: body });
  if (type === "blocker") return t("{name} reported a blocker", { name: body });
  return body;
}
