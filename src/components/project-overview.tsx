"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  Bold,
  Code,
  History,
  Italic,
  MessageSquare,
  RotateCcw,
  Sparkles,
  SquareArrowOutUpRight,
  Strikethrough,
  Trash2,
  X,
} from "lucide-react";
import {
  addOverviewCommentAction,
  markDocEditsSeenAction,
  removeOverviewCommentAction,
  restoreDocEditAction,
  updateProjectAction,
} from "@/app/actions";
import { AssigneeAvatar } from "@/components/issue-table";
import { AiEditPanel, AiTaskDialog } from "@/components/ai-assist";
import {
  Markdown,
  type IssueContext,
  type IssueRefEntry,
  type PageContext,
} from "@/components/markdown";
import { MarkdownEditor, type MarkdownEditorHandle } from "@/components/markdown-editor";
import { ISSUE_DELETED, useUI, type DeletedIssue } from "@/components/ui-context";
import { timeAgo } from "@/lib/format";
import {
  formatPassage,
  issueReference,
  referencedIssueLabels,
  replaceIssueReference,
  replacePassage,
  type BlockSpan,
  type PassageStyle,
} from "@/lib/markdown";
import type { AiEditAction } from "@/lib/ai-constants";
import type {
  IssueWithLabels,
  OverviewAccess,
  OverviewComment,
  OverviewDocEdit,
  Project,
} from "@/lib/issues";
import { useLocale, useT } from "@/components/i18n-context";
import { PAGE_INSET } from "@/lib/page-chrome";

type ProjectDetail = Project & { doc: string; createdBy: string | null };
type CommentAnchor = { quote: string; occurrence: number };
type TextChar = { node: Text; offset: number };
type CommentThread = { anchor: CommentAnchor; comments: OverviewComment[] };
// A comment marker parked at the top-right corner of a highlighted passage. Coordinates
// are relative to the editor wrapper so they scroll with the document.
type CommentPin = { key: string; anchor: CommentAnchor; top: number; left: number };

type FormatButton = {
  style: PassageStyle;
  label: string;
  Icon: ComponentType<{ size?: number | string; className?: string }>;
};

// Linear's floating toolbar, minus what Markdown cannot express (underline).
const FORMAT_BUTTONS: FormatButton[] = [
  { style: "bold", label: "Bold", Icon: Bold },
  { style: "italic", label: "Italic", Icon: Italic },
  { style: "strike", label: "Strikethrough", Icon: Strikethrough },
  { style: "code", label: "Inline code", Icon: Code },
];

// Comments are pinned to a passage the way Google Docs pins them: the quote plus which
// occurrence of it. Offsets would drift on the next edit; text that no longer exists
// simply stops being highlighted.
function normalizeWithMap(root: HTMLElement): {
  text: string;
  chars: TextChar[];
  // Where a glyph-only node (bullet, tick) sat in the text, so a selection that starts
  // or ends on it still maps to the nearest real character.
  glyphs: Map<Text, number>;
} {
  const chars: TextChar[] = [];
  const glyphs = new Map<Text, number>();
  let text = "";
  let atSpace = false;
  // Blocks and lines are joined by a space in the stored Markdown (a line break reads as
  // one), but the editor renders them as separate elements with no whitespace between.
  let lastLine: Element | null = null;
  const spacer = (node: Text) => {
    if (atSpace || text.length === 0) return;
    text += " ";
    chars.push({ node, offset: 0 });
    atSpace = true;
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    // List bullets and checkbox ticks are chrome, not text: the stored Markdown has no
    // character for them, so counting them here would misalign every passage after.
    if (node.parentElement?.closest("[data-md-glyph]")) {
      glyphs.set(node, text.length);
      continue;
    }
    const line = node.parentElement?.closest("[data-block-index], p, li") ?? null;
    if (lastLine && line !== lastLine) spacer(node);
    lastLine = line;
    for (let offset = 0; offset < node.data.length; offset++) {
      const char = node.data[offset];
      if (/\s/.test(char)) {
        if (!atSpace && text.length > 0) {
          text += " ";
          chars.push({ node, offset });
          atSpace = true;
        }
      } else {
        text += char;
        chars.push({ node, offset });
        atSpace = false;
      }
    }
  }
  return { text, chars, glyphs };
}

// Index in the normalized text of the first character at or after a DOM boundary —
// which is the start for a selection and the exclusive end for the same selection.
// A selection that ends exactly at the end of a text node has no char at that offset,
// so fall through to the position right after the node's last character. A boundary
// inside a glyph node (the bullet a drag starts on) lands where that node sits.
function indexAt(
  chars: TextChar[],
  glyphs: Map<Text, number>,
  container: Node,
  offset: number
): number | null {
  let last = -1;
  for (let i = 0; i < chars.length; i++) {
    if (chars[i].node !== container) continue;
    if (chars[i].offset >= offset) return i;
    last = i;
  }
  if (last >= 0) return last + 1;
  return glyphs.get(container as Text) ?? null;
}

function nthIndexOf(text: string, quote: string, occurrence: number): number {
  if (!quote) return -1;
  let index = -1;
  let from = 0;
  for (let i = 0; i < occurrence; i++) {
    index = text.indexOf(quote, from);
    if (index < 0) return -1;
    from = index + quote.length;
  }
  return index;
}

function countBefore(text: string, quote: string, end: number): number {
  let count = 0;
  let from = 0;
  while (true) {
    const index = text.indexOf(quote, from);
    if (index < 0 || index >= end) return count;
    count += 1;
    from = index + quote.length;
  }
}

function anchorKey(anchor: CommentAnchor): string {
  return `${anchor.occurrence}\u0000${anchor.quote}`;
}

// Styles already present where the selection starts, so the toolbar can show which
// button would be a toggle-off rather than an addition.
function stylesAt(node: Node): PassageStyle[] {
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element | null);
  if (!element) return [];
  const styles: PassageStyle[] = [];
  if (element.closest("strong")) styles.push("bold");
  if (element.closest("em")) styles.push("italic");
  if (element.closest("s")) styles.push("strike");
  if (element.closest("code")) styles.push("code");
  return styles;
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((key) => b.has(key));
}

// Opening a page linked from the document unmounts the Overview, so the offset has to
// live outside the component. Per window, not per server: a fresh load starts at the top.
const scrollOffsets = new Map<string, number>();

// Repainting moves the markers by a fraction of a pixel on some layouts; ignore those
// so the paint loop does not re-render on every frame.
function samePins(a: CommentPin[], b: CommentPin[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (pin, i) =>
      pin.key === b[i].key &&
      Math.abs(pin.top - b[i].top) < 1 &&
      Math.abs(pin.left - b[i].left) < 1
  );
}

