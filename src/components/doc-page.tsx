"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Link2,
  Lock,
  Paperclip,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { Menu, MenuItem } from "@/components/menu";
import { Markdown, type PageContext, type PageRefEntry } from "@/components/markdown";
import { MarkdownEditor } from "@/components/markdown-editor";
import { AiEditPanel } from "@/components/ai-assist";
import { useUI } from "@/components/ui-context";
import {
  createPageAction,
  deletePageAction,
  setPageSharedAction,
  updatePageAction,
} from "@/app/pages-actions";
import { announceDocsDeleted } from "@/components/tab-events";
import type { DocPage, PageSummary } from "@/lib/pages";

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
  canEdit,
  isOwner,
  subpages,
  ctx,
  refs,
}: {
  workspaceId: string;
  page: DocPage;
  canEdit: boolean;
  isOwner: boolean;
  subpages: PageSummary[];
  ctx: PageContext;
  refs: PageRefEntry[];
}) {
  const router = useRouter();
  const { aiReady } = useUI();
  const [title, setTitle] = useState(page.title);
  const [icon, setIcon] = useState(page.icon);
  const [shared, setShared] = useState(page.shared);
  const [doc, setDoc] = useState(page.doc);
  const [editing, setEditing] = useState(canEdit && page.doc.trim() === "");
  const [saved, setSaved] = useState(false);
  const [aiPanel, setAiPanel] = useState<{ x: number; y: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function flushDoc() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    pending.current = null;
    if (next === null) return;
    setSaved(false);
    void updatePageAction(workspaceId, page.id, { doc: next }).then((result) => {
      if (!result.ok) setError(result.error);
      else setSaved(true);
    });
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
      if (next !== null) void updatePageAction(workspaceId, page.id, { doc: next });
    },
    [workspaceId, page.id]
  );

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
    if (!window.confirm(`Delete “${page.title}” and everything inside it?`)) return;
    const result = await deletePageAction(workspaceId, page.id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    announceDocsDeleted(result.data);
  }

  async function addSubpage() {
    const result = await createPageAction(workspaceId, { parentId: page.id });
    if (!result.ok) {
      setError(result.error);
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
    setEditing(true);
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
    setEditing(true);
    setAiPanel(null);
  }

  const base = `/${workspaceId}/docs/`;
  const parent = page.parentId ? refs.find((ref) => ref.id === page.parentId) ?? null : null;
  const placed = useMemo(() => placedPageKeys(doc), [doc]);
  const unplaced = subpages.filter(
    (child) => !placed.has(child.id) && !placed.has(child.title.toLowerCase())
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4 text-[12px] text-muted">
        <span className="flex items-center gap-1">
          {shared ? <Users size={13} /> : <Lock size={13} />}
          {shared ? "Shared with the workspace" : "Private"}
        </span>
        <span className="text-faint">·</span>
        <span className="truncate">{parent ? `Docs / ${parent.title}` : "Docs"}</span>
        <div className="ml-auto flex items-center gap-2">
          <span
            className={`text-[11.5px] text-faint transition-opacity duration-300 ${
              saved ? "opacity-100" : "opacity-0"
            }`}
          >
            Saved
          </span>
          {canEdit && aiReady && (
            <button
              type="button"
              onClick={(event) => openAi(event.currentTarget)}
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[12px] font-medium text-muted transition-colors hover:border-border-strong hover:text-text"
            >
              <Sparkles size={12} /> AI
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => {
                if (editing) flushDoc();
                setEditing(!editing);
              }}
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[12px] font-medium text-muted transition-colors hover:border-border-strong hover:text-text"
            >
              {editing ? <Check size={12} /> : <Pencil size={12} />}
              {editing ? "Done" : "Edit"}
            </button>
          )}
          {isOwner && (
            <button
              type="button"
              onClick={() => void toggleShared()}
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[12px] font-medium text-muted transition-colors hover:border-border-strong hover:text-text"
            >
              {shared ? <Lock size={12} /> : <Users size={12} />}
              {shared ? "Make private" : "Share"}
            </button>
          )}
          {isOwner && (
            <button
              type="button"
              onClick={() => void removePage()}
              aria-label="Delete page"
              title="Delete page"
              className="rounded-md border border-border p-1 text-muted transition-colors hover:border-border-strong hover:text-danger"
            >
              <Trash2 size={14} />
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
            acceptLabel: doc.trim() ? "Replace document" : "Insert",
          }}
          onClose={() => setAiPanel(null)}
          onAccept={acceptAi}
        />
      )}

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-5 py-8">
          <div className="flex items-start gap-3">
            <Menu
              width={196}
              triggerClassName="shrink-0 rounded-md p-1 text-[26px] leading-none transition-colors hover:bg-elevated"
              trigger={
                <span title="Change icon">
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
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => void saveTitle()}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") setTitle(page.title);
              }}
              readOnly={!canEdit}
              aria-label="Page title"
              className="min-w-0 flex-1 rounded-md bg-transparent text-[28px] font-semibold leading-tight tracking-tight text-text placeholder:text-faint hover:bg-elevated/40 focus:bg-bg focus:outline-none"
              placeholder="Untitled"
            />
          </div>

          {error && <div className="mt-3 text-[12px] text-danger">{error}</div>}

          <div className="mt-6">
            {unplaced.length > 0 && (
              <div className="mb-4 space-y-0.5">
                {unplaced.length < subpages.length && (
                  <div className="px-1 pb-0.5 text-[11.5px] text-faint">Not placed in the page</div>
                )}
                {unplaced.map((child) => (
                  <div
                    key={child.id}
                    className="group flex items-center gap-2 rounded px-1 py-0.5 text-[14px] text-text hover:bg-elevated/60"
                  >
                    <Link
                      href={`${base}${child.id}`}
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
                        title="Place in the page"
                        aria-label={`Place ${child.title} in the page`}
                        className="rounded p-0.5 text-faint opacity-0 transition-opacity hover:bg-elevated hover:text-text focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <Plus size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {editing && canEdit ? (
              <>
                <MarkdownEditor
                  value={doc}
                  onChange={editDoc}
                  placeholder="Write something, or press '-' for a list…"
                />
                <div className="mt-4 flex items-center gap-2">
                  <Menu
                    width={240}
                    triggerClassName="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[12px] text-muted transition-colors hover:border-border-strong hover:text-text"
                    trigger={
                      <>
                        <Link2 size={12} /> Link a page
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
                        <Paperclip size={12} /> Embed a page
                      </>
                    }
                  >
                    {(close) => <PagePicker refs={refs} close={close} onPick={(ref) => insertRef(ref, true)} />}
                  </Menu>
                </div>
              </>
            ) : (
              <>
                {doc.trim() ? (
                  <Markdown source={doc} pages={ctx} storageId={`doc:${page.id}`} />
                ) : (
                  <p className="text-[13.5px] text-faint">
                    {canEdit ? "This page is empty — press Edit to start writing." : "This page is empty."}
                  </p>
                )}
              </>
            )}
          </div>

          <div className="mt-10 border-t border-border pt-3">
            <button
              type="button"
              onClick={() => void addSubpage()}
              className="flex items-center gap-1.5 rounded px-1 py-1 text-[13px] text-muted transition-colors hover:bg-elevated/60 hover:text-text"
            >
              <Plus size={13} /> Add a subpage
            </button>
          </div>
        </div>
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
  if (refs.length === 0) {
    return <div className="px-2 py-1.5 text-[12px] text-faint">No pages yet.</div>;
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
