"use client";

import { DetailNavigation } from "@/components/detail-navigation";
import { useScrollMemory } from "@/lib/ui/scroll-memory";
import { DocumentTools } from "@/components/document-tools";
import { Modal } from "@/components/ui/modal";
import { useStoredJson } from "@/lib/use-stored-json";
import Link from "next/link";
import type { Editor } from "@tiptap/react";
import { documentMarkdown, markdownToDocument } from "@/lib/editor/document-markdown";
import { useDraft } from "@/lib/ui/draft-store";
import { useRouter,useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  History,
  Link2,
  Lock,
  Maximize2,
  MessageSquare,
  Minimize2,
  Paperclip,
  Plus,
  Sparkles,
  Trash2,
  Users,
  Image as ImageIcon,
  Star,
} from "lucide-react";
import { Menu, MenuItem } from "@/components/menu";
import type { PageContext, PageRefEntry } from "@/components/markdown";
import { DocumentEditor, type EditorAnchor } from "@/components/document-editor";
import { useDocCollab } from "@/components/use-doc-collab";
import { DocCommentsPanel } from "@/components/doc-comments";
import { DocShareMenu } from "@/components/doc-share";
import { AssigneeAvatar } from "@/components/issue-table";
import { AiEditPanel } from "@/components/ai-assist";
import { DiffLines, DocUpdatesPanel } from "@/components/doc-updates";
import { useUI } from "@/components/ui-context";
import {
  addPageCommentAction,
  createPageAction,
  deletePageAction,
  listPageCommentsAction,
  removePageCommentAction,
  savePageDocAction,
  setPageCommentResolvedAction,
  setPageCoverAction,
  setPageSharedAction,
  togglePageFavoriteAction,
  updatePageAction,
} from "@/app/pages-actions";
import { announceDocsDeleted } from "@/components/tab-events";
import type { DocAnchor } from "@/lib/doc-anchor";
import { levelAllows, type PageLevel } from "@/lib/page-level";
import type { Member } from "@/lib/issues";
import type { PageComment } from "@/lib/page-comments";
import type { DocPage, PageAuthor, PageRef, PageSummary } from "@/lib/pages";
import { useT } from "@/components/i18n-context";

const ICONS = ["📄", "📘", "📝", "🗂️", "🧭", "🚀", "🧪", "🌱", "🍅", "✨", "🐙", "🔭"];

// A subpage is only listed above the text while the text does not mention it. Once a
// `[[Page]]` line exists that line is where the subpage sits, so moving the line moves
// the subpage; deleting the line puts it back in the list.
function placedPageKeys(doc: string): Set<string> {
  const keys = new Set<string>();
  for (const match of doc.matchAll(/!?\[\[([^\]\n|]+)(?:\|([^\]\n|]+))?\]\]/g)) {
    const title = match[1].trim().toLowerCase();
    if (title) keys.add(title);
    const id = match[2]?.trim();
    if (id) keys.add(id);
  }
  return keys;
}