function CommentComposer({
  draft,
  posting,
  placeholder,
  onDraft,
  onPost,
}: {
  draft: string;
  posting: boolean;
  placeholder: string;
  onDraft: (next: string) => void;
  onPost: () => void;
}) {
  const t = useT();
  return (
    <div className="flex items-start gap-2">
      <textarea
        autoFocus
        value={draft}
        onChange={(event) => onDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onPost();
          }
        }}
        rows={2}
        placeholder={placeholder}
        className="min-h-[38px] flex-1 resize-y rounded-lg border border-border bg-bg px-2.5 py-2 text-body text-text placeholder:text-faint focus:border-border-strong focus:outline-none"
      />
      <button
        type="button"
        onClick={onPost}
        disabled={!draft.trim() || posting}
        className="rounded-md bg-accent px-3 py-1.5 text-small font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {t("Comment")}
      </button>
    </div>
  );
}

export function ProjectOverview({
  workspaceId,
  project,
  issues,
  pages,
  access,
  comments,
  edits,
  unseenDocEdits,
  currentUserId,
  trashedTitles,
}: {
  workspaceId: string;
  project: ProjectDetail;
  issues: IssueWithLabels[];
  pages: PageContext;
  access: OverviewAccess;
  comments: OverviewComment[];
  edits: OverviewDocEdit[];
  unseenDocEdits: number;
  currentUserId: string;
  trashedTitles: Record<string, string>;
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const { setComposerOpen, openIssue, openPage, aiReady } = useUI();
  const [doc, setDoc] = useState(project.doc);
  // Document history for ⌘Z / ⌘⇧Z. Snapshots are whole strings: the document is small,
  // and a string cannot drift the way per-keystroke operation records can.
  const historyPast = useRef<string[]>([]);
  const historyFuture = useRef<string[]>([]);
  const docRef = useRef(project.doc);
  // Tasks made from a passage may belong to another project; keep them for the chip
  // even though this page only loaded its own tasks. Fresh task rows win over that
  // snapshot so edits made in the side panel (priority, status, title) reach the chip.
  const [createdIssues, setCreatedIssues] = useState<Record<string, IssueRefEntry>>({});
  // Tasks trashed while this page is open. The page's own task list only loses them
  // after the server re-render, so the reference would keep drawing a live chip until
  // then; these titles let it read as the words it replaced immediately.
  const [deletedNow, setDeletedNow] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [thread, setThread] = useState(comments);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  // A selection offers t("Comment"); the marker sits at the corner of the highlighted text
  // and clicking it opens that thread in a small card. Nothing lives in a side panel.
  const [selection, setSelection] = useState<{
    anchor: CommentAnchor;
    x: number;
    y: number;
    // A passage spanning several blocks can only take inline styles here: swapping it
    // for one task reference or one comment marker would rewrite every block it covers.
    multiLine?: boolean;
    // Set when the passage sits inside a trashed task's fallback text, whose visible
    // title is not what the markdown stores; the reference is swapped by id instead.
    refId?: string;
    // Where the passage sits in the editor's own blocks. Formatting edits these spans
    // directly, so a repeated phrase elsewhere can never be styled by accident.
    parts?: BlockSpan[];
    active?: PassageStyle[];
  } | null>(null);
  // Text highlighted inside the line that is currently open for editing. It only lives
  // in the editor's draft, so the toolbar asks the editor for a committed anchor.
  const [draftSelection, setDraftSelection] = useState<{
    text: string;
    x: number;
    y: number;
  } | null>(null);
  // Blocks picked by dragging down the document. There is no text range to anchor, so
  // the toolbar only offers inline styles, applied to every selected line.
  const [rangeSelection, setRangeSelection] = useState<{ x: number; y: number } | null>(null);
  const [composer, setComposer] = useState<{
    anchor: CommentAnchor;
    x: number;
    y: number;
  } | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [replyKey, setReplyKey] = useState<string | null>(null);
  // Anthropic-style fallback: threads whose quoted text was edited away have no marker
  // on the page, so the count next to t("Description") opens them.
  const [orphansOpen, setOrphansOpen] = useState(false);
  const [orphanPos, setOrphanPos] = useState({ x: 0, y: 0 });
  const [pins, setPins] = useState<CommentPin[]>([]);
  // Editing column width, measured during the paint pass so the popover can stay inside it.
  const [editorWidth, setEditorWidth] = useState(0);
  // Anchors whose quoted passage no longer exists in the document.
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [unseen, setUnseen] = useState(unseenDocEdits);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollKey = `${workspaceId}:${project.id}`;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const descRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MarkdownEditorHandle | null>(null);
  const anchorRanges = useRef<{ anchor: CommentAnchor; range: Range }[]>([]);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped whenever the reader clicks elsewhere, so a formatting finish cannot re-select
  // a passage after they have moved on.
  const restoreToken = useRef(0);
  // AI panel opened from a passage or from the document header. A passage keeps the
  // anchor it was picked with, so the accepted rewrite lands where the reader selected,
  // even across blocks; the document mode replaces (or appends to) the whole doc.
  const [aiPanel, setAiPanel] = useState<{
    kind: "selection" | "document";
    x: number;
    y: number;
    text: string;
    context?: string;
    anchor?: CommentAnchor;
    source?: string;
  } | null>(null);
  const [aiTasks, setAiTasks] = useState<{ prompt: string; context?: string } | null>(null);

  // Following a page link leaves this component behind; coming back should land where the
  // reader left off. Restore before paint, or the document is seen jumping to the top.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const offset = scrollOffsets.get(scrollKey);
    if (!el || !offset) return;
    el.scrollTop = offset;
    // Tall blocks settle a frame later; a clamped offset would otherwise stay near the top.
    const frame = requestAnimationFrame(() => {
      if (el.scrollTop !== offset) el.scrollTop = offset;
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollKey]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // The offset is read while scrolling, never on unmount: by then the node is detached
    // and reports 0, which would wipe the position it is meant to keep.
    const onScroll = () => {
      scrollOffsets.set(scrollKey, el.scrollTop);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
    };
  }, [scrollKey]);

  // A task made from a passage is kept in `createdIssues` so its chip survives even
  // when the task lives in another project. Deleting it must drop that copy too —
  // otherwise the chip outlives the task and keeps opening a row that is now in Trash.
  useEffect(() => {
    const onDeleted = (event: Event) => {
      const detail = (event as CustomEvent<DeletedIssue>).detail;
      if (!detail?.id) return;
      setDeletedNow((prev) => ({ ...prev, [detail.id]: detail.title }));
      setCreatedIssues((prev) => {
        if (!(detail.id in prev)) return prev;
        const next = { ...prev };
        delete next[detail.id];
        return next;
      });
    };
    window.addEventListener(ISSUE_DELETED, onDeleted);
    return () => window.removeEventListener(ISSUE_DELETED, onDeleted);
  }, []);

  // Task references read their priority and title live from the project's task list.
  const issueContext: IssueContext = useMemo(() => {
    const lookup: Record<string, IssueRefEntry> = {};
    for (const issue of issues) {
      lookup[issue.id] = {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        priority: issue.priority,
        status: issue.status,
      };
    }
    const resolved = { ...createdIssues, ...lookup };
    for (const id of Object.keys(deletedNow)) delete resolved[id];
    // A reference can outlive its task: trashed tasks keep their title, but one purged
    // from the Trash leaves no row behind. Both read as plain text, so a dead reference
    // never looks like a live chip — here and inside the editor, which opens it.
    const gone: Record<string, string> = { ...trashedTitles, ...deletedNow };
    for (const [id, label] of Object.entries(referencedIssueLabels(doc))) {
      if (!(id in resolved) && !(id in gone)) gone[id] = label;
    }
    return { lookup: resolved, deleted: gone, onOpen: openIssue };
  }, [issues, createdIssues, openIssue, trashedTitles, doc, deletedNow]);

  // A page referenced from the Overview opens beside it, the same way a task does,
  // instead of replacing the tab you were reading.
  const pageContext: PageContext = useMemo(
    () => ({ ...pages, onOpen: openPage }),
    [pages, openPage]
  );

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
    void save({ doc: next });
  }

  function scheduleDoc(next: string) {
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flushDoc, 700);
  }

  // Notion writes quietly in the background. One request per keystroke would make the
  // document feel like it was fighting the network, so typing only schedules a write.
  // Every document change goes through here, which is also what feeds undo/redo.
  function editDoc(next: string) {
    if (next === docRef.current) return;
    historyPast.current.push(docRef.current);
    if (historyPast.current.length > 200) historyPast.current.shift();
    historyFuture.current = [];
    docRef.current = next;
    setDoc(next);
    scheduleDoc(next);
  }

  // ⌘Z steps back one committed change (a line blur, a format, a task reference…).
  // The editor's open line keeps its own snapshots for programmatic formatting and asks
  // for these only when it has nothing left to undo.
  function undoDoc(): boolean {
    const previous = historyPast.current.pop();
    if (previous === undefined) return false;
    historyFuture.current.push(docRef.current);
    docRef.current = previous;
    setDoc(previous);
    scheduleDoc(previous);
    return true;
  }

  function redoDoc(): boolean {
    const next = historyFuture.current.pop();
    if (next === undefined) return false;
    historyPast.current.push(docRef.current);
    docRef.current = next;
    setDoc(next);
    scheduleDoc(next);
    return true;
  }

  // The keydown listener is registered once, so it reaches the current undo/redo through
  // a ref instead of capturing the first render's closures.
  const historyActions = useRef<{ undo: () => boolean; redo: () => boolean }>({
    undo: () => false,
    redo: () => false,
  });
  useEffect(() => {
    historyActions.current = { undo: undoDoc, redo: redoDoc };
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() !== "z") return;
      const target = event.target as HTMLElement | null;
      // Inputs keep the browser's own undo; the editor hands control back when its
      // draft has nothing left, so ⌘Z reaches the document from there too.
      if (target?.closest("textarea, input, [contenteditable='true']")) return;
      event.preventDefault();
      if (event.shiftKey) historyActions.current.redo();
      else historyActions.current.undo();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

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

  function closePopovers() {
    setOpenKey(null);
    setReplyKey(null);
    setOrphansOpen(false);
    setComposer(null);
  }

  function openComposer(anchor: CommentAnchor, x: number, y: number) {
    closePopovers();
    setDraft("");
    setComposer({
      anchor,
      x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - 336)),
      y: Math.min(Math.max(8, y + 30), Math.max(8, window.innerHeight - 190)),
    });
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }

  // Linear's "turn the passage into an issue": the first line becomes the task title,
  // the full passage rides along as its description, and once the task exists the
  // passage itself is replaced by an inline reference to it. `source` is the document
  // the anchor was measured against — the current draft line when it came from the editor.
  function taskFromSelection(anchor: CommentAnchor, source = doc, refId?: string) {
    const text = anchor.quote.trim();
    const flat = text.replace(/\s+/g, " ");
    const title = flat.length > 120 ? `${flat.slice(0, 119)}…` : flat;
    closePopovers();
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    setComposerOpen(true, null, {
      title,
      description: text === title ? "" : text,
      onCreated: (issue) => {
        setCreatedIssues((prev) => ({
          ...prev,
          [issue.id]: {
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title,
            priority: issue.priority,
            status: issue.status,
          },
        }));
        // A reader who may not edit still gets the task; the document stays untouched.
        if (!access.canEdit) return;
        const replacement = issueReference(issue.identifier, issue.id);
        const next = refId
          ? replaceIssueReference(source, refId, replacement)
          : replacePassage(source, anchor, replacement);
        if (next === null || next === source) return;
        editDoc(next);
        router.refresh();
      },
    });
  }

  // A highlight inside the open line has no stored passage yet: commit that line first,
  // then run the same task/comment flow on the plain-text anchor the editor measured.
  function taskFromDraft() {
    if (!draftSelection || !access.canEdit) return;
    const taken = editorRef.current?.takeDraftSelection() ?? null;
    setDraftSelection(null);
    if (!taken) return;
    taskFromSelection(taken.anchor, taken.source);
  }

  function commentOnDraft() {
    if (!draftSelection || !access.canComment) return;
    const spot = draftSelection;
    const taken = editorRef.current?.takeDraftSelection() ?? null;
    setDraftSelection(null);
    if (!taken) return;
    openComposer(taken.anchor, spot.x, spot.y);
  }

  // The AI panel works from the same anchors as tasks and comments: the visible passage
  // plus the document it was measured against. Replacing through `replacePassage` keeps
  // cross-line selections intact, unlike a DOM-range edit.
  function openAiForSelection() {
    if (!aiReady || !access.canEdit) return;
    if (draftSelection) {
      const spot = draftSelection;
      const taken = editorRef.current?.takeDraftSelection() ?? null;
      setDraftSelection(null);
      setSelection(null);
      if (!taken) return;
      setAiPanel({
        kind: "selection",
        x: spot.x,
        y: spot.y + 34,
        text: taken.anchor.quote,
        context: taken.source,
        anchor: taken.anchor,
        source: taken.source,
      });
      return;
    }
    if (rangeSelection) {
      const taken = editorRef.current?.takeBlockSelection() ?? null;
      if (!taken) return;
      setAiPanel({
        kind: "selection",
        x: rangeSelection.x,
        y: rangeSelection.y + 34,
        text: taken.anchor.quote,
        context: taken.source,
        anchor: taken.anchor,
        source: taken.source,
      });
      return;
    }
    if (!selection) return;
    setAiPanel({
      kind: "selection",
      x: selection.x,
      y: selection.y + 34,
      text: selection.anchor.quote,
      context: docRef.current,
      anchor: selection.anchor,
      source: docRef.current,
    });
    setSelection(null);
  }

  function openAiForDocument(origin: HTMLElement) {
    if (!aiReady || !access.canEdit) return;
    const rect = origin.getBoundingClientRect();
    // The button sits in the bottom-right corner, so the panel opens above it rather than
    // growing past the window edge.
    const below = rect.bottom + 6;
    const y = below > window.innerHeight - 400 ? Math.max(12, rect.top - 396) : below;
    setSelection(null);
    setDraftSelection(null);
    setAiPanel({
      kind: "document",
      x: rect.right - 400,
      y,
      text: docRef.current,
    });
  }

  function acceptAi(text: string, action: AiEditAction) {
    const panel = aiPanel;
    setAiPanel(null);
    if (!panel) return;
    if (panel.kind === "document") {
      const next =
        action === "continue"
          ? docRef.current.trim()
            ? `${docRef.current.replace(/\s+$/, "")}\n\n${text}`
            : text
          : text;
      editDoc(next);
      return;
    }
    if (!panel.anchor || !panel.source) return;
    const next = replacePassage(panel.source, panel.anchor, text);
    if (next === null) {
      setError(t("Could not find that passage any more — the document may have changed."));
      return;
    }
    if (next === panel.source) return;
    editDoc(next);
  }

  function openAiTasks() {
    if (!aiPanel) return;
    const passage = aiPanel.text;
    setAiPanel(null);
    setAiTasks({
      prompt: `Break this passage into concrete tasks:\n\n${passage}`,
      context: passage,
    });
    window.getSelection()?.removeAllRanges();
  }

  // The toolbar acts on the stored Markdown, not on the highlighted DOM. A passage that
  // sits in known blocks is edited through its block-local offsets; the anchor fallback
  // only remains for selections made before an external document change.
  function applyFormat(style: PassageStyle) {
    if (!access.canEdit) return;
    // Text picked inside the open line only exists in the editor's draft until blur,
    // so its markers are written there instead of into the saved document.
    if (draftSelection) {
      editorRef.current?.formatSelection(style);
      return;
    }
    // A drag across blocks is the editor's own block selection: it knows which lines to
    // wrap, so it writes those markers itself.
    if (rangeSelection) {
      editorRef.current?.formatRange(style);
      return;
    }
    if (!selection) return;
    const parts = selection.parts ?? [];
    if (parts.length > 0) {
      editorRef.current?.formatParts(parts, style);
      // Formatting only adds or removes markers, so the visible text keeps its offsets.
      // Re-select the same passage after the re-render: the toolbar stays up and the
      // same button toggles the style off again.
      const token = ++restoreToken.current;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (restoreToken.current !== token) return;
          restoreSelection(parts);
        });
      });
      return;
    }
    const next = formatPassage(docRef.current, selection.anchor, style);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    if (next === null || next === docRef.current) return;
    editDoc(next);
  }

  // Rebuilds the browser selection from block-local offsets after the editor rewrote
  // markers. `parts` index the editor's own blocks, which the re-render preserves.
  function restoreSelection(parts: BlockSpan[]) {
    const root = descRef.current;
    if (!root || parts.length === 0) return;
    const first = parts[0];
    const last = parts[parts.length - 1];
    const startEl = root.querySelector<HTMLElement>(`[data-block-index="${first.block}"]`);
    const endEl = root.querySelector<HTMLElement>(`[data-block-index="${last.block}"]`);
    if (!startEl || !endEl) return;
    const startMap = normalizeWithMap(startEl);
    const endMap = normalizeWithMap(endEl);
    const startChar = startMap.chars[Math.min(first.from, startMap.chars.length - 1)];
    const endChar = endMap.chars[Math.max(0, Math.min(last.to - 1, endMap.chars.length - 1))];
    if (!startChar || !endChar) return;
    const range = document.createRange();
    try {
      range.setStart(startChar.node, Math.min(startChar.offset, startChar.node.data.length));
      range.setEnd(endChar.node, Math.min(endChar.node.data.length, endChar.offset + 1));
    } catch {
      return;
    }
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    const active = stylesAt(range.startContainer);
    setSelection((prev) => (prev ? { ...prev, active } : prev));
  }

  // A drag inside a rendered block is a passage; a drag across blocks stays the editor's
  // own block selection (copy/delete), but still offers per-line inline styles.
  const pickSelection = useCallback(() => {
    const root = descRef.current;
    if (!root || composer) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setSelection(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) {
      setSelection(null);
      return;
    }
    const blockOf = (node: Node) =>
      (node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element))?.closest(
        "[data-block-index]"
      );
    const startBlock = blockOf(range.startContainer);
    const endBlock = blockOf(range.endContainer);
    const multiLine = Boolean(startBlock && endBlock && startBlock !== endBlock);
    const { text, chars, glyphs } = normalizeWithMap(root);
    const from = indexAt(chars, glyphs, range.startContainer, range.startOffset);
    const to = indexAt(chars, glyphs, range.endContainer, range.endOffset);
    if (from == null || to == null || to <= from) {
      setSelection(null);
      return;
    }
    const raw = text.slice(from, to);
    const quote = raw.trim();
    if (!quote) {
      setSelection(null);
      return;
    }
    const start = from + (raw.length - raw.trimStart().length);
    // Block-local spans for formatting. A quote can repeat elsewhere in the document,
    // but an offset inside one known block cannot; this is what makes repeated phrases
    // and cross-line passages format in the right place.
    const parts: BlockSpan[] = [];
    if (startBlock && endBlock) {
      const blocks = Array.from(root.querySelectorAll<HTMLElement>("[data-block-index]"));
      const first = blocks.indexOf(startBlock as HTMLElement);
      const last = blocks.indexOf(endBlock as HTMLElement);
      if (first >= 0 && last >= first) {
        for (let i = first; i <= last; i++) {
          const element = blocks[i];
          const index = Number(element.getAttribute("data-block-index"));
          if (!Number.isFinite(index)) continue;
          const map = normalizeWithMap(element);
          if (map.chars.length === 0) continue;
          const partFrom =
            i === first
              ? indexAt(map.chars, map.glyphs, range.startContainer, range.startOffset)
              : 0;
          const partTo =
            i === last ? indexAt(map.chars, map.glyphs, range.endContainer, range.endOffset) : map.chars.length;
          if (partFrom === null || partTo === null || partTo <= partFrom) continue;
          parts.push({ block: index, from: partFrom, to: partTo });
        }
      }
    }
    const rect = range.getBoundingClientRect();
    // Text that belongs to a trashed task's reference is displayed as its title while
    // the markdown keeps the identifier, so remember the task it came from.
    const elementOf = (node: Node) =>
      node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
    const startRef = elementOf(range.startContainer)?.closest("[data-issue-ref]");
    const endRef = elementOf(range.endContainer)?.closest("[data-issue-ref]");
    const refId =
      startRef && startRef === endRef ? startRef.getAttribute("data-issue-ref") ?? undefined : undefined;
    setSelection({
      anchor: { quote: quote.slice(0, 1_000), occurrence: countBefore(text, quote, start) + 1 },
      x: Math.min(Math.max(12, rect.left), window.innerWidth - 120),
      y: Math.max(8, rect.top - 34),
      multiLine,
      refId,
      parts,
      active: stylesAt(range.startContainer),
    });
  }, [composer]);

  // Release outside the editor still counts: dragging past the last word (or off the
  // wrapping div) is how people select a trailing line. Listening on the document also
  // catches releases over the toolbar or a pin, which must not reset the passage.
  useEffect(() => {
    const onUp = (event: Event) => {
      const target = event.target as Element | null;
      if (target?.closest("[data-overview-toolbar], [data-overview-pop], [data-overview-pin]")) {
        return;
      }
      if (!target?.closest("textarea[data-md-draft]")) setDraftSelection(null);
      pickSelection();
    };
    document.addEventListener("mouseup", onUp);
    return () => document.removeEventListener("mouseup", onUp);
  }, [pickSelection]);

  // The shortcut listener subscribes when a passage exists, but it must always run the
  // latest formatter (it closes over the document, permissions and the live selection).
  const formatAction = useRef<(style: PassageStyle) => void>(() => {});
  useEffect(() => {
    formatAction.current = applyFormat;
  });

  // ⌘B / ⌘I / ⇧⌘X / ⌘E also act on a passage picked in the rendered document, the way
  // Notion and Linear do, without having to reach for the floating toolbar. Anything in
  // the editor handles its own shortcuts (textarea draft and block range alike).
  useEffect(() => {
    if (!selection) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      const style: PassageStyle | null =
        key === "b" && !event.shiftKey
          ? "bold"
          : key === "i" && !event.shiftKey
            ? "italic"
            : key === "e" && !event.shiftKey
              ? "code"
              : key === "x" && event.shiftKey
                ? "strike"
                : null;
      if (!style) return;
      const target = event.target as Element | null;
      if (target?.closest("input, textarea, [contenteditable='true'], [data-md-draft], [data-block-index]")) {
        return;
      }
      event.preventDefault();
      formatAction.current(style);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selection]);

  // Paint existing annotations with the CSS Custom Highlight API: the markdown tree is
  // React-managed (and editable), so wrapping the text in <mark> elements would fight
  // every keystroke. The same pass parks a comment marker at each passage's top-right.
  useEffect(() => {
    const root = descRef.current;
    const wrap = wrapRef.current;
    if (!root || !wrap) return;
    const api = window as unknown as {
      CSS?: { highlights?: Map<string, unknown> };
      Highlight?: new (...ranges: Range[]) => unknown;
    };
    const highlights = api.CSS?.highlights;
    const HighlightCtor = api.Highlight;
    if (!highlights || !HighlightCtor) return;
    let frame = 0;

    const paint = () => {
      const { text, chars } = normalizeWithMap(root);
      const unique = new Map<string, { anchor: CommentAnchor; range: Range }>();
      const nextMissing = new Set<string>();
      for (const comment of thread) {
        if (!comment.quote) continue;
        const anchor = { quote: comment.quote, occurrence: comment.occurrence };
        const key = anchorKey(anchor);
        if (unique.has(key)) continue;
        const index = nthIndexOf(text, anchor.quote, anchor.occurrence);
        if (index < 0) {
          nextMissing.add(key);
          continue;
        }
        const first = chars[index];
        const last = chars[index + anchor.quote.length - 1];
        if (!first || !last) continue;
        const range = document.createRange();
        range.setStart(first.node, first.offset);
        range.setEnd(last.node, last.offset + 1);
        unique.set(key, { anchor, range });
      }
      anchorRanges.current = [...unique.values()];
      setMissing((prev) => (setsEqual(prev, nextMissing) ? prev : nextMissing));
      const wrapRect = wrap.getBoundingClientRect();
      const width = wrap.clientWidth;
      setEditorWidth((prev) => (Math.abs(prev - width) < 1 ? prev : width));
      const nextPins = anchorRanges.current.map(({ anchor, range }) => {
        const rect = range.getBoundingClientRect();
        return {
          key: anchorKey(anchor),
          anchor,
          top: Math.max(0, Math.round(rect.top - wrapRect.top) - 9),
          left: Math.max(0, Math.round(Math.min(rect.right - wrapRect.left - 1, width - 21))),
        };
      });
      setPins((prev) => (samePins(prev, nextPins) ? prev : nextPins));
      if (anchorRanges.current.length === 0) {
        highlights.delete("overview-comment");
        return;
      }
      highlights.set(
        "overview-comment",
        new HighlightCtor(...anchorRanges.current.map((entry) => entry.range))
      );
    };

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(paint);
    };
    paint();
    const observer = new MutationObserver(schedule);
    observer.observe(root, { subtree: true, childList: true, characterData: true });
    // Widening the column (history drawer, window resize) reflows every line; the
    // markers have to follow or they float over the wrong passage.
    const resize = new ResizeObserver(schedule);
    resize.observe(wrap);
    window.addEventListener("resize", schedule);
    return () => {
      observer.disconnect();
      resize.disconnect();
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
      highlights.delete("overview-comment");
    };
  }, [thread]);

  // Dismiss the floating cards on an outside click or Escape, the way the rest of the
  // app's menus behave.
  useEffect(() => {
    if (!openKey && !orphansOpen && !composer) return;
    const dismiss = () => {
      setOpenKey(null);
      setReplyKey(null);
      setOrphansOpen(false);
      setComposer(null);
    };
    const onDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest("[data-overview-pop], [data-overview-pin]")) return;
      dismiss();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openKey, orphansOpen, composer]);

  async function postComment(anchor: CommentAnchor, mode: "new" | "reply") {
    const body = draft.trim();
    if (!body || posting) return;
    setPosting(true);
    setError(null);
    const result = await addOverviewCommentAction(workspaceId, project.id, body, anchor);
    setPosting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setThread(result.data);
    setDraft("");
    setReplyKey(null);
    if (mode === "new") {
      setComposer(null);
      setOpenKey(anchorKey(anchor));
    }
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }

  async function deleteComment(commentId: string) {
    setError(null);
    const result = await removeOverviewCommentAction(workspaceId, project.id, commentId);
    if (!result.ok) setError(result.error);
    else setThread(result.data);
  }

  function toggleHistory() {
    const next = !historyOpen;
    setHistoryOpen(next);
    closePopovers();
    // Opening the log is reading it: clear the badge and remember the moment, so edits
    // made after this point are the next unread ones.
    if (next && unseen > 0) {
      setUnseen(0);
      void markDocEditsSeenAction(workspaceId, project.id);
    }
  }

  function openOrphans(event: MouseEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    setOrphansOpen((prev) => !prev);
    setOrphanPos({
      x: Math.max(8, Math.min(rect.left, Math.max(8, window.innerWidth - 356))),
      y: rect.bottom + 6,
    });
    setOpenKey(null);
    setComposer(null);
    setReplyKey(null);
  }

  async function restoreEdit(edit: OverviewDocEdit) {
    if (restoring) return;
    setRestoring(edit.id);
    setError(null);
    // Drop an unsaved keystroke so the debounce cannot land right after the restore.
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
    const result = await restoreDocEditAction(workspaceId, project.id, edit.id);
    setRestoring(null);
    setConfirmRestore(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    editDoc(result.data.doc);
    router.refresh();
  }

  // One card per anchored passage; a null quote is legacy data and groups as t("General").
  const threads = useMemo(() => {
    const groups = new Map<string, CommentThread>();
    for (const comment of thread) {
      const anchor = comment.quote
        ? { quote: comment.quote, occurrence: comment.occurrence }
        : { quote: "", occurrence: 1 };
      const key = anchorKey(anchor);
      const group = groups.get(key);
      if (group) group.comments.push(comment);
      else groups.set(key, { anchor, comments: [comment] });
    }
    return [...groups.values()].sort((a, b) =>
      a.comments[0].createdAt.localeCompare(b.comments[0].createdAt)
    );
  }, [thread]);

  // Threads whose passage is gone (or was never anchored) have no marker on the page.
  const orphanThreads = useMemo(
    () =>
      threads.filter(
        ({ anchor }) => !anchor.quote || missing.has(anchorKey(anchor))
      ),
    [threads, missing]
  );
  const orphanComments = orphanThreads.reduce((n, group) => n + group.comments.length, 0);
  const openThread = openKey
    ? threads.find((group) => anchorKey(group.anchor) === openKey) ?? null
    : null;
  const openPin = openKey ? pins.find((pin) => pin.key === openKey) ?? null : null;
  const wrapWidth = editorWidth || 680;

  function threadBody(group: CommentThread) {
    const key = anchorKey(group.anchor);
    const editedAway = Boolean(group.anchor.quote) && missing.has(key);
    return (
      <div>
        <p className="text-small font-medium leading-snug text-text">
          {group.anchor.quote ? `“${group.anchor.quote}”` : t("General comment")}
        </p>
        {editedAway && (
          <p className="mt-0.5 text-caption text-faint">{t("The highlighted text has changed.")}</p>
        )}
        <ul className="mt-2 max-h-[260px] space-y-2.5 overflow-y-auto pr-0.5">
          {group.comments.map((comment) => (
            <li key={comment.id} className="flex items-start gap-2">
              <AssigneeAvatar
                displayName={comment.author?.displayName ?? t("Unknown")}
                avatar={comment.author?.avatar ?? null}
                size={20}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-small font-medium text-text">
                    {comment.author?.displayName ?? t("Unknown")}
                  </span>
                  <span className="shrink-0 text-caption text-faint">
                    {timeAgo(comment.createdAt, locale)}
                  </span>
                  {(access.manage || comment.author?.id === currentUserId) && (
                    <button
                      type="button"
                      aria-label={t("Delete comment")}
                      title={t("Delete comment")}
                      onClick={() => void deleteComment(comment.id)}
                      className="ml-auto text-faint transition-colors hover:text-danger"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-small leading-relaxed text-text">
                  {comment.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
        {access.canComment && replyKey !== key && (
          <button
            type="button"
            onClick={() => {
              setReplyKey(key);
              setDraft("");
            }}
            className="mt-2 ml-7 rounded px-1.5 py-0.5 text-caption text-muted transition-colors hover:bg-elevated hover:text-text"
          >
            {t("Reply")}
          </button>
        )}
        {replyKey === key && access.canComment && (
          <div className="mt-2">
            <CommentComposer
              draft={draft}
              posting={posting}
              placeholder={t("Reply…")}
              onDraft={setDraft}
              onPost={() => void postComment(group.anchor, "reply")}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    // The scroll box and the floating History/AI dock are siblings, so the dock stays in
    // the corner instead of scrolling away with the document (Linear's arrangement).
    <div className="relative min-h-0 flex-1">
      <div ref={scrollRef} className="h-full overflow-y-auto">
        {/* Properties and Resources live in the header now, so the document starts right
            under it. */}
        <div className={`w-full pb-8 pt-3 ${PAGE_INSET}`}>
          {error && <div className="mb-2 text-small text-danger">{t(error)}</div>}
          <div>
            {orphanComments > 0 && (
              <div className="mb-2 flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={openOrphans}
                  title={t("Comments on text that has changed or is no longer there")}
                  className="flex h-[22px] items-center gap-1 rounded-full border border-[#ecd28a] bg-[#fdf3c7] px-2 text-caption font-medium text-[#8a6d1a] transition-colors hover:border-[#d9b64e]"
                >
                  <MessageSquare size={11} />
                  {orphanComments}
                </button>
              </div>
            )}
            <div className="flex items-start gap-6">
              <div ref={wrapRef} className="relative min-w-0 flex-1">
                <div
                  ref={descRef}
                  className="min-w-0"
                  onMouseDown={() => {
                    restoreToken.current += 1;
                    setSelection(null);
                    setDraftSelection(null);
                  }}
                >
                  {access.canEdit ? (
                    <MarkdownEditor
                      ref={editorRef}
                      value={doc}
                      onChange={editDoc}
                      onTextSelection={setDraftSelection}
                      onBlockSelection={setRangeSelection}
                      onUndo={undoDoc}
                      onRedo={redoDoc}
                      placeholder={t("Write down whatever's on your mind…")}
                      issues={issueContext}
                      pages={pageContext}
                    />
                  ) : doc.trim() ? (
                    <Markdown
                      source={doc}
                      issues={issueContext}
                      pages={pageContext}
                      storageId={`project:${project.id}`}
                    />
                  ) : (
                    <p className="text-body text-faint">{t("Nothing has been written here yet.")}</p>
                  )}
                </div>

                {pins.map((pin) => {
                  const count = threads.find((group) => anchorKey(group.anchor) === pin.key)
                    ?.comments.length ?? 0;
                  return (
                    <button
                      key={pin.key}
                      type="button"
                      data-overview-pin
                      aria-label={t("Open comments")}
                      title={t(count === 1 ? "{count} comment" : "{count} comments", { count })}
                      onClick={() => {
                        setOpenKey((prev) => (prev === pin.key ? null : pin.key));
                        setReplyKey(null);
                        setDraft("");
                        setComposer(null);
                        setOrphansOpen(false);
                      }}
                      style={{ top: pin.top, left: pin.left }}
                      className="absolute z-20 flex h-[22px] min-w-[22px] items-center justify-center gap-0.5 rounded-full border border-[#ecd28a] bg-[#fdf3c7] px-1 text-caption font-medium text-[#8a6d1a] shadow-[0_1px_2px_rgba(0,0,0,0.08)] transition-colors hover:border-[#d9b64e] hover:bg-[#fbeaa9]"
                    >
                      <MessageSquare size={11} />
                      {count > 1 && <span>{count}</span>}
                    </button>
                  );
                })}

                {openThread && openPin && (
                  <div
                    data-overview-pop
                    style={{
                      top: openPin.top + 26,
                      left: Math.max(0, Math.min(openPin.left - 150, wrapWidth - 328)),
                    }}
                    className="absolute z-30 w-[320px] rounded-xl border border-border bg-bg p-3 shadow-[0_10px_36px_rgba(0,0,0,0.16)]"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-caption font-semibold uppercase tracking-wider text-faint">
                        {t(openThread.comments.length === 1 ? "{count} comment" : "{count} comments", {
                          count: openThread.comments.length,
                        })}
                      </span>
                      <button
                        type="button"
                        aria-label={t("Close comments")}
                        onClick={() => setOpenKey(null)}
                        className="rounded p-0.5 text-faint transition-colors hover:bg-elevated hover:text-text"
                      >
                        <X size={13} />
                      </button>
                    </div>
                    {threadBody(openThread)}
                  </div>
                )}
              </div>

              {historyOpen && (
                <aside className="sticky top-0 flex max-h-[calc(100vh-7rem)] w-[min(50%,460px)] shrink-0 flex-col self-start overflow-hidden rounded-xl border border-border bg-bg shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
                  <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
                    <History size={14} className="text-muted" />
                    <span className="text-small font-semibold text-text">{t("History")}</span>
                    <span className="text-caption text-faint">
                      {t(edits.length === 1 ? "{count} change" : "{count} changes", { count: edits.length })}
                    </span>
                    <button
                      type="button"
                      aria-label={t("Close history")}
                      onClick={() => setHistoryOpen(false)}
                      className="ml-auto rounded p-1 text-faint transition-colors hover:bg-elevated hover:text-text"
                    >
                      <X size={14} />
                    </button>
                  </header>
                  <div className="min-h-0 flex-1 overflow-y-auto p-3">
                    {edits.length === 0 ? (
                      <p className="text-small text-faint">
                        {t("No changes yet. Edits to this document will show up here.")}
                      </p>
                    ) : (
                      <ul className="space-y-3">
                        {edits.map((edit) => (
                          <li key={edit.id} className="rounded-lg border border-border px-2.5 py-2">
                            <div className="flex items-start gap-2">
                              <AssigneeAvatar
                                displayName={edit.author?.displayName ?? t("Unknown")}
                                avatar={edit.author?.avatar ?? null}
                                size={20}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate text-small font-medium text-text">
                                    {edit.author?.displayName ?? t("Unknown")}
                                  </span>
                                  <span className="shrink-0 text-caption text-faint">
                                    {timeAgo(edit.createdAt, locale)}
                                  </span>
                                  <span className="ml-auto shrink-0 text-caption">
                                    {edit.added > 0 && (
                                      <span className="text-[#2da44e]">+{edit.added} </span>
                                    )}
                                    {edit.removed > 0 && (
                                      <span className="text-danger">−{edit.removed}</span>
                                    )}
                                    {edit.added === 0 && edit.removed === 0 && (
                                      <span className="text-faint">no text change</span>
                                    )}
                                  </span>
                                </div>

                                {(edit.removedLines.length > 0 || edit.addedLines.length > 0) && (
                                  <div className="mt-1.5 space-y-0.5 rounded-md border border-border/70 bg-surface/60 px-1.5 py-1 font-mono text-caption leading-relaxed">
                                    {edit.removedLines.map((line, i) => (
                                      <div key={`r${i}`} className="flex gap-1.5 text-danger">
                                        <span className="select-none opacity-70">−</span>
                                        <span
                                          className="min-w-0 flex-1 truncate"
                                          title={line}
                                        >
                                          {line.trim() === "" ? "⏎" : line}
                                        </span>
                                      </div>
                                    ))}
                                    {edit.addedLines.map((line, i) => (
                                      <div
                                        key={`a${i}`}
                                        className="flex gap-1.5 text-[#2da44e]"
                                      >
                                        <span className="select-none opacity-70">+</span>
                                        <span
                                          className="min-w-0 flex-1 truncate"
                                          title={line}
                                        >
                                          {line.trim() === "" ? "⏎" : line}
                                        </span>
                                      </div>
                                    ))}
                                    {(edit.added > edit.addedLines.length ||
                                      edit.removed > edit.removedLines.length) && (
                                      <div className="pt-0.5 text-caption text-faint">
                                        …and more
                                      </div>
                                    )}
                                  </div>
                                )}

                                {access.canEdit && (
                                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                    {confirmRestore === edit.id ? (
                                      <>
                                        <button
                                          type="button"
                                          disabled={restoring === edit.id}
                                          onClick={() => void restoreEdit(edit)}
                                          className="rounded-md bg-accent px-2 py-0.5 text-caption font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                                        >
                                          {restoring === edit.id ? t("Restoring…") : t("Confirm restore")}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => setConfirmRestore(null)}
                                          className="rounded px-1.5 py-0.5 text-caption text-muted transition-colors hover:bg-elevated hover:text-text"
                                        >
                                          {t("Cancel")}
                                        </button>
                                        <span className="text-caption text-faint">
                                          {t("Replaces the current document")}
                                        </span>
                                      </>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => setConfirmRestore(edit.id)}
                                        title={t("Restore the document to how it was before this change")}
                                        className="flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-caption text-muted transition-colors hover:border-border-strong hover:text-text"
                                      >
                                        <RotateCcw size={11} /> {t("Restore")}
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </aside>
              )}
            </div>
          </div>

          {(selection || draftSelection || rangeSelection) && (
            <div
              data-overview-toolbar
              style={{
                left: selection?.x ?? draftSelection?.x ?? rangeSelection?.x ?? 0,
                top: selection?.y ?? draftSelection?.y ?? rangeSelection?.y ?? 0,
              }}
              className="fixed z-40 flex items-center gap-0.5 rounded-md bg-text p-0.5 text-bg shadow-[0_4px_14px_rgba(0,0,0,0.2)]"
            >
              {access.canEdit && (
                <>
                  {FORMAT_BUTTONS.map(({ style, label, Icon }) => {
                    const active = selection?.active?.includes(style) ?? false;
                    return (
                      <button
                        key={style}
                        type="button"
                        title={t(label)}
                        aria-label={t(label)}
                        aria-pressed={active}
                        onMouseDown={(event) => {
                          // Keep the browser's selection while the click lands.
                          event.preventDefault();
                          applyFormat(style);
                        }}
                        className={`flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-white/15 ${
                          active ? "bg-white/25 text-white" : ""
                        }`}
                      >
                        <Icon size={12} />
                      </button>
                    );
                  })}
                  {aiReady && (
                    <button
                      type="button"
                      title={t("Edit with AI")}
                      aria-label={t("Edit with AI")}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        openAiForSelection();
                      }}
                      className="flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-white/15"
                    >
                      <Sparkles size={12} />
                    </button>
                  )}
                  {!(selection?.multiLine || rangeSelection) && (
                    <span className="mx-0.5 h-3.5 w-px bg-white/25" aria-hidden />
                  )}
                </>
              )}
              {!(selection?.multiLine || rangeSelection) && (
                <button
                  type="button"
                  title={t("Create task from selection")}
                  aria-label={t("Create task from selection")}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    if (selection) taskFromSelection(selection.anchor, doc, selection.refId);
                    else taskFromDraft();
                  }}
                  className="flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-white/15"
                >
                  <SquareArrowOutUpRight size={13} />
                </button>
              )}
              {access.canComment && !(selection?.multiLine || rangeSelection) && (
                <button
                  type="button"
                  title={t("Comment on selection")}
                  aria-label={t("Comment on selection")}
                  onMouseDown={(event) => {
                    // Keep the selection alive long enough to record it, then open the
                    // comment box right where the passage is.
                    event.preventDefault();
                    if (selection) openComposer(selection.anchor, selection.x, selection.y);
                    else commentOnDraft();
                  }}
                  className="flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-white/15"
                >
                  <MessageSquare size={12} />
                </button>
              )}
            </div>
          )}

          {aiPanel && (
            <AiEditPanel
              workspaceId={workspaceId}
              x={aiPanel.x}
              y={aiPanel.y}
              target={{
                mode: aiPanel.kind,
                text: aiPanel.text,
                context: aiPanel.context,
                allowTasks: aiPanel.kind === "selection",
                allowContinue: aiPanel.kind === "document",
                acceptLabel: aiPanel.kind === "selection" ? t("Replace") : t("Replace document"),
              }}
              onClose={() => setAiPanel(null)}
              onAccept={acceptAi}
              onTasks={aiPanel.kind === "selection" ? openAiTasks : undefined}
            />
          )}

          {aiTasks && (
            <AiTaskDialog
              workspaceId={workspaceId}
              projectId={project.id}
              initialPrompt={aiTasks.prompt}
              context={aiTasks.context}
              onClose={() => setAiTasks(null)}
            />
          )}

          {composer && access.canComment && (
            <div
              data-overview-pop
              style={{ left: composer.x, top: composer.y }}
              className="fixed z-40 w-[320px] rounded-xl border border-border bg-bg p-2.5 shadow-[0_10px_36px_rgba(0,0,0,0.16)]"
            >
              <p className="mb-1.5 line-clamp-2 px-0.5 text-small font-medium text-text">
                “{composer.anchor.quote}”
              </p>
              <CommentComposer
                draft={draft}
                posting={posting}
                placeholder={t("Leave a comment…")}
                onDraft={setDraft}
                onPost={() => void postComment(composer.anchor, "new")}
              />
            </div>
          )}

          {orphansOpen && orphanThreads.length > 0 && (
            <div
              data-overview-pop
              style={{ left: orphanPos.x, top: orphanPos.y }}
              className="fixed z-40 w-[340px] rounded-xl border border-border bg-bg p-3 shadow-[0_10px_36px_rgba(0,0,0,0.16)]"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-caption font-semibold uppercase tracking-wider text-faint">
                  {t("Comments on changed text")}
                </span>
                <button
                  type="button"
                  aria-label={t("Close comments")}
                  onClick={() => setOrphansOpen(false)}
                  className="rounded p-0.5 text-faint transition-colors hover:bg-elevated hover:text-text"
                >
                  <X size={13} />
                </button>
              </div>
              <div className="max-h-[420px] space-y-3 overflow-y-auto pr-0.5">
                {orphanThreads.map((group) => (
                  <div
                    key={anchorKey(group.anchor)}
                    className="border-t border-border pt-3 first:border-t-0 first:pt-0"
                  >
                    {threadBody(group)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      {!historyOpen && (
        <div className="pointer-events-none absolute bottom-5 right-5 z-30 flex items-center gap-2">
          <div className="pointer-events-auto relative">
            <button
              type="button"
              onClick={toggleHistory}
              title={t("Document history")}
              className="flex items-center gap-1.5 rounded-full border border-border bg-overlay px-3 py-1.5 text-small font-medium text-muted shadow-[0_2px_10px_rgba(0,0,0,0.08)] transition-colors hover:border-border-strong hover:text-text"
            >
              <History size={13} /> {t("History")}
            </button>
            {unseen > 0 && (
              <span className="pointer-events-none absolute -right-1 -top-1 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-danger px-1 text-caption font-semibold leading-none text-white">
                {unseen > 9 ? "9+" : unseen}
              </span>
            )}
          </div>
          {aiReady && access.canEdit && (
            <button
              type="button"
              onClick={(event) => openAiForDocument(event.currentTarget)}
              title={t("Edit this document with AI")}
              className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-border bg-overlay px-3 py-1.5 text-small font-medium text-muted shadow-[0_2px_10px_rgba(0,0,0,0.08)] transition-colors hover:border-border-strong hover:text-text"
            >
              <Sparkles size={13} /> AI
            </button>
          )}
        </div>
      )}
    </div>
  );
}
