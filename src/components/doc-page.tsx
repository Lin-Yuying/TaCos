"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
  Star,
} from "lucide-react";
import { Menu, MenuItem } from "@/components/menu";
import type { PageContext, PageRefEntry } from "@/components/markdown";
import { DocumentEditor, type EditorAnchor } from "@/components/document-editor";
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
  const { aiReady } = useUI();
  const [favorite, setFavorite] = useState(initialFavorite);
  const canEdit = level === "edit";
  const canComment = levelAllows(level, "comment");
  const [title, setTitle] = useState(page.title);
  const [icon, setIcon] = useState(page.icon);
  const [shared, setShared] = useState(page.shared);
  const [doc, setDoc] = useState(page.doc);
  const [saved, setSaved] = useState(false);
  const [aiPanel, setAiPanel] = useState<{ x: number; y: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [side, setSide] = useState<"updates" | "comments" | null>(null);
  const [comments, setComments] = useState<PageComment[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [located, setLocated] = useState<Set<string>>(new Set());
  const [draftAnchor, setDraftAnchor] = useState<DocAnchor | null>(null);
  const [activeComment, setActiveComment] = useState<string | null>(null);
  const [commentBusy, setCommentBusy] = useState(false);
  const [conflict, setConflict] = useState<{ doc: string; revision: number; by: string | null } | null>(null);
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
    pending.current = null;
    if (next === null) return;
    setSaved(false);
    saves.current = saves.current.then(async () => {
      const result = await savePageDocAction(workspaceId, page.id, next, revision.current).catch(() => null);
      if (!result) setError("Something went wrong");
      else if (!result.ok) setError(result.error);
      else if (result.data.kind === "saved") {
        revision.current = result.data.revision;
        setSaved(true);
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

  function useTheirs() {
    if (!conflict) return;
    if (!window.confirm(t("Discard your unsaved text?"))) return;
    revision.current = conflict.revision;
    conflicted.current = false;
    pending.current = null;
    setDoc(conflict.doc);
    setConflict(null);
  }

  // Typing schedules a write; the unmount path writes whatever is still pending so
  // leaving the page never costs the last keystrokes.
  function editDoc(next: string) {
    setDoc(next);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flushDoc, 700);
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      const next = pending.current;
      pending.current = null;
      if (next === null) return;
      saves.current = saves.current.then(async () => {
        await savePageDocAction(workspaceId, page.id, next, revision.current, { keepOnConflict: true });
      });
    },
    [workspaceId, page.id]
  );

  // Text not saved yet belongs in the history before a restore replaces it.
  async function beforeRestore() {
    flushDoc();
    await saves.current;
  }

  function restored(next: DocPage) {
    revision.current = next.revision;
    conflicted.current = false;
    pending.current = null;
    setConflict(null);
    setDoc(next.doc);
    setTitle(next.title);
    router.refresh();
  }

  useEffect(() => {
    let live = true;
    void listPageCommentsAction(workspaceId, page.id).then((result) => {
      if (!live || !result.ok) return;
      setComments(result.data.comments);
      setMembers(result.data.members);
    });
    return () => {
      live = false;
    };
  }, [workspaceId, page.id]);

  const anchors = useMemo<EditorAnchor[]>(
    () =>
      comments.flatMap((comment) =>
        comment.quote && !comment.resolvedAt
          ? [{ id: comment.id, quote: comment.quote, prefix: comment.prefix, suffix: comment.suffix }]
          : []
      ),
    [comments]
  );

  async function addComment(body: string): Promise<boolean> {
    if (!body.trim() || commentBusy) return false;
    setCommentBusy(true);
    const result = await addPageCommentAction(workspaceId, page.id, { body, anchor: draftAnchor });
    setCommentBusy(false);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    setComments(result.data);
    setDraftAnchor(null);
    return true;
  }

  async function resolveComment(id: string, resolved: boolean) {
    const result = await setPageCommentResolvedAction(workspaceId, page.id, id, resolved);
    if (result.ok) setComments(result.data);
    else setError(result.error);
  }

  async function removeComment(id: string) {
    const result = await removePageCommentAction(workspaceId, page.id, id);
    if (result.ok) setComments(result.data);
    else setError(result.error);
  }

  async function saveTitle() {
    const next = title.trim();
    if (!next || next === page.title) {
      setTitle(page.title);
      return;
    }
    const result = await updatePageAction(workspaceId, page.id, { title: next });
    if (!result.ok) {
      setError(result.error);
      setTitle(page.title);
      return;
    }
    router.refresh();
  }

  async function pickIcon(next: string) {
    setIcon(next);
    const result = await updatePageAction(workspaceId, page.id, { icon: next });
    if (!result.ok) setError(result.error);
    else router.refresh();
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
    const result = await setPageSharedAction(workspaceId, page.id, !shared);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setShared(result.data.shared);
    router.refresh();
  }

  async function removePage() {
    if (!window.confirm(t("Move “{title}” and everything inside it to the Trash?", { title: page.title }))) return;
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
    const syntax = embed ? `![[${reference.title}|${reference.id}]]` : `[[${reference.title}|${reference.id}]]`;
    const next = doc.trim() ? `${doc.replace(/\s+$/, "")}\n\n${syntax}` : syntax;
    editDoc(next);
  }

  // Putting the reference at the top of the text keeps the row where the list showed
  // it; from there it is an ordinary line the editor can move anywhere.
  function placeSubpage(child: PageSummary) {
    const syntax = `[[${child.title}|${child.id}]]`;
    editDoc(doc.trim() ? `${syntax}\n\n${doc}` : syntax);
  }

  function openAi(origin: HTMLElement) {
    const rect = origin.getBoundingClientRect();
    setAiPanel({
      x: Math.min(rect.left, Math.max(12, window.innerWidth - 420)),
      y: rect.bottom + 6,
    });
  }

  function acceptAi(text: string, action: string) {
    const next = action === "continue" && doc.trim() ? `${doc.replace(/\s+$/, "")}\n\n${text}` : text;
    editDoc(next);
    setAiPanel(null);
  }

  const base = `/${workspaceId}/docs/`;
  // A pane is a narrow column: the header drops its labels and keeps the glyphs, or the
  // row wraps and the buttons lose their words.
  const compact = Boolean(onClose);
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
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4 text-[12px] text-muted">
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
            <span data-doc-author className="flex shrink-0 items-center gap-1 text-[12px] text-muted">
              <AssigneeAvatar displayName={author.displayName} avatar={author.avatar} size={14} />
              <span className="max-w-[160px] truncate">
                {isOwner ? t("by you") : t("by {name}", { name: author.displayName })}
              </span>
            </span>
          )}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <span
            className={`text-[11.5px] text-faint transition-opacity duration-300 ${
              saved ? "opacity-100" : "opacity-0"
            }`}
          >
            {t("Saved")}
          </span>
          <button
            type="button"
            onClick={() => setSide((open) => (open === "comments" ? null : "comments"))}
            title={t("Comments")}
            aria-label={t("Comments")}
            aria-pressed={side === "comments"}
            className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-medium transition-colors hover:border-border-strong hover:text-text ${
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
            className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-medium transition-colors hover:border-border-strong hover:text-text ${
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
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[12px] font-medium text-muted transition-colors hover:border-border-strong hover:text-text"
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
              onToggleShared={() => void toggleShared()}
            />
          ) : (
            !canEdit && (
              <span data-doc-level className="shrink-0 text-[11.5px] text-faint">
                {t(canComment ? "Can comment" : "Can view")}
              </span>
            )
          )}
          {isOwner && (
            <button
              type="button"
              onClick={() => void removePage()}
              aria-label={t("Delete page")}
              title={t("Delete page")}
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
              className="rounded-md px-1.5 py-1 text-[16px] leading-none text-muted transition-colors hover:bg-elevated hover:text-text"
            >
              ×
            </button>
          )}
        </div>
      </header>

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
      <div className="min-w-0 flex-1 overflow-y-auto">
        {/* A pane is measured by its own width, not the window's, so the reading
            margins it would use on a full tab would leave no text at all. */}
        <div
          className={`w-full pb-8 pt-6 ${
            onClose ? "px-5" : "px-10 lg:px-20 xl:px-32"
          }`}
        >
          <div className="flex items-start gap-3">
            <Menu
              width={196}
              triggerClassName="shrink-0 rounded-md p-1 text-[26px] leading-none transition-colors hover:bg-elevated"
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
                      className="rounded p-1 text-[18px] transition-colors hover:bg-elevated"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </Menu>
            <div className="min-w-0 flex-1">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onBlur={() => void saveTitle()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") setTitle(page.title);
                }}
                readOnly={!canEdit}
                aria-label={t("Page title")}
                className={`w-full rounded-md bg-transparent font-semibold leading-tight tracking-tight text-text placeholder:text-faint hover:bg-elevated/40 focus:bg-bg focus:outline-none ${
                  compact ? "text-[22px]" : "text-[28px]"
                }`}
                placeholder={t("Untitled")}
              />
            </div>
          </div>

          {error && <div className="mt-3 text-[12px] text-danger">{t(error)}</div>}

          {conflict && (
            <div data-doc-conflict className="mt-3 rounded-lg border border-border-strong bg-surface p-3 text-[13px]">
              <div className="font-medium text-text">
                {conflict.by
                  ? t("{name} changed this document while you were editing it", { name: conflict.by })
                  : t("This document changed while you were editing it")}
              </div>
              <div className="mt-1 text-[12px] text-muted">
                {t("Your text is not saved yet. Keeping it adds a new version; the other text stays in Updates.")}
              </div>
              <div className="mt-2 max-h-48 overflow-y-auto rounded border border-border bg-bg p-2">
                <DiffLines before={conflict.doc} after={doc} />
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={keepMine}
                  className="rounded-md bg-accent px-2 py-1 text-[12px] font-medium text-bg hover:bg-accent-hover"
                >
                  {t("Keep my text")}
                </button>
                <button
                  type="button"
                  onClick={useTheirs}
                  className="rounded-md border border-border px-2 py-1 text-[12px] font-medium text-muted hover:border-border-strong hover:text-text"
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
                  <div className="px-1 pb-0.5 text-[11.5px] text-faint">{t("Not placed in the page")}</div>
                )}
                {unplaced.map((child) => (
                  <div
                    key={child.id}
                    className="group flex items-center gap-2 rounded px-1 py-0.5 text-[14px] text-text hover:bg-elevated/60"
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
            {!canEdit && !doc.trim() && <p className="text-[13.5px] text-faint">{t("This page is empty.")}</p>}
            {(canEdit || doc.trim()) && (
              <DocumentEditor
                value={doc}
                onChange={editDoc}
                pages={pageCtx}
                editable={canEdit}
                placeholder={t("Write something, or type / for commands…")}
                anchors={anchors}
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
              />
            )}
            {canEdit && (
              <div className="mt-4 flex items-center gap-2">
                <Menu
                  width={240}
                  triggerClassName="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[12px] text-muted transition-colors hover:border-border-strong hover:text-text"
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
                  triggerClassName="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[12px] text-muted transition-colors hover:border-border-strong hover:text-text"
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
                className="flex items-center gap-1.5 rounded px-1 py-1 text-[13px] text-muted transition-colors hover:bg-elevated/60 hover:text-text"
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
  if (refs.length === 0) {
    return <div className="px-2 py-1.5 text-[12px] text-faint">{t("No pages yet.")}</div>;
  }
  return (
    <>
      {refs.slice(0, 40).map((ref) => (
        <MenuItem
          key={ref.id}
          onSelect={() => {
            close();
            onPick(ref);
          }}
        >
          <span className="flex items-center gap-2">
            <span className="shrink-0">{ref.icon ?? "📄"}</span>
            <span className="truncate">{ref.title}</span>
          </span>
        </MenuItem>
      ))}
    </>
  );
}