export function DocPageView({
  workspaceId,
  page,
  author,
  level,
  ancestors,
  favorite: initialFavorite,
  isOwner,
  viewerId,
  subpages,
  ctx,
  refs,
  onClose,
  onOpenPage,
  onDeleted,
  expanded,
  onToggleExpanded,
}: {
  workspaceId: string;
  page: DocPage;
  author?: PageAuthor | null;
  level: PageLevel;
  ancestors: PageRef[];
  favorite: boolean;
  isOwner: boolean;
  viewerId: string;
  subpages: PageSummary[];
  ctx: PageContext;
  refs: PageRefEntry[];
  // Set when the page sits in the side pane instead of its own tab: the header gains a
  // close button, and page references swap the pane's content instead of navigating.
  onClose?: () => void;
  onOpenPage?: (id: string) => void;
  // Same controls as a task's pane, in the same order: delete, expand, close.
  expanded?: boolean;
  onToggleExpanded?: () => void;
  // A page deleted from the pane must close it, but the event that drops dead tabs
  // would also navigate away from the page the pane is sitting beside.
  onDeleted?: (pageIds: string[]) => void;
}) {
  const t = useT();
  const router = useRouter();
  const params=useSearchParams(),requestedComment=params.get("comment");
  const { aiReady, confirm,scope } = useUI();
  const [recent,setRecent]=useStoredJson<string[]>(`tacos.recent-documents.${scope}`,[]);
  useEffect(()=>{const frame=requestAnimationFrame(()=>setRecent(old=>[page.id,...old.filter(id=>id!==page.id)].slice(0,50)));return()=>cancelAnimationFrame(frame);},[page.id,setRecent]);
  const [readingWidth,setReadingWidth]=useStoredJson(`tacos.document.reading-width.${scope}`,880);
  const [proposal,setProposal]=useState<{before:string;after:string}|null>(null);
  const editorRef = useRef<Editor | null>(null);
  const [activeEditor,setActiveEditor]=useState<Editor|null>(null);
  const markdown = useMemo(() => documentMarkdown(), []);
  const [recovery, setRecovery] = useDraft<{body:string;revision:number;token:string}|null>("document",page.id,null);
  const recoveryRef = useRef(recovery); recoveryRef.current = recovery;
  const [favorite, setFavorite] = useState(initialFavorite);
  const [cover, setCover] = useState(page.cover);
  const [uploading, setUploading] = useState(0);
  const coverInput = useRef<HTMLInputElement>(null);
  const canEdit = level === "edit";
  const canComment = levelAllows(level, "comment");
  const [title, setTitle] = useState(page.title);
  const [icon, setIcon] = useState(page.icon);
  const [shared, setShared] = useState(page.shared);
  const [doc, setDoc] = useState(page.doc);
  const [saved, setSaved] = useState(true);
  const contentRef = useRef(doc); contentRef.current = doc;
  const [aiPanel, setAiPanel] = useState<{ x: number; y: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [side, setSide] = useState<"updates" | "comments" | null>(null);
  const [comments, setComments] = useState<PageComment[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [located, setLocated] = useState<Set<string>>(new Set());
  const [draftAnchor, setDraftAnchor] = useDraft<DocAnchor | null>("document-comment-anchor",page.id,null);
  const [activeComment, setActiveComment] = useState<string | null>(null);
  const [commentsLoading,setCommentsLoading]=useState(true),[commentsError,setCommentsError]=useState<string|null>(null);
  const commentRunning=useRef(false);
  const [commentBusy, setCommentBusy] = useState(false);
  const [conflict, setConflict] = useState<{ doc: string; revision: number; by: string | null } | null>(null);
  const collab = useDocCollab(workspaceId, page.id);
  const sharing = collab.status === "live" || collab.status === "reconnecting";
  const canEditBody = canEdit && collab.status !== "connecting";
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Saves run one at a time: each one names the revision the one before it produced.
  const revision = useRef(page.revision);
  const saves = useRef<Promise<void>>(Promise.resolve());
  const conflicted = useRef(false);

  function flushDoc() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (conflicted.current) return;
    const next = pending.current;
    const token = recoveryRef.current?.token;
    pending.current = null;
    if (next === null) return;
    setSaved(false);
    saves.current = saves.current.then(async () => {
      if (conflicted.current) return;
      const result = await savePageDocAction(workspaceId, page.id, next, revision.current).catch(() => null);
      if (!result || !result.ok) { if (contentRef.current === next) pending.current ??= next; setError(result && !result.ok ? result.error : "Could not save. Retry."); }
      else if (result.data.kind === "saved") {
        revision.current = result.data.revision;
        const confirmed = contentRef.current === next && pending.current === null;
        setSaved(confirmed);
        if (confirmed) {setRecovery((current)=>current?.token === token ? null : current);setError(null);}
      } else {
        // Hold the text: newer typing wins over it, and leaving the page still keeps it.
        pending.current ??= next;
        conflicted.current = true;
        setConflict(result.data);
      }
    });
  }

  function keepMine() {
    if (!conflict) return;
    revision.current = conflict.revision;
    conflicted.current = false;
    setConflict(null);
    pending.current = doc;
    flushDoc();
  }

  async function useTheirs() {
    if (!conflict) return;
    if (!(await confirm(t("Discard your unsaved text?")))) return;
    revision.current = conflict.revision;
    conflicted.current = false;
    pending.current = null;
    setRecovery(null);
    setDoc(conflict.doc);
    setConflict(null);
  }

  // Typing schedules a write; the unmount path writes whatever is still pending so
  // leaving the page never costs the last keystrokes.
  function editDoc(next: string) {
    setDoc(next);
    contentRef.current = next;
    setSaved(false);
    // The socket stores a shared document.
    if (sharing) return;
    pending.current = next;
    const snapshot = {body:next,revision:revision.current,token:crypto.randomUUID()};
    recoveryRef.current = snapshot; setRecovery(snapshot);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flushDoc, 700);
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      const next = pending.current;
      const token = recoveryRef.current?.token;
      pending.current = null;
      if (next === null) return;
      saves.current = saves.current.then(async () => {
        const result = await savePageDocAction(workspaceId, page.id, next, revision.current, { keepOnConflict: true }).catch(() => null);
        if (result?.ok && result.data.kind === "saved") setRecovery((current)=>current?.token === token ? null : current);
      });
    },
    [workspaceId, page.id]
  );

  // Text not saved yet belongs in the history before a restore replaces it.
  async function beforeRestore() {
    flushDoc();
    await saves.current;
    if (pending.current !== null || conflicted.current || sharing && collab.provider.hasUnsyncedChanges) throw new Error("Save or synchronize your current text before restoring a version");
  }

  function restored(next: DocPage) {
    revision.current = next.revision;
    conflicted.current = false;
    pending.current = null;
    setConflict(null);
    // A shared document already took the restored text from the server.
    if (!sharing) setDoc(next.doc);
    setTitle(next.title);
    router.refresh();
  }

  useEffect(() => {
    let live = true;
    void listPageCommentsAction(workspaceId, page.id).then((result) => {
      if (!live) return;
      setCommentsLoading(false);
      if (!result.ok) {setCommentsError(result.error);return;}
      setCommentsError(null);setComments(result.data.comments);
      setMembers(result.data.members);
      if(requestedComment&&result.data.comments.some(comment=>comment.id===requestedComment)){setActiveComment(requestedComment);setSide("comments");}
    });
    return () => {
      live = false;
    };
  }, [workspaceId, page.id,requestedComment]);

  const anchors = useMemo<EditorAnchor[]>(
    () =>
      comments.flatMap((comment) =>
        comment.quote && !comment.resolvedAt && !comment.deletedAt
          ? [{ id: comment.id, quote: comment.quote, prefix: comment.prefix, suffix: comment.suffix }]
          : []
      ),
    [comments]
  );

  async function reloadComments(){setCommentsLoading(true);try{const result=await listPageCommentsAction(workspaceId,page.id);if(result.ok){setComments(result.data.comments);setCommentsError(null);}else setCommentsError(result.error);}catch{setCommentsError("Could not load comments. Retry.");}finally{setCommentsLoading(false);}}
  async function commentAction(work:()=>Promise<{ok:boolean;data?:PageComment[];error?:string}>):Promise<boolean>{if(commentRunning.current)return false;commentRunning.current=true;setCommentBusy(true);try{const result=await work();if(!result.ok){setCommentsError(result.error??"Could not save. Retry.");return false;}if(result.data)setComments(result.data);setCommentsError(null);return true;}catch{setCommentsError("Could not save. Retry.");return false;}finally{commentRunning.current=false;setCommentBusy(false);}}
  async function addComment(body:string,parentId?:string){if(!body.trim())return false;const ok=await commentAction(()=>addPageCommentAction(workspaceId,page.id,{body,anchor:parentId?null:draftAnchor,parentId}));if(ok)setDraftAnchor(null);return ok;}
  async function resolveComment(id:string,resolved:boolean){await commentAction(()=>setPageCommentResolvedAction(workspaceId,page.id,id,resolved));}
  async function removeComment(id:string){if(!await confirm(t("Delete this comment? You can restore it here.")))return;await commentAction(()=>removePageCommentAction(workspaceId,page.id,id));}

  async function saveTitle() {
    const next = title.trim();
    if (!next || next === page.title) {
      setTitle(page.title);
      return;
    }
    const result = await updatePageAction(workspaceId, page.id, { title: next });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setTitle(result.data.title);
    router.refresh();
  }

  async function pickIcon(next: string) {
    if (!canEdit) return;
    const previous = icon;
    setIcon(next);
    const result = await updatePageAction(workspaceId, page.id, { icon: next });
    if (!result.ok) {setIcon(previous);setError(result.error);}
    else router.refresh();
  }

  async function uploadFile(file: File,controls?:{signal?:AbortSignal;onProgress?:(progress:number)=>void}): Promise<string | null> {
    setUploading((count) => count + 1);
    try {
      const { uploadPageFile } = await import("@/lib/upload-client");
      return (await uploadPageFile(workspaceId, page.id, file,controls)).url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      return null;
    } finally {
      setUploading((count) => count - 1);
    }
  }

  async function pickCover(file: File) {
    const url = await uploadFile(file);
    if (url) await saveCover(url.split("/").pop() ?? null);
  }

  async function saveCover(next: string | null) {
    const result = await setPageCoverAction(workspaceId, page.id, next);
    if (result.ok) setCover(next);
    else setError(result.error);
  }

  async function toggleFavorite() {
    const result = await togglePageFavoriteAction(workspaceId, page.id);
    if (result.ok) {
      setFavorite(result.data);
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  async function toggleShared() {
    if(!await confirm(t("Change sharing for this document and all its children?")))return;
    const result = await setPageSharedAction(workspaceId, page.id, !shared);
    if (!result.ok) {
      setError(result.error);
      throw new Error(result.error);
    }
    setShared(result.data.shared);
    router.refresh();
  }

  async function removePage() {
    if (!(await confirm(t("Move “{title}” and everything inside it to the Trash?", { title: page.title })))) return;
    const result = await deletePageAction(workspaceId, page.id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (onDeleted) onDeleted(result.data);
    else announceDocsDeleted(result.data);
  }

  async function addSubpage() {
    const result = await createPageAction(workspaceId, { parentId: page.id });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (onOpenPage) {
      onOpenPage(result.data.id);
      router.refresh();
      return;
    }
    router.push(`/${workspaceId}/docs/${result.data.id}`);
  }

  // Inserting at the end is predictable; the editor owns the caret and has no public
  // "insert at cursor" API, and a page reference is usually added as its own block.
  function insertRef(reference: PageRefEntry, embed: boolean) {
    if (!canEditBody || !editorRef.current?.isEditable) return;
    const syntax = embed ? `![[${reference.title}|${reference.id}]]` : `[[${reference.title}|${reference.id}]]`;
    editorRef.current?.chain().focus().insertContent(markdownToDocument(markdown, syntax).content ?? []).run();
  }

  // Putting the reference at the top of the text keeps the row where the list showed
  // it; from there it is an ordinary line the editor can move anywhere.
  function placeSubpage(child: PageSummary) {
    if (!canEditBody || !editorRef.current?.isEditable) return;
    const syntax = `[[${child.title}|${child.id}]]`;
    editorRef.current?.chain().focus().insertContent(markdownToDocument(markdown, syntax).content ?? []).run();
  }

  function openAi(origin: HTMLElement) {
    const rect = origin.getBoundingClientRect();
    setAiPanel({
      x: Math.min(rect.left, Math.max(12, window.innerWidth - 420)),
      y: rect.bottom + 6,
    });
  }

  function acceptAi(text: string, action: string, source:string) {
    if (!canEditBody || !editorRef.current?.isEditable) return;
    if(contentRef.current!==source){setError("The document changed. Generate the edit again before replacing it.");return;}
    const next = action === "continue" && doc.trim() ? `${doc.replace(/\s+$/, "")}\n\n${text}` : text;
    setProposal({before:doc,after:next});
    setAiPanel(null);
  }

  const base = `/${workspaceId}/docs/`;
  // A pane is a narrow column: the header drops its labels and keeps the glyphs, or the
  // row wraps and the buttons lose their words.
  const root=useRef<HTMLDivElement>(null);
  useScrollMemory(root,`document.${page.id}`,"[data-document-scroll]",!requestedComment);
  const [compact,setCompact]=useState(Boolean(onClose));
  useEffect(()=>{const observer=new ResizeObserver(([entry])=>setCompact(entry.contentRect.width<850));if(root.current)observer.observe(root.current);return()=>observer.disconnect();},[]);
  // References inside the pane open in the pane, so following one never loses the page
  // you were reading.
  const pageCtx = useMemo<PageContext>(
    () => (onOpenPage ? { ...ctx, onOpen: onOpenPage } : ctx),
    [ctx, onOpenPage]
  );
  const placed = useMemo(() => placedPageKeys(doc), [doc]);
  const openComments = comments.filter((comment) => !comment.resolvedAt).length;
  const unplaced = subpages.filter(
    (child) => !placed.has(child.id) && !placed.has(child.title.toLowerCase())
  );

  return (
    <div ref={root} data-document-root className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4 text-small text-muted">
        <DetailNavigation kind="document" id={page.id} workspaceId={workspaceId} panel={!!onClose} fallback={refs.map(ref=>ref.id)}/>
        <span
          className="flex shrink-0 items-center gap-1"
          title={shared ? t("Shared with the workspace") : t("Private")}
        >
          {shared ? <Users size={13} /> : <Lock size={13} />}
          {!compact && (shared ? t("Shared with the workspace") : t("Private"))}
        </span>
        {!compact && <span className="text-faint">·</span>}
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <nav data-doc-breadcrumb className="flex min-w-0 items-center gap-1 truncate">
            <Link href={`/${workspaceId}/docs`} className="shrink-0 hover:text-text">
              {t("Docs")}
            </Link>
            {ancestors.map((ancestor) => (
              <span key={ancestor.id} className="flex min-w-0 items-center gap-1">
                <span className="text-faint">/</span>
                <Link
                  href={`/${workspaceId}/docs/${ancestor.id}`}
                  onClick={(event) => {
                    if (!onOpenPage) return;
                    event.preventDefault();
                    onOpenPage(ancestor.id);
                  }}
                  className="min-w-0 truncate hover:text-text"
                >
                  {ancestor.title}
                </Link>
              </span>
            ))}
          </nav>
          {/* A shared document says whose it is right where it says what it is. */}
          {author && (
            <span data-doc-author className="flex shrink-0 items-center gap-1 text-small text-muted">
              <AssigneeAvatar displayName={author.displayName} avatar={author.avatar} size={14} />
              <span className="max-w-[160px] truncate">
                {isOwner ? t("by you") : t("by {name}", { name: author.displayName })}
              </span>
            </span>
          )}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {sharing && collab.storageError && <p role="alert" className="text-small text-danger">{t(collab.storageError)}</p>}
          {collab.status === "reconnecting" && (
            <span data-doc-reconnecting className="text-small text-faint">
              {t("Reconnecting…")}
            </span>
          )}
          {sharing && collab.peers.length > 0 && (
            <span data-doc-presence className="flex items-center -space-x-1">
              {collab.peers.slice(0, 5).map((peer) => (
                <span
                  key={peer.clientId}
                  title={peer.name}
                  style={{ backgroundColor: peer.color }}
                  className="flex size-[18px] items-center justify-center rounded-full border border-surface text-caption font-medium text-white"
                >
                  {peer.name.slice(0, 1).toUpperCase()}
                </span>
              ))}
            </span>
          )}
          <span
            className={`text-small text-faint transition-opacity duration-300 ${
              saved || sharing ? "opacity-100" : "opacity-70"
            }`}
          >
            {t(sharing ? collab.pending || collab.status === "reconnecting" ? "Offline changes are kept on this device" : "Synchronized" : saved ? "Saved" : "Unsaved changes")}
          </span>
          <button
            type="button"
            onClick={() => setSide((open) => (open === "comments" ? null : "comments"))}
            title={t("Comments")}
            aria-label={t("Comments")}
            aria-pressed={side === "comments"}
            className={`flex items-center gap-1 rounded-md border px-2 py-1 text-small font-medium transition-colors hover:border-border-strong hover:text-text ${
              side === "comments" ? "border-border-strong text-text" : "border-border text-muted"
            }`}
          >
            <MessageSquare size={12} />
            {openComments > 0 && <span data-comment-count>{openComments}</span>}
          </button>
          <button
            type="button"
            onClick={() => setSide((open) => (open === "updates" ? null : "updates"))}
            title={t("Updates")}
            aria-label={t("Updates")}
            aria-pressed={side === "updates"}
            className={`flex items-center gap-1 rounded-md border px-2 py-1 text-small font-medium transition-colors hover:border-border-strong hover:text-text ${
              side === "updates" ? "border-border-strong text-text" : "border-border text-muted"
            }`}
          >
            <History size={12} />
            {!compact && t("Updates")}
          </button>
          {canEdit && aiReady && (
            <button
              type="button"
              onClick={(event) => openAi(event.currentTarget)}
              title="AI"
              aria-label="AI"
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-small font-medium text-muted transition-colors hover:border-border-strong hover:text-text"
            >
              <Sparkles size={12} />
              {!compact && "AI"}
            </button>
          )}
          <button
            type="button"
            data-doc-favorite={favorite ? "on" : "off"}
            title={favorite ? t("Remove from favorites") : t("Add to favorites")}
            onClick={() => void toggleFavorite()}
            className={`rounded p-1 transition-colors hover:bg-elevated hover:text-text ${favorite ? "text-accent" : "text-muted"}`}
          >
            <Star size={13} fill={favorite ? "currentColor" : "none"} />
          </button>
          {isOwner ? (
            <DocShareMenu
              workspaceId={workspaceId}
              pageId={page.id}
              ownerId={page.createdBy}
              shared={shared}
              compact={compact}
              members={members}
              onToggleShared={toggleShared}
            />
          ) : (
            !canEdit && (
              <span data-doc-level className="shrink-0 text-small text-faint">
                {t(canComment ? "Can comment" : "Can view")}
              </span>
            )
          )}
          {isOwner && (
            <button
              type="button"
              onClick={() => void removePage()}
              aria-label={t("Delete document")}
              title={t("Delete document")}
              className="rounded-md p-1.5 text-muted transition-colors hover:bg-elevated hover:text-danger"
            >
              <Trash2 size={15} />
            </button>
          )}
          {onToggleExpanded && (
            <button
              type="button"
              onClick={onToggleExpanded}
              title={expanded ? t("Shrink panel") : t("Expand panel")}
              aria-label={expanded ? t("Shrink panel") : t("Expand panel")}
              className="rounded-md p-1.5 text-muted transition-colors hover:bg-elevated hover:text-text"
            >
              {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label={t("Close document")}
              title={t("Close document")}
              className="rounded-md px-1.5 py-1 text-lead leading-none text-muted transition-colors hover:bg-elevated hover:text-text"
            >
              ×
            </button>
          )}
        </div>
      </header>

      <div className="border-b border-border px-3 py-1"><DocumentTools title={title} doc={doc} editor={activeEditor} width={readingWidth} onWidth={setReadingWidth}/></div>
      <Modal open={!!proposal} title={t("Review changes")} onClose={()=>setProposal(null)}><h2 className="text-title">{t("Review changes")}</h2>{error&&<p role="alert" className="text-small text-danger">{t(error)}</p>}{proposal&&<div className="my-3 max-h-[60dvh] overflow-auto"><DiffLines before={proposal.before} after={proposal.after}/></div>}<button disabled={!canEditBody} onClick={()=>{if(!proposal||!editorRef.current?.isEditable)return;if(contentRef.current!==proposal.before){setError("The document changed. Generate the edit again before replacing it.");return;}editorRef.current.commands.setContent(markdownToDocument(markdown,proposal.after));setProposal(null);}} className="rounded border border-border px-3 py-1 text-body">{t("Apply changes")}</button></Modal>
      {aiPanel && (
        <AiEditPanel
          workspaceId={workspaceId}
          x={aiPanel.x}
          y={aiPanel.y}
          target={{
            mode: "document",
            text: doc,
            allowContinue: true,
            acceptLabel: doc.trim() ? t("Replace document") : t("Insert"),
          }}
          onClose={() => setAiPanel(null)}
          onAccept={acceptAi}
        />
      )}

      <div className="relative flex min-h-0 flex-1">
      <div data-document-scroll className="min-w-0 flex-1 overflow-y-auto">
        {/* A pane is measured by its own width, not the window's, so the reading
            margins it would use on a full tab would leave no text at all. */}
        <div
          style={{maxWidth:readingWidth,marginInline:"auto"}}
          className={`w-full pb-8 pt-6 ${
            onClose ? "px-5" : "px-10 lg:px-20 xl:px-32"
          }`}
        >
          <input
            ref={coverInput}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            hidden
            data-doc-cover-input
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void pickCover(file);
            }}
          />
          {cover && (
            <div data-doc-cover className="group relative mb-4 h-40 overflow-hidden rounded-lg">
              {/* eslint-disable-next-line @next/next/no-img-element -- served by our own route, with its session check */}
              <img src={`/api/files/${cover}`} alt="" className="h-full w-full object-cover" />
              {canEdit && (
                <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => coverInput.current?.click()}
                    className="rounded border border-border bg-bg px-2 py-0.5 text-small text-muted hover:text-text"
                  >
                    {t("Change cover")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveCover(null)}
                    className="rounded border border-border bg-bg px-2 py-0.5 text-small text-muted hover:text-text"
                  >
                    {t("Remove cover")}
                  </button>
                </div>
              )}
            </div>
          )}
          {(uploading > 0 || (canEdit && !cover)) && (
            <div className="mb-2 flex items-center gap-3 text-small text-faint">
              {canEdit && !cover && (
                <button
                  type="button"
                  data-doc-add-cover
                  onClick={() => coverInput.current?.click()}
                  className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-elevated hover:text-text"
                >
                  <ImageIcon size={12} /> {t("Add cover")}
                </button>
              )}
              {uploading > 0 && <span data-doc-uploading>{t("Uploading…")}</span>}
            </div>
          )}
          <div className="flex items-start gap-3">
            {canEdit ? (
            <Menu
              width={196}
              triggerClassName="shrink-0 rounded-md p-1 text-display leading-none transition-colors hover:bg-elevated"
              trigger={
                <span title={t("Change icon")}>
                  {icon ?? "📄"}
                </span>
              }
            >
              {(close) => (
                <div className="grid grid-cols-6 gap-1 p-1">
                  {ICONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => {
                        close();
                        void pickIcon(emoji);
                      }}
                      className="rounded p-1 text-title transition-colors hover:bg-elevated"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </Menu>
            ) : <span className="text-display">{icon ?? "📄"}</span>}
            <div className="min-w-0 flex-1">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onBlur={() => void saveTitle()}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") setTitle(page.title);
                }}
                readOnly={!canEdit}
                aria-label={t("Document title")}
                className={`w-full rounded-md bg-transparent font-semibold leading-tight tracking-tight text-text placeholder:text-faint hover:bg-elevated/40 focus:bg-bg focus:outline-none ${
                  compact ? "text-heading" : "text-display"
                }`}
                placeholder={t("Untitled")}
              />
            </div>
          </div>

          {error && <div role="alert" className="mt-3 text-small text-danger">{t(error)} <button onClick={flushDoc}>{t("Retry")}</button> <button onClick={()=>void navigator.clipboard.writeText(doc)}>{t("Copy draft")}</button></div>}
          {collab.status === "connecting" && collab.error && <p role="alert" className="my-2 text-small text-danger">{t(collab.error)} <button onClick={()=>location.reload()}>{t("Retry")}</button></p>}
          {recovery && !sharing && <div role="status" className="my-2 flex flex-wrap gap-3 text-small text-muted">{t("A local draft is kept until saving succeeds.")}<button disabled={!canEditBody} onClick={()=>{if(!canEditBody)return;revision.current=recovery.revision;setDoc(recovery.body);contentRef.current=recovery.body;pending.current=recovery.body;flushDoc();}}>{t("Restore draft")}</button><button onClick={()=>void navigator.clipboard.writeText(recovery.body)}>{t("Copy draft")}</button></div>}

          {conflict && (
            <div data-doc-conflict className="mt-3 rounded-lg border border-border-strong bg-surface p-3 text-body">
              <div className="font-medium text-text">
                {conflict.by
                  ? t("{name} changed this document while you were editing it", { name: conflict.by })
                  : t("This document changed while you were editing it")}
              </div>
              <div className="mt-1 text-small text-muted">
                {t("Your text is not saved yet. Keeping it adds a new version; the other text stays in Updates.")}
              </div>
              <div className="mt-2 max-h-48 overflow-y-auto rounded border border-border bg-bg p-2">
                <DiffLines before={conflict.doc} after={doc} />
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={keepMine}
                  className="rounded-md bg-accent px-2 py-1 text-small font-medium text-bg hover:bg-accent-hover"
                >
                  {t("Keep my text")}
                </button>
                <button
                  type="button"
                  onClick={useTheirs}
                  className="rounded-md border border-border px-2 py-1 text-small font-medium text-muted hover:border-border-strong hover:text-text"
                >
                  {t("Use the other text")}
                </button>
              </div>
            </div>
          )}

          <div className="mt-6">
            {unplaced.length > 0 && (
              <div className="mb-4 space-y-0.5">
                {unplaced.length < subpages.length && (
                  <div className="px-1 pb-0.5 text-small text-faint">{t("Not placed in the page")}</div>
                )}
                {unplaced.map((child) => (
                  <div
                    key={child.id}
                    className="group flex items-center gap-2 rounded px-1 py-0.5 text-body text-text hover:bg-elevated/60"
                  >
                    <Link
                      href={`${base}${child.id}`}
                      onClick={(event) => {
                        if (!onOpenPage) return;
                        event.preventDefault();
                        onOpenPage(child.id);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2"
                    >
                      <span className="shrink-0">{child.icon ?? "📄"}</span>
                      <span className="truncate underline decoration-border-strong underline-offset-2">
                        {child.title}
                      </span>
                    </Link>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => placeSubpage(child)}
                        title={t("Place in the page")}
                        aria-label={t("Place {title} in the page", { title: child.title })}
                        className="rounded p-0.5 text-faint opacity-0 transition-opacity hover:bg-elevated hover:text-text focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <Plus size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Anything you can edit opens in the editor directly — there is no
                read/edit toggle to switch out of, so the caret is where you click. */}
            {!canEdit && !doc.trim() && <p className="text-body text-faint">{t("This page is empty.")}</p>}
            {(canEdit || doc.trim()) && (
              <DocumentEditor
                editorRef={editorRef}
                onEditorReady={setActiveEditor}
                key={sharing ? "shared" : "alone"}
                collab={sharing ? collab : undefined}
                value={doc}
                onChange={editDoc}
                pages={pageCtx}
                editable={canEditBody}
                placeholder={t("Write something, or type / for commands…")}
                anchors={anchors}
                members={members}
                viewerId={viewerId}
                activeAnchor={activeComment}
                onComment={
                  canComment
                    ? (anchor) => {
                        setDraftAnchor(anchor);
                        setSide("comments");
                      }
                    : undefined
                }
                onAnchorClick={(id) => {
                  setActiveComment(id);
                  setSide("comments");
                }}
                onAnchorsLocated={setLocated}
                onUpload={uploadFile}
              />
            )}
            {canEditBody && (
              <div className="mt-4 flex items-center gap-2">
                <Menu
                  width={240}
                  triggerClassName="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-small text-muted transition-colors hover:border-border-strong hover:text-text"
                  trigger={
                    <>
                      <Link2 size={12} /> {t("Link a page")}
                    </>
                  }
                >
                  {(close) => <PagePicker refs={refs} close={close} onPick={(ref) => insertRef(ref, false)} />}
                </Menu>
                <Menu
                  width={240}
                  triggerClassName="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-small text-muted transition-colors hover:border-border-strong hover:text-text"
                  trigger={
                    <>
                      <Paperclip size={12} /> {t("Embed a page")}
                    </>
                  }
                >
                  {(close) => <PagePicker refs={refs} close={close} onPick={(ref) => insertRef(ref, true)} />}
                </Menu>
              </div>
            )}
          </div>

          {canEdit && (
            <div className="mt-10 border-t border-border pt-3">
              <button
                type="button"
                onClick={() => void addSubpage()}
                className="flex items-center gap-1.5 rounded px-1 py-1 text-body text-muted transition-colors hover:bg-elevated/60 hover:text-text"
              >
                <Plus size={13} /> {t("Add a subpage")}
              </button>
            </div>
          )}
        </div>
      </div>
      {side === "updates" && (
        <DocUpdatesPanel
          workspaceId={workspaceId}
          pageId={page.id}
          canEdit={canEdit}
          compact={compact}
          beforeRestore={beforeRestore}
          onRestored={restored}
          onClose={() => setSide(null)}
        />
      )}
      {side === "comments" && (
        <DocCommentsPanel
          workspaceId={workspaceId} onChanged={setComments} onReload={()=>void reloadComments()} loading={commentsLoading} loadError={commentsError}
          pageId={page.id}
          comments={comments}
          members={members}
          userId={viewerId}
          isOwner={isOwner}
          canComment={canComment}
          compact={compact}
          located={located}
          draftAnchor={draftAnchor}
          active={activeComment}
          busy={commentBusy}
          onAdd={addComment}
          onResolve={(id, resolved) => void resolveComment(id, resolved)}
          onRemove={(id) => void removeComment(id)}
          onSelect={setActiveComment}
          onClearDraft={() => setDraftAnchor(null)}
          onClose={() => setSide(null)}
        />
      )}
      </div>
    </div>
  );
}

function PagePicker({
  refs,
  close,
  onPick,
}: {
  refs: PageRefEntry[];
  close: () => void;
  onPick: (ref: PageRefEntry) => void;
}) {
  const t = useT();
  const [query,setQuery]=useState("");
  const [limit,setLimit]=useState(40);
  const matches=refs.filter(ref=>(ref.path??ref.title).toLowerCase().includes(query.toLowerCase())||ref.id.includes(query));
  if (refs.length === 0) {
    return <div className="px-2 py-1.5 text-small text-faint">{t("No documents yet.")}</div>;
  }
  return (
    <>
      <input aria-label={t("Search documents")} placeholder={t("Search documents")} value={query} onChange={event=>{setQuery(event.target.value);setLimit(40);}} className="sticky top-0 w-full rounded border border-border bg-bg px-2 py-1 text-small"/>
      {matches.slice(0, limit).map((ref) => (
        <MenuItem
          key={ref.id}
          onSelect={() => {
            close();
            onPick(ref);
          }}
        >
          <span className="flex items-center gap-2">
            <span className="shrink-0">{ref.icon ?? "📄"}</span>
            <span className="min-w-0"><span className="block truncate">{ref.title}</span><span className="block truncate text-caption text-faint">{ref.path??ref.id}</span></span>
          </span>
        </MenuItem>
      ))}
      {matches.length>limit&&<button onClick={()=>setLimit(n=>n+40)} className="p-2 text-small">{t("Load more")}</button>}
    </>
  );
}
