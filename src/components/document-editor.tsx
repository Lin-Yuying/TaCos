"use client";

import { SuggestionMenu } from "./ui/suggestion-menu";
import { Fragment, type RefObject, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type Editor, type Range } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import type { EditorState } from "@tiptap/pm/state";
import { BubbleMenu } from "@tiptap/react/menus";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import Placeholder from "@tiptap/extension-placeholder";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import {
  Bold,
  CheckSquare,
  ChevronRight,
  Code,
  FileText,
  GripVertical,
  Info,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  MessageSquare,
  MessageSquarePlus,
  Minus,
  Quote,
  Strikethrough,
  Table as TableIcon,
  Type,
  Check,
  MoreHorizontal,
  X,
} from "lucide-react";
import { AssigneeAvatar } from "@/components/issue-table";
import { DocMention, PageEmbed, PageRef, documentExtensions } from "@/lib/editor/extensions";
import { embedPreview } from "@/lib/editor/page-embed";
import { Markdown, type PageContext, type PageRefEntry } from "@/components/markdown";
import { documentColor, documentLinkHref } from "@/lib/markdown";
import type { Member } from "@/lib/issues";
import { BLOCK_TURNS, canTurnBlock, turnBlock } from "@/lib/editor/block-turn";
import { incrementalMarkdown } from "@/lib/editor/incremental-markdown";
import { documentMarkdown, markdownToDocument } from "@/lib/editor/document-markdown";
import { outlineHeadings } from "@/lib/doc-outline";
import { anchorFromSelection, anchorRanges } from "@/lib/editor/anchors";
import type { DocAnchor } from "@/lib/doc-anchor";
import type { DocCollab } from "@/components/use-doc-collab";
import { CodeLanguageMenu, setLineNumbers, useLineNumbers } from "@/components/code-block-controls";
import { CodeView, codeViewKey } from "@/lib/editor/code-view";
import { Menu, MenuItem } from "@/components/menu";
import { useT } from "@/components/i18n-context";

type SlashCommand = {
  label: string;
  hint: string;
  keywords: string;
  icon: React.ComponentType<{ size?: number | string }>;
  run: (editor: Editor, range: Range) => void;
};

const uploadMarkersKey=new PluginKey<DecorationSet>("uploadMarkers");
const UploadMarkers=Extension.create({name:"uploadMarkers",addProseMirrorPlugins(){return [new Plugin<DecorationSet>({key:uploadMarkersKey,state:{init:()=>DecorationSet.empty,apply(tr,old){let next=old.map(tr.mapping,tr.doc);const meta=tr.getMeta(uploadMarkersKey) as {add?:{id:string;pos:number;name:string};remove?:string}|undefined;if(meta?.remove)next=next.remove(next.find(undefined,undefined,spec=>spec.id===meta.remove));if(meta?.add){const {id,pos,name}=meta.add;next=next.add(tr.doc,[Decoration.widget(pos,()=>{const span=document.createElement("span");span.className="rounded bg-elevated px-1 text-small text-muted";span.textContent=`[${name}]`;return span;},{id,side:1})]);}return next;}},props:{decorations:state=>uploadMarkersKey.getState(state)}})];}});
type UploadItem={id:string;file:File;progress:number;status:"queued"|"uploading"|"failed"|"done"|"cancelled";controller:AbortController;error?:string;url?:string};

const PICK_FILE_EVENT = "tacos:pick-file";

const COMMANDS: SlashCommand[] = [
  { label: "Text", hint: "Plain paragraph", keywords: "plain body p 正文 段落 文本", icon: Type, run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run() },
  { label: "Heading 1", hint: "Large section title", keywords: "h1 title 一级 标题", icon: Heading1, run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 1 }).run() },
  { label: "Heading 2", hint: "Medium section title", keywords: "h2 subtitle 二级 标题", icon: Heading2, run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run() },
  { label: "Heading 3", hint: "Small section title", keywords: "h3 三级 标题", icon: Heading3, run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run() },
  { label: "Bulleted list", hint: "Unordered items", keywords: "bullet ul dash list 无序 列表", icon: List, run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { label: "Numbered list", hint: "Ordered items", keywords: "ordered ol number list 有序 编号 列表", icon: ListOrdered, run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { label: "To-do list", hint: "Checkable items", keywords: "todo task checkbox check 待办 任务 清单", icon: CheckSquare, run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
  { label: "Quote", hint: "Set text apart", keywords: "blockquote citation 引用", icon: Quote, run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
  { label: "Toggle", hint: "A section that opens", keywords: "toggle details collapse disclosure", icon: ChevronRight, run: (e, r) => e.chain().focus().deleteRange(r).setDetails().run() },
  { label: "Callout", hint: "Set a note apart", keywords: "callout note aside banner", icon: Info, run: (e, r) => e.chain().focus().insertContentAt(r, { type: "callout", content: [{ type: "paragraph" }] }).run() },
  { label: "Code", hint: "Fenced block", keywords: "code block pre 代码", icon: Code, run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
  { label: "Table", hint: "Rows and columns", keywords: "table grid 表格", icon: TableIcon, run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { label: "Image or file", hint: "Upload to this document", keywords: "image picture photo attachment upload file 图片 文件 附件 上传", icon: ImageIcon, run: (e, r) => {
    e.chain().focus().deleteRange(r).run();
    e.view.dom.dispatchEvent(new CustomEvent(PICK_FILE_EVENT));
  } },
  { label: "Divider", hint: "Visual break", keywords: "hr line rule separator 分割线", icon: Minus, run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
];

function matchCommands(query: string): SlashCommand[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return COMMANDS;
  return COMMANDS.filter((c) => `${c.label} ${c.keywords}`.toLowerCase().includes(needle));
}

type MenuState<T = SlashCommand> = { items: T[]; selected: number; x: number; y: number; rect:()=>DOMRect|null; pick: (item: T) => void };

// Arrow keys, Enter and Escape while a suggestion menu is open.
function menuKey<T>(event: KeyboardEvent, open: MenuState<T> | null, set: (next: MenuState<T> | null) => void): boolean {
  if (event.isComposing || event.keyCode===229 || !open || open.items.length === 0) return false;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    const step = event.key === "ArrowDown" ? 1 : open.items.length - 1;
    set({ ...open, selected: (open.selected + step) % open.items.length });
    return true;
  }
  if (event.key === "Enter") {
    open.pick(open.items[open.selected]);
    return true;
  }
  if (event.key === "Escape") {
    set(null);
    return true;
  }
  return false;
}

const TABLE_EDITS: { label: string; run: (editor: Editor) => void }[] = [
  { label: "Add a row below", run: (editor) => editor.chain().focus().addRowAfter().run() },
  { label: "Delete this row", run: (editor) => editor.chain().focus().deleteRow().run() },
  { label: "Add a column to the right", run: (editor) => editor.chain().focus().addColumnAfter().run() },
  { label: "Delete this column", run: (editor) => editor.chain().focus().deleteColumn().run() },
];

function TableEditButtons({ editor }: { editor: Editor }) {
  const t = useT();
  const groups = [TABLE_EDITS.slice(0, 2), TABLE_EDITS.slice(2)];
  return (
    <>
      {groups.map((group, index) => (
        <span key={group[0].label} className="flex items-center gap-0.5">
          {index > 0 && <span className="mx-0.5 h-4 w-px bg-border" />}
          {group.map((action) => (
            <button
              key={action.label}
              type="button"
              title={t(action.label)}
              aria-label={t(action.label)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => action.run(editor)}
              className="rounded px-1.5 py-1 text-small text-muted transition-colors hover:bg-elevated hover:text-text"
            >
              {t(action.label)}
            </button>
          ))}
        </span>
      ))}
    </>
  );
}

const EDITOR_TOOL = "flex items-center gap-1 rounded-md px-2 py-1 text-small text-muted transition-colors hover:bg-elevated hover:text-text";

/** The caret's code block: a language chip and ⋯, which opens the block's actions in place. */
function CodeBlockMenu({ editor }: { editor: Editor }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [, redraw] = useState(0);
  const view = codeViewKey.getState(editor.state);
  const showNumbers = useLineNumbers();
  const blockPos = editor.state.selection.$from.depth > 0 ? editor.state.selection.$from.before() : -1;
  const language = (
    <CodeLanguageMenu
      lang={String(editor.getAttributes("codeBlock").language ?? "")}
      onChange={(lang) =>
        editor.chain().focus().updateAttributes("codeBlock", { language: lang || null }).run()
      }
    />
  );
  const toggleCollapsed = () => {
    editor.view.dispatch(editor.state.tr.setMeta(codeViewKey, { toggle: blockPos }));
    redraw((value) => value + 1);
  };
  const item = "flex w-full rounded px-2 py-1 text-left text-body text-text hover:bg-elevated";
  if (!open)
    return (
      <div className="flex items-center gap-0.5">
        {language}
        <button
          type="button"
          aria-label={t("Code block")}
          title={t("Code block")}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setOpen(true)}
          className="rounded p-1 text-muted hover:bg-elevated hover:text-text"
        >
          <MoreHorizontal size={14} />
        </button>
      </div>
    );
  return (
    <div role="menu" aria-label={t("Code block")} className="w-[220px] p-0.5" onMouseDown={(event) => event.preventDefault()}>
      <div className="flex items-center justify-between px-2 pb-1 pt-0.5 text-caption text-faint">
        {t("Code block")}
        <button type="button" aria-label={t("Close")} onClick={() => setOpen(false)} className="rounded p-0.5 text-muted hover:bg-elevated hover:text-text"><X size={12} /></button>
      </div>
      <button
        type="button"
        role="menuitem"
        className={item}
        onClick={() => {
          const text = editor.state.selection.$from.parent.textContent;
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          }).catch(() => {});
        }}
      >
        {t(copied ? "Copied" : "Copy code")}
      </button>
      <button type="button" role="menuitem" className={item} onClick={toggleCollapsed}>
        {t(view?.collapsed.includes(blockPos) ? "Expand code" : "Collapse code")}
      </button>
      <div className="flex items-center justify-between gap-2 px-2 py-0.5 text-body text-text">
        {t("Change language")}
        {language}
      </div>
      <button type="button" role="menuitemcheckbox" aria-checked={showNumbers} className={`${item} items-center justify-between`} onClick={() => setLineNumbers(!showNumbers)}>
        {t("Show line numbers")}
        {showNumbers && <Check size={13} />}
      </button>
    </div>
  );
}

const TEXT_COLORS = [
  ["Red", "#b42318"],
  ["Orange", "#b54708"],
  ["Green", "#067647"],
  ["Blue", "#175cd3"],
  ["Purple", "#6941c6"],
] as const;

function SelectionStyleButtons({ editor }: { editor: Editor }) {
  const t = useT();
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const current = documentColor(String(editor.getAttributes("textStyle").color ?? ""));
  const applyLink = (value: string) => {
    const href = documentLinkHref(value);
    if (!href) return;
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setLinkDraft(null);
  };
  return (
    <>
      <button
        type="button"
        title={t("Link")}
        aria-label={t("Link")}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          const href = editor.getAttributes("link").href;
          setLinkDraft(typeof href === "string" ? href : "");
        }}
        className={`rounded p-1 transition-colors hover:bg-elevated ${
          editor.isActive("link") || linkDraft !== null ? "text-text" : "text-muted"
        }`}
      >
        <LinkIcon size={14} />
      </button>
      {TEXT_COLORS.map(([label, color]) => (
        <button
          key={color}
          type="button"
          title={t(label)}
          aria-label={t(label)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => editor.chain().focus().setColor(color).run()}
          className={`h-4 w-4 rounded-full border ${current === color ? "border-text" : "border-border"}`}
          style={{ backgroundColor: color }}
        />
      ))}
      <button
        type="button"
        title={t("Remove color")}
        aria-label={t("Remove color")}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor.chain().focus().unsetColor().run()}
        className="rounded p-1 text-small text-muted line-through transition-colors hover:bg-elevated hover:text-text"
      >
        A
      </button>
      {linkDraft !== null && (
        <form
          className="order-last flex basis-full items-center gap-1 px-1 py-1"
          onSubmit={(event) => {
            event.preventDefault();
            applyLink(linkDraft);
          }}
        >
          <input
            data-testid="doc-link-field"
            autoFocus
            value={linkDraft}
            onChange={(event) => setLinkDraft(event.target.value)}
            placeholder="https://"
            aria-label={t("Web address")}
            className="min-w-0 flex-1 rounded border border-border bg-bg px-1 py-0.5 text-small text-text"
          />
          <button
            type="submit"
            disabled={documentLinkHref(linkDraft) === null}
            className="rounded px-1.5 py-1 text-small text-muted transition-colors hover:bg-elevated hover:text-text disabled:opacity-40"
          >
            {t("Add")}
          </button>
          {editor.isActive("link") && (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                editor.chain().focus().extendMarkRange("link").unsetLink().run();
                setLinkDraft(null);
              }}
              aria-label={t("Remove link")}
              title={t("Remove link")}
              className="rounded p-1 text-muted transition-colors hover:bg-elevated hover:text-text"
            >
              <X size={13} />
            </button>
          )}
        </form>
      )}
    </>
  );
}

function dispatchTurn(editor: Editor, next: EditorState) {
  const size = editor.state.doc.content.size;
  editor.view.dispatch(editor.state.tr.replaceWith(0, size, next.doc.content));
}

const NO_MEMBERS: Member[] = [];

class EmbedPages {
  pages: PageContext | undefined;
  open = (_id: string) => {};
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = () => this.pages;
  update(pages: PageContext | undefined) {
    if (this.pages === pages) return;
    this.pages = pages;
    for (const listener of this.listeners) listener();
  }
}

function PageEmbedNode({ node, extension }: NodeViewProps) {
  const store = extension.storage as EmbedPages;
  const pages = useSyncExternalStore(store.subscribe, store.snapshot, () => undefined);
  const preview = embedPreview(pages, String(node.attrs.title ?? ""), (node.attrs.pageId as string | null) ?? null);
  const t = useT();
  return (
    <NodeViewWrapper
      data-page-embed={preview.id ?? ""}
      data-testid="doc-page-embed"
      className="my-2"
    >
      <button
        type="button"
        data-embed-title
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (preview.id) store.open(preview.id);
        }}
        className="text-body"
      >
        {preview.missing ? t("Missing page: {title}", { title: preview.label }) : preview.label}
      </button>
      {preview.body !== null &&
        (preview.body.trim() ? (
          <div className="mt-1.5">
            <Markdown source={preview.body} pages={pages ? { ...pages, embeds: {} } : undefined} />
          </div>
        ) : (
          <p className="mt-1 text-small text-faint">{t("This page is empty.")}</p>
        ))}
    </NodeViewWrapper>
  );
}

// `[[Page]]` in the document. The stored reference is the page id, so a renamed target
// keeps working; a page in the Trash renders as an unresolved, dashed mention.
function PageRefNode({ node, extension }: NodeViewProps) {
  const store = extension.storage as EmbedPages;
  const pages = useSyncExternalStore(store.subscribe, store.snapshot, () => undefined);
  const title = String(node.attrs.title ?? "");
  const preview = embedPreview(pages, title, (node.attrs.pageId as string | null) ?? null);
  const t = useT();
  return (
    <NodeViewWrapper
      as="span"
      data-page-ref={preview.id ?? ""}
      data-page-ref-missing={preview.missing ? title : undefined}
      className={`inline-flex max-w-full items-baseline gap-1 align-baseline ${
        preview.missing
          ? "text-muted underline decoration-dashed decoration-border-strong underline-offset-2"
          : "text-text"
      }`}
    >
      <span aria-hidden className="shrink-0 text-muted">
        <FileText size={13} className="inline align-[-2px]" />
      </span>
      <button
        type="button"
        title={preview.missing ? t("This document is in the Trash or not available") : undefined}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.stopPropagation();
          if (preview.id) store.open(preview.id);
        }}
        className={`max-w-full truncate text-left ${preview.id ? "underline decoration-border-strong underline-offset-2 hover:decoration-text" : "cursor-default"}`}
      >
        {preview.label}
      </button>
    </NodeViewWrapper>
  );
}

export type EditorAnchor = DocAnchor & { id: string };

const headingsKey = new PluginKey<DecorationSet>("documentHeadings");

// The `#` in a heading's left margin. It is a widget, not document content: copying the
// link never changes the Markdown and collaboration never sees it.
function headingAnchor(id: string, copyLabel: string, base: string): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.contentEditable = "false";
  button.dataset.headingAnchor = id;
  button.className = "doc-heading-anchor";
  button.textContent = "#";
  button.title = copyLabel;
  button.setAttribute("aria-label", copyLabel);
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const href = `${window.location.origin}${base || window.location.pathname}?heading=${encodeURIComponent(id)}`;
    void navigator.clipboard?.writeText(href).then(() => {
      button.dataset.copied = "true";
      button.textContent = "✓";
      window.setTimeout(() => {
        delete button.dataset.copied;
        button.textContent = "#";
      }, 1200);
    }).catch(() => {});
  });
  return button;
}

// The same text the Markdown outline reads. Atom nodes (a page reference, a task or a
// mention) have no text content of their own, so their visible label fills in.
function headingText(node: PMNode): string {
  let out = "";
  node.forEach((child) => {
    if (child.isText) out += child.text ?? "";
    else if (child.type.name === "pageRef") out += String(child.attrs.title ?? "");
    else if (child.type.name === "issueRef") out += String(child.attrs.label ?? "");
    else if (child.type.name === "mention" || child.type.name === "docMention")
      out += `@${String(child.attrs.id ?? "")}`;
    else out += child.textContent;
  });
  return out;
}

function headingDecorations(doc: PMNode, copyLabel: string, base: string): DecorationSet {
  const headings: { level: number; text: string }[] = [];
  doc.descendants((node) => {
    if (node.type.name === "heading") {
      headings.push({ level: Number(node.attrs.level) || 1, text: headingText(node) });
    }
  });
  const outline = outlineHeadings(headings);
  const decorations: Decoration[] = [];
  let index = 0;
  doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return;
    const heading = outline[index++];
    if (!heading) return;
    decorations.push(
      Decoration.node(pos, pos + node.nodeSize, {
        class: "doc-heading",
        id: heading.id,
        "data-doc-heading": heading.id,
      })
    );
    decorations.push(
      Decoration.widget(pos + 1, () => headingAnchor(heading.id, copyLabel, base), { side: -10 })
    );
  });
  return DecorationSet.create(doc, decorations);
}

/** Text from outside the editor, for a shared document where the page state cannot carry it. */
export type OutsideEdit = { at: "start" | "end" | "all"; text: string };

const NO_ANCHORS: EditorAnchor[] = [];

const anchorsKey = new PluginKey<DecorationSet>("commentAnchors");

// What the highlight plugin reads; the component keeps it current.
class AnchorStore {
  anchors: EditorAnchor[] = NO_ANCHORS;
  active: string | null = null;
  onClick: (id: string) => void = () => {};
  update(anchors: EditorAnchor[], active: string | null, onClick: (id: string) => void) {
    this.anchors = anchors;
    this.active = active;
    this.onClick = onClick;
  }
}

// Paints the passages comments are about.
const CommentAnchors = Extension.create<{ store: AnchorStore }>({
  name: "commentAnchors",
  addOptions() {
    return { store: new AnchorStore() };
  },
  addProseMirrorPlugins() {
    const storage = this.options.store;
    const build = (doc: Parameters<typeof anchorRanges>[0]) =>
      DecorationSet.create(
        doc,
        anchorRanges(doc, storage.anchors).map(({ anchor, from, to }) =>
          Decoration.inline(
            from,
            to,
            { class: anchor.id === storage.active ? "doc-comment-anchor is-active" : "doc-comment-anchor" },
            { id: anchor.id }
          )
        )
      );
    let knownAnchors=storage.anchors;
    return [
      new Plugin<DecorationSet>({
        key: anchorsKey,
        state: {
          init: (_, state) => build(state.doc),
          apply: (tr, set) => {
            const metadata=tr.getMeta(anchorsKey);
            if(metadata&&knownAnchors!==storage.anchors){knownAnchors=storage.anchors;return build(tr.doc);}
            if(!tr.docChanged&&!metadata)return set;
            let positions=set.find().map(mark=>({id:String(mark.spec.id),from:mark.from,to:mark.to,touched:false}));
            for(const map of tr.mapping.maps){positions=positions.map(range=>{let touched=range.touched;map.forEach((from,to)=>{if(range.from<=to&&range.to>=from)touched=true;});return {...range,from:map.map(range.from,1),to:map.map(range.to,-1),touched};});}
            const retained=positions.filter(range=>!range.touched&&range.to>range.from),ids=new Set(retained.map(range=>range.id));
            const relocated=tr.docChanged?anchorRanges(tr.doc,storage.anchors.filter(anchor=>!ids.has(anchor.id))):[];
            const ranges=[...retained,...relocated.map(range=>({id:range.anchor.id,from:range.from,to:range.to}))];
            return DecorationSet.create(tr.doc,ranges.map(range=>Decoration.inline(range.from,range.to,{class:range.id===storage.active?"doc-comment-anchor is-active":"doc-comment-anchor"},{id:range.id})));
          },
        },
        props: {
          decorations: (state) => anchorsKey.getState(state),
          handleClick: (view, pos) => {
            const hit = anchorsKey.getState(view.state)?.find(pos, pos)[0];
            if (hit) storage.onClick((hit.spec as { id: string }).id);
            return false;
          },
        },
      }),
    ];
  },
});

export function DocumentEditor({
  value,
  onChange,
  placeholder,
  pages,
  editable = true,
  mentionWarning = null,
  anchors = NO_ANCHORS,
  members = NO_MEMBERS,
  viewerId = null,
  activeAnchor = null,
  onComment,
  onAnchorClick,
  onAnchorsLocated,
  onUpload,
  collab,
  editorRef,
  onEditorReady,
  outsideEditRef,
  headingBase = "",
}: {
  editorRef?: { current: Editor | null };
  onEditorReady?:(editor:Editor|null)=>void;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  pages?: PageContext;
  // A reader who cannot edit still sees the same page and can select text to comment on.
  editable?: boolean;
  // Set on a private document: whoever "@" picks other than the owner cannot read it.
  mentionWarning?: { ownerId: string; onShare?: () => void } | null;
  anchors?: EditorAnchor[];
  // Who "@" offers; the viewer comes last.
  members?: Member[];
  viewerId?: string | null;
  activeAnchor?: string | null;
  onComment?: (anchor: DocAnchor) => void;
  onAnchorClick?: (id: string) => void;
  onAnchorsLocated?: (ids: Set<string>) => void;
  // Sends a pasted, dropped or picked file and returns its address, or null when it failed.
  onUpload?: (file: File,controls?:{signal?:AbortSignal;onProgress?:(progress:number)=>void}) => Promise<string | null>;
  // A shared document; its text comes from here and not from `value`. Fixed for the editor's life.
  collab?: Extract<DocCollab, { doc: unknown }>;
  // Filled with the call that puts outside text into the editor and so into a shared document.
  outsideEditRef?: RefObject<((edit: OutsideEdit) => void) | null>;
  // Canonical path of this document ("/<workspace>/docs/<page>"); heading links point here.
  headingBase?: string;
}) {
  const t = useT();
  const router = useRouter();
  const markdown = useMemo(() => documentMarkdown(), []);
  const serialize=useMemo(()=>incrementalMarkdown(markdown),[markdown]);
  const emitted = useRef(value);
  const onChangeRef = useRef(onChange);
  const pagesRef = useRef(pages);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [handleBlock, setHandleBlock] = useState<{ pos: number; name: string } | null>(null);
  const [turnMenu, setTurnMenu] = useState<{ x: number; y: number; pos: number } | null>(null);
  const menuRef = useRef<MenuState | null>(null);
  const [mentionMenu, setMentionMenu] = useState<MenuState<Member> | null>(null);
  const mentionMenuRef = useRef<MenuState<Member> | null>(null);
  const [pageMenu, setPageMenu] = useState<MenuState<PageRefEntry> | null>(null);
  const pageMenuRef = useRef<MenuState<PageRefEntry> | null>(null);
  const membersRef = useRef({ members, viewerId });
  // The text block under the pointer, for the comment button in the right margin.
  const [hovered, setHovered] = useState<{ from: number; to: number; top: number; block: number } | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [marginCounts, setMarginCounts] = useState<{ from: number; top: number; count: number; ids: string[] }[]>([]);
  const [anchorStore] = useState(() => new AnchorStore());
  const [embedPages] = useState(() => new EmbedPages());
  const locatedRef = useRef(onAnchorsLocated);
  const anchorClickRef = useRef(onAnchorClick);
  const uploadRef = useRef(onUpload);
  const [uploads,setUploads]=useState<UploadItem[]>([]);
  const uploadsRef=useRef<UploadItem[]>([]);
  const uploadRuns=useRef(new Map<string,AbortController>());
  const runUpload=useRef<(item:UploadItem)=>Promise<void>>(async()=>{});
  useEffect(()=>()=>{for(const item of uploadsRef.current)item.controller.abort();},[]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
    pagesRef.current = pages;
    embedPages.update(pages);
    embedPages.open = (id: string) => {
      const ctx = pagesRef.current;
      if (!ctx) return;
      if (ctx.onOpen) ctx.onOpen(id);
      else router.push(`${ctx.base}${id}`);
    };
    menuRef.current = menu;
    mentionMenuRef.current = mentionMenu;
    pageMenuRef.current = pageMenu;
    membersRef.current = { members, viewerId };
    anchorClickRef.current = onAnchorClick;
    locatedRef.current = onAnchorsLocated;
  });

  const slash = useMemo(
    () =>
      Extension.create({
        name: "slashCommands",
        addProseMirrorPlugins() {
          const show = (props: SuggestionProps<SlashCommand>, selected: number) => {
            const rect = props.clientRect?.();
            setMenu({
              items: props.items,
              selected,
              rect:()=>props.clientRect?.()??null,
              x: rect?.left ?? 0,
              y: rect?.bottom ?? 0,
              pick: (command) => props.command(command),
            });
          };
          return [
            Suggestion<SlashCommand>({
              editor: this.editor,
              char: "/",
              startOfLine: false,
              items: ({ query }) => matchCommands(query),
              command: ({ editor, range, props }) => props.run(editor, range),
              render: () => ({
                onStart: (props) => show(props, 0),
                onUpdate: (props) => show(props, 0),
                onExit: () => setMenu(null),
                onKeyDown: ({ event }) => menuKey(event, menuRef.current, setMenu),
              }),
            }),
          ];
        },
      }),
    []
  );

  const mention = useMemo(
    () =>
      DocMention.configure({
        suggestion: {
          char: "@",
          // Chinese text runs up to the "@" with no space before it.
          allowedPrefixes: null,
          items: ({ query }: { query: string }): Member[] => {
            const { members: everyone, viewerId: me } = membersRef.current;
            const needle = query.toLowerCase();
            return everyone
              .filter((m) => m.username.toLowerCase().startsWith(needle) || m.displayName.toLowerCase().includes(needle))
              .sort((a, b) => Number(a.id === me) - Number(b.id === me))
              .slice(0, 8);
          },
          render: () => {
            const show = (props: SuggestionProps<Member>) => {
              const rect = props.clientRect?.();
              setMentionMenu({
                items: props.items,
                selected: 0,
                rect:()=>props.clientRect?.()??null,
              x: rect?.left ?? 0,
                y: rect?.bottom ?? 0,
                pick: (member) => props.command({ id: member.username, label: null }),
              });
            };
            return {
              onStart: show,
              onUpdate: show,
              onExit: () => setMentionMenu(null),
              onKeyDown: ({ event }: { event: KeyboardEvent }) => menuKey(event, mentionMenuRef.current, setMentionMenu),
            };
          },
        },
      }),
    []
  );

  const pageLink = useMemo(
    () =>
      Extension.create({
        name: "pageLinkSuggestions",
        addProseMirrorPlugins() {
          const show = (props: SuggestionProps<PageRefEntry>, selected: number) => {
            const rect = props.clientRect?.();
            setPageMenu({
              items: props.items,
              selected,
              rect: () => props.clientRect?.() ?? null,
              x: rect?.left ?? 0,
              y: rect?.bottom ?? 0,
              pick: (page) => props.command(page),
            });
          };
          return [
            Suggestion<PageRefEntry>({
              editor: this.editor,
              pluginKey: new PluginKey("pageLinkSuggestion"),
              // Our own matcher below owns the two-character trigger; the built-in one
              // only understands one character.
              char: "[[",
              allowSpaces: true,
              findSuggestionMatch: ({ $position }) => {
                if ($position.parent.type.name === "codeBlock") return null;
                const before = $position.nodeBefore;
                if (!before?.isText || !before.text) return null;
                // Code spans parse before page references, so `[[` in one is not a link.
                if (before.marks.some((mark) => mark.type.name === "code")) return null;
                const match = /\[\[([^\]\n|]*)$/.exec(before.text);
                if (!match) return null;
                return {
                  range: {
                    from: $position.pos - before.text.length + match.index,
                    to: $position.pos,
                  },
                  query: match[1],
                  text: match[0],
                };
              },
              items: ({ query }) => {
                // The store is updated in an effect, so the picker always reads the
                // newest page list without closing over a ref during render.
                const allPages = embedPages.pages;
                const seen = new Set<string>();
                const all: PageRefEntry[] = [];
                for (const ref of Object.values(allPages?.lookup ?? {})) {
                  if (seen.has(ref.id)) continue;
                  seen.add(ref.id);
                  all.push(ref);
                }
                const needle = query.trim().toLowerCase();
                const found = needle
                  ? all.filter((ref) => `${ref.title} ${ref.path ?? ""}`.toLowerCase().includes(needle))
                  : all;
                return found.slice(0, 8);
              },
              command: ({ editor, range, props }) =>
                editor
                  .chain()
                  .focus()
                  .insertContentAt(range, {
                    type: "pageRef",
                    attrs: { title: props.title, pageId: props.id },
                  })
                  .run(),
              render: () => ({
                onStart: (props) => show(props, 0),
                onUpdate: (props) => show(props, 0),
                onExit: () => setPageMenu(null),
                onKeyDown: ({ event }) => menuKey(event, pageMenuRef.current, setPageMenu),
              }),
            }),
          ];
        },
      }),
    [embedPages]
  );

  const embed = useMemo(
    () =>
      PageEmbed.extend({
        addStorage() {
          return embedPages;
        },
        addNodeView() {
          return ReactNodeViewRenderer(PageEmbedNode);
        },
      }),
    [embedPages],
  );

  const pageRef = useMemo(
    () =>
      PageRef.extend({
        addStorage() {
          return embedPages;
        },
        addNodeView() {
          return ReactNodeViewRenderer(PageRefNode);
        },
      }),
    [embedPages],
  );

  const headings = useMemo(() => {
    const copyLabel = t("Copy link to heading");
    return Extension.create({
      name: "documentHeadings",
      addProseMirrorPlugins() {
        return [
          new Plugin<DecorationSet>({
            key: headingsKey,
            state: {
              init: (_, state) => headingDecorations(state.doc, copyLabel, headingBase),
              apply: (tr, set) =>
                tr.docChanged ? headingDecorations(tr.doc, copyLabel, headingBase) : set,
            },
            props: {
              decorations: (state) => headingsKey.getState(state),
            },
          }),
        ];
      },
    });
  }, [headingBase, t]);

  const insertRef = useRef<(files: File[], at?: number) => void>(() => {});
  const dropFiles = (files: FileList | undefined | null, at?: number) => {
    if (!files?.length || !uploadRef.current) return false;
    insertRef.current([...files], at);
    return true;
  };

  const showCodeNumbers = useLineNumbers();
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      ...documentExtensions({ sharedHistory: Boolean(collab), mention, embed, pageRef }),
      Placeholder.configure({ placeholder: placeholder ?? "" }), UploadMarkers, CodeView, slash, pageLink, headings, CommentAnchors.configure({ store: anchorStore }),
      ...(collab
        ? [
            Collaboration.configure({ document: collab.doc }),
            CollaborationCaret.configure({ provider: collab.provider, user: collab.user }),
          ]
        : []),
    ],
    ...(collab ? {} : { content: markdownToDocument(markdown, value) }),
    editable,
    editorProps: {
      handlePaste: (_view, event) => dropFiles(event.clipboardData?.files),
      handleDrop: (view, event) =>
        dropFiles(
          (event as DragEvent).dataTransfer?.files,
          view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY })?.pos
        ),
      handleClickOn: (_view, _pos, node) => {
        if (node.type.name !== "pageRef") return false;
        const ctx = pagesRef.current;
        const target = node.attrs.pageId ?? ctx?.lookup[String(node.attrs.title).toLowerCase()]?.id;
        if (!ctx || !target) return false;
        if (ctx.onOpen) ctx.onOpen(target);
        else router.push(`${ctx.base}${target}`);
        return true;
      },
    },
    onUpdate: ({ editor: current }) => {
      const next = serialize(current.state.doc);
      if (next === emitted.current) return;
      emitted.current = next;
      onChangeRef.current(next);
    },
  });
  // The block's numbers follow the same remembered choice as code in Markdown.
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(codeViewKey, { lineNumbers: showCodeNumbers }));
  }, [editor, showCodeNumbers]);

  useEffect(() => { if (editorRef) editorRef.current = editor;onEditorReady?.(editor); return () => { if (editorRef) editorRef.current = null;onEditorReady?.(null); }; }, [editor, editorRef,onEditorReady]);

  useEffect(() => {
    uploadRef.current = onUpload;
    const change=(id:string,patch:Partial<UploadItem>)=>{uploadsRef.current=uploadsRef.current.map(item=>item.id===id?{...item,...patch}:item);setUploads(uploadsRef.current);};
    runUpload.current=async item=>{
      if(!editor||editor.isDestroyed)return;
      const previous=uploadRuns.current.get(item.id);previous?.abort();
      const controller=new AbortController();uploadRuns.current.set(item.id,controller);
      const update=(patch:Partial<UploadItem>)=>{if(uploadRuns.current.get(item.id)===controller)change(item.id,patch);};
      update({controller,status:"uploading",progress:0,error:undefined});
      try{
        const url=item.url??await uploadRef.current?.(item.file,{signal:controller.signal,onProgress:progress=>update({progress})});
        if(uploadRuns.current.get(item.id)!==controller)return;
        if(controller.signal.aborted){update({status:"cancelled"});return;}
        if(!url)throw new Error("Upload failed. Retry.");
        item.url=url;update({url});
        if(editor.isDestroyed)return;
        const marker=uploadMarkersKey.getState(editor.state)?.find(undefined,undefined,spec=>spec.id===item.id)[0];
        if(!marker||!editor.isEditable)throw new Error("Insertion is unavailable. Keep this window open and retry when editing is available.");
        const chain=editor.chain().focus().setTextSelection(marker.from);
        if(item.file.type.startsWith("image/"))chain.setImage({src:url,alt:item.file.name});else chain.insertContent({type:"text",text:item.file.name,marks:[{type:"link",attrs:{href:url}}]});
        if(!chain.run())throw new Error("Could not insert attachment. Retry.");
        editor.view.dispatch(editor.state.tr.setMeta(uploadMarkersKey,{remove:item.id}));update({status:"done",progress:100});
      }catch(error){update({status:controller.signal.aborted?"cancelled":"failed",error:error instanceof Error?error.message:"Upload failed. Retry."});}finally{if(uploadRuns.current.get(item.id)===controller)uploadRuns.current.delete(item.id);}
    };
    insertRef.current=(files,at)=>{
      if(!editor?.isEditable)return;
      const position=at??editor.state.selection.from;
      const items=files.map(file=>({id:crypto.randomUUID(),file,progress:0,status:"queued" as const,controller:new AbortController()}));
      let transaction=editor.state.tr;
      // A separate marker for every file follows document mappings, including remote edits.
      for(const item of items){transaction=editor.state.tr.setMeta(uploadMarkersKey,{add:{id:item.id,pos:position,name:item.file.name}});editor.view.dispatch(transaction);}
      uploadsRef.current=[...uploadsRef.current,...items];setUploads(uploadsRef.current);
      void (async()=>{for(const item of items){const current=uploadsRef.current.find(row=>row.id===item.id);if(current&&current.status==="queued")await runUpload.current(current);}})();
    };
  });

  useEffect(() => {
    const dom = editor?.view.dom;
    if (!dom) return;
    const pick = () => fileInputRef.current?.click();
    dom.addEventListener(PICK_FILE_EVENT, pick);
    return () => dom.removeEventListener(PICK_FILE_EVENT, pick);
  }, [editor]);

  useEffect(() => {
    if (!editor || !outsideEditRef) return;
    outsideEditRef.current = ({ at, text }) => {
      const content = markdownToDocument(markdown, text);
      if (at === "all") editor.commands.setContent(content);
      else editor.commands.insertContentAt(at === "start" ? 0 : editor.state.doc.content.size, content.content ?? []);
    };
    return () => {
      outsideEditRef.current = null;
    };
  }, [editor, markdown, outsideEditRef]);

  // A change from outside the editor (a linked page, an accepted AI edit) replaces the text.
  // Typing never lands here because `emitted` already holds it. A shared document takes outside
  // text from the server; here `value` can be a moment behind what others just typed.
  const shared = Boolean(collab);
  useEffect(() => {
    if (!editor || shared || value === emitted.current) return;
    emitted.current = value;
    editor.commands.setContent(markdownToDocument(markdown, value), { emitUpdate: false });
  }, [editor, markdown, shared, value]);

  useEffect(() => {
    if (editor) editor.setEditable(editable, false);
  }, [editor, editable]);

  // New comments, or a comment picked in the panel: repaint, and bring the passage into view.
  useEffect(() => {
    if (!editor) return;
    anchorStore.update(anchors, activeAnchor, (id) => anchorClickRef.current?.(id));
    editor.view.dispatch(editor.state.tr.setMeta(anchorsKey, true));
    const ranges = anchorsKey.getState(editor.state)?.find().map(mark=>({id:String(mark.spec.id),from:mark.from,to:mark.to}))??[];
    locatedRef.current?.(new Set(ranges.map((range) => range.id)));
    const root = frameRef.current?.getBoundingClientRect();
    const groups=new Map<number,string[]>();
    for(const range of ranges){const pos=editor.state.doc.resolve(range.from),from=pos.depth>=1?pos.before(1):0;const ids=groups.get(from)??[];ids.push(range.id);groups.set(from,ids);}
    setMarginCounts(
      root
        ? [...groups].map(([from,ids])=>({from,ids,count:ids.length})).sort((a,b)=>a.from-b.from).map((group) => ({
            ...group,
            top: editor.view.coordsAtPos(Math.min(group.from + 1, editor.state.doc.content.size)).top - root.top,
          }))
        : [],
    );
  }, [editor, anchorStore, anchors, activeAnchor, value]);

  const locatedSelection=useRef<{id:string|null;done:boolean}>({id:null,done:false});
  // Explicit selection scrolls once. Typing only repaints the anchor positions.
  useEffect(()=>{
    if(locatedSelection.current.id!==activeAnchor)locatedSelection.current={id:activeAnchor,done:false};
    if(!editor||!activeAnchor||locatedSelection.current.done)return;
    const active=anchorsKey.getState(editor.state)?.find(undefined,undefined,spec=>spec.id===activeAnchor)[0];
    if(active){locatedSelection.current.done=true;const {node}=editor.view.domAtPos(active.from);(node instanceof Element?node:node.parentElement)?.scrollIntoView({block:"center",behavior:"smooth"});}
  },[editor,activeAnchor,anchorStore,anchors,value]);

  const marks = [
    { label: "Bold", icon: Bold, name: "bold", run: (e: Editor) => e.chain().focus().toggleBold().run() },
    { label: "Italic", icon: Italic, name: "italic", run: (e: Editor) => e.chain().focus().toggleItalic().run() },
    { label: "Strikethrough", icon: Strikethrough, name: "strike", run: (e: Editor) => e.chain().focus().toggleStrike().run() },
    { label: "Code", icon: Code, name: "code", run: (e: Editor) => e.chain().focus().toggleCode().run() },
  ];

  // Finds the text block level with the pointer, wherever across the row the pointer is.
  const trackBlock = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!editor || !onComment) return;
    const text = editor.view.dom.getBoundingClientRect();
    const left = Math.min(text.right - 1, Math.max(text.left + 1, event.clientX));
    const found = editor.view.posAtCoords({ left, top: event.clientY });
    const $pos = found ? editor.state.doc.resolve(found.pos) : null;
    if (!$pos || !$pos.parent.isTextblock || $pos.parent.content.size === 0) {
      setHovered(null);
      return;
    }
    const from = $pos.start();
    const to = $pos.end();
    const block = $pos.depth >= 1 ? $pos.before(1) : 0;
    const top = editor.view.coordsAtPos(from).top - event.currentTarget.getBoundingClientRect().top;
    setHovered((current) =>
      current?.from === from && current.to === to && current.top === top && current.block === block
        ? current
        : { from, to, top, block }
    );
  };

  return (
    <div
      ref={frameRef}
      className={`document-editor relative ${onComment || marginCounts.length > 0 ? "pr-7" : ""}`}
      onMouseMove={trackBlock}
      onMouseLeave={() => setHovered(null)}
    >
      {editor && editable && (
        <DragHandle
          editor={editor}
          className="drag-handle"
          onNodeChange={({ node, pos }) => {
            setHandleBlock(node ? { pos, name: node.type.name } : null);
            if (!node) setTurnMenu(null);
          }}
          onElementDragStart={() => setTurnMenu(null)}
        >
          <button
            type="button"
            data-testid="doc-block-handle"
            title={t(handleBlock && canTurnBlock(handleBlock.name) ? "Drag to move. Click to turn into." : "Drag to move.")}
            aria-label={t(handleBlock && canTurnBlock(handleBlock.name) ? "Drag to move. Click to turn into." : "Drag to move.")}
            onClick={(event) => {
              if (!handleBlock || !canTurnBlock(handleBlock.name)) return;
              const rect = event.currentTarget.getBoundingClientRect();
              setTurnMenu({ x: rect.right + 4, y: rect.top, pos: handleBlock.pos });
            }}
            className="cursor-grab rounded p-0.5 text-faint hover:bg-elevated hover:text-text active:cursor-grabbing"
          >
            <GripVertical size={14} />
          </button>
        </DragHandle>
      )}
      {editor && turnMenu && (
        <div
          role="menu"
          data-testid="doc-turn-into"
          style={{ position: "fixed", left: turnMenu.x, top: turnMenu.y }}
          className="z-50 max-h-72 w-48 overflow-y-auto rounded-md border border-border bg-overlay p-1 shadow-md"
        >
          {BLOCK_TURNS.map((item) => (
            <button
              key={item.turn}
              type="button"
              role="menuitem"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                const next = turnBlock(editor.state, turnMenu.pos, item.turn);
                if (next) dispatchTurn(editor, next);
                setTurnMenu(null);
              }}
              className="flex w-full rounded px-2 py-1 text-left text-body text-muted hover:bg-elevated hover:text-text"
            >
              {t(item.label)}
            </button>
          ))}
        </div>
      )}
      {editor && (
        <BubbleMenu
          editor={editor}
          shouldShow={({ editor: current, state, view, element }) =>
            !state.selection.empty &&
            !current.isActive("codeBlock") &&
            !current.isActive("image") &&
            (view.hasFocus() || element.contains(document.activeElement))
          }
          className="flex max-w-[360px] flex-wrap items-center gap-0.5 rounded-md border border-border bg-overlay p-0.5 shadow-md"
        >
          {editable && marks.map((mark) => (
            <button
              key={mark.name}
              type="button"
              title={t(mark.label)}
              aria-label={t(mark.label)}
              onClick={() => mark.run(editor)}
              className={`rounded p-1 transition-colors hover:bg-elevated ${
                editor.isActive(mark.name) ? "text-text" : "text-muted"
              }`}
            >
              <mark.icon size={14} />
            </button>
          ))}
          {editable && <SelectionStyleButtons editor={editor} />}
          {onComment && (
            <button
              type="button"
              title={t("Comment")}
              aria-label={t("Comment")}
              onClick={() => {
                const { from, to } = editor.state.selection;
                const anchor = anchorFromSelection(editor.state.doc, from, to);
                if (anchor) onComment(anchor);
              }}
              className="rounded p-1 text-muted transition-colors hover:bg-elevated"
            >
              <MessageSquare size={14} />
            </button>
          )}
          {editable && editor.isActive("table") && (
            <>
              <span className="mx-0.5 h-4 w-px bg-border" />
              <TableEditButtons editor={editor} />
            </>
          )}
        </BubbleMenu>
      )}
      {editor && editable && (
        <BubbleMenu
          editor={editor}
          pluginKey="docTableMenu"
          shouldShow={({ editor: current, state, view }) =>
            state.selection.empty && current.isActive("table") && view.hasFocus()
          }
          className="flex max-w-[320px] flex-wrap items-center gap-0.5 rounded-md border border-border bg-overlay p-0.5 shadow-md"
          data-testid="doc-table-menu"
        >
          <TableEditButtons editor={editor} />
        </BubbleMenu>
      )}
      {editor && editable && (
        <BubbleMenu
          editor={editor}
          pluginKey="docCodeMenu"
          shouldShow={({ editor: current, view, element }) =>
            current.isActive("codeBlock") && (view.hasFocus() || element.contains(document.activeElement))
          }
          className="rounded-md border border-border bg-overlay p-0.5 shadow-md"
          data-testid="doc-code-menu"
        >
          <CodeBlockMenu editor={editor} />
        </BubbleMenu>
      )}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        data-doc-file-input
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          if (files.length) insertRef.current(files);
        }}
      />
      {editable&&editor&&(
        <div className="mb-2 flex flex-wrap items-center gap-1 border-b border-border pb-1">
          <Menu width={240} trigger={`${t("Insert block")} · /`} triggerClassName={EDITOR_TOOL} className="max-[600px]:contents">
            {(close)=>(
              <div className="max-h-[380px] overflow-y-auto">
                <div className="px-2 pb-1 pt-1 text-caption text-faint">{t("Insert")}</div>
                {COMMANDS.map(command=>(
                  <MenuItem key={command.label} onSelect={()=>{close();window.setTimeout(()=>command.run(editor,{from:editor.state.selection.from,to:editor.state.selection.from}),20);}}>
                    <command.icon size={14}/>
                    <span className="min-w-0 flex-1 truncate">{t(command.label)}</span>
                  </MenuItem>
                ))}
              </div>
            )}
          </Menu>
          {editor.isActive("table")&&(
            <Menu width={200} trigger={t("Table")} triggerClassName={EDITOR_TOOL}>
              {(close)=>(
                <>
                  <div className="px-2 pb-1 pt-1 text-caption text-faint">{t("Table")}</div>
                  {([
        ["Add row",()=>editor.chain().focus().addRowAfter().run()], ["Delete row",()=>editor.chain().focus().deleteRow().run()], ["Add column",()=>editor.chain().focus().addColumnAfter().run()], ["Delete column",()=>editor.chain().focus().deleteColumn().run()], ["Toggle header",()=>editor.chain().focus().toggleHeaderRow().run()], ["Merge cells",()=>editor.chain().focus().mergeCells().run()], ["Split cell",()=>editor.chain().focus().splitCell().run()], ["Delete table",()=>editor.chain().focus().deleteTable().run()]
                  ] as const).map(([label,run],index)=>(
                    <Fragment key={label}>
                      {index===4&&<div className="my-1 h-px bg-border"/>}
                      <MenuItem onSelect={()=>{close();window.setTimeout(()=>run(),20);}}>{t(label)}</MenuItem>
                    </Fragment>
                  ))}
                </>
              )}
            </Menu>
          )}
        </div>
      )}
      {uploads.length>0&&<div className="mb-2 space-y-1 text-small" aria-live="polite">{uploads.map(item=><div key={item.id} className="flex flex-wrap items-center gap-2"><span>{item.file.name}: {t(item.status)} {item.status==="uploading"?`${item.progress}%`:""}</span>{item.error&&<span role="alert" className="text-danger">{t(item.error)}</span>}{["queued","uploading"].includes(item.status)?<button type="button" onClick={()=>{item.controller.abort();uploadsRef.current=uploadsRef.current.map(row=>row.id===item.id?{...row,status:"cancelled"}:row);setUploads(uploadsRef.current);}}>{t("Cancel")}</button>:<><button type="button" onClick={()=>{if(editor&&!editor.isDestroyed)editor.view.dispatch(editor.state.tr.setMeta(uploadMarkersKey,{remove:item.id}));uploadsRef.current=uploadsRef.current.filter(row=>row.id!==item.id);setUploads(uploadsRef.current);}}>{t("Dismiss")}</button>{item.status!=="done"&&<button type="button" disabled={!editable} onClick={()=>void runUpload.current(item)}>{t("Retry")}</button>}</>}</div>)}</div>}
      <EditorContent editor={editor} />
      {marginCounts.map((group) => (
        <button
          key={group.from}
          type="button"
          data-testid="doc-comment-count"
          title={t(group.count === 1 ? "{count} comment" : "{count} comments", { count: group.count })}
          aria-label={t(group.count === 1 ? "{count} comment" : "{count} comments", { count: group.count })}
          style={{ top: group.top }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onAnchorClick?.(group.ids[0])}
          className={`absolute right-0 flex h-6 min-w-6 items-center justify-center rounded px-1 text-small tabular-nums ${
            group.ids.includes(activeAnchor ?? "") ? "bg-elevated text-text" : "text-muted hover:bg-elevated hover:text-text"
          }`}
        >
          {group.count}
        </button>
      ))}
      {editor && onComment && hovered && !marginCounts.some((group) => group.from === hovered.block) && (
        <button
          type="button"
          data-testid="block-comment"
          title={t("Comment")}
          aria-label={t("Comment")}
          style={{ top: hovered.top }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            const end = Math.min(hovered.to, editor.state.doc.content.size);
            const anchor = anchorFromSelection(editor.state.doc, hovered.from, end);
            if (anchor) onComment(anchor);
          }}
          className="absolute right-0 flex h-6 w-6 items-center justify-center rounded text-faint transition-colors hover:bg-elevated hover:text-text"
        >
          <MessageSquarePlus size={14} />
        </button>
      )}
      {mentionMenu && mentionMenu.items.length > 0 && (
        <SuggestionMenu rect={mentionMenu.rect} context={editor?.view.dom} testId="doc-mention-menu">
          {mentionMenu.items.map((member, index) => (
            <button
              key={member.id}
              type="button"
              role="option"
              aria-selected={index === mentionMenu.selected}
              onMouseDown={(event) => {
                event.preventDefault();
                mentionMenu.pick(member);
              }}
              className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-body ${
                index === mentionMenu.selected ? "bg-elevated text-text" : "text-muted"
              }`}
            >
              <AssigneeAvatar displayName={member.displayName} avatar={member.avatar} size={16} />
              <span className="min-w-0 flex-1 truncate">{member.displayName}</span>
              <span className="truncate text-small text-faint">@{member.username}</span>
            </button>
          ))}
          {mentionWarning && mentionMenu.items[mentionMenu.selected] && mentionMenu.items[mentionMenu.selected].id !== mentionWarning.ownerId && (
            <div className="mt-1 flex items-center gap-2 border-t border-border px-2 pb-1 pt-1.5 text-small text-muted">
              <span className="min-w-0 flex-1">{t("{names} cannot see this document.", { names: mentionMenu.items[mentionMenu.selected].displayName })}</span>
              {mentionWarning.onShare && (
                <button type="button" onMouseDown={(event) => { event.preventDefault(); mentionWarning.onShare?.(); }} className="shrink-0 rounded-md border border-border px-2 py-0.5 text-small font-medium text-text hover:border-border-strong">
                  {t("Share with workspace")}
                </button>
              )}
            </div>
          )}
        </SuggestionMenu>
      )}
      {pageMenu && pageMenu.items.length > 0 && (
        <SuggestionMenu rect={pageMenu.rect} context={editor?.view.dom} testId="doc-page-link-menu">
          {pageMenu.items.map((page, index) => (
            <button
              key={page.id}
              type="button"
              role="option"
              aria-selected={index === pageMenu.selected}
              data-page-link-option={page.id}
              onMouseDown={(event) => {
                event.preventDefault();
                pageMenu.pick(page);
              }}
              className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-body ${
                index === pageMenu.selected ? "bg-elevated text-text" : "text-muted"
              }`}
            >
              <span className="shrink-0 text-lead">{page.icon ?? <FileText size={13} />}</span>
              <span className="min-w-0 flex-1 truncate">{page.title}</span>
              {page.path && <span className="max-w-40 truncate text-small text-faint">{page.path}</span>}
            </button>
          ))}
        </SuggestionMenu>
      )}
      {menu && menu.items.length > 0 && (
        <SuggestionMenu rect={menu.rect} context={editor?.view.dom}>
          <div className="px-2 pb-1 pt-1 text-caption text-faint">{t("Insert")}</div>
          {menu.items.map((command, index) => (
            <button
              key={command.label}
              type="button"
              role="option"
              aria-selected={index === menu.selected}
              onMouseDown={(event) => {
                event.preventDefault();
                menu.pick(command);
              }}
              className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-body ${
                index === menu.selected ? "bg-elevated text-text" : "text-muted"
              }`}
            >
              <command.icon size={14} />
              <span className="min-w-0 flex-1 truncate">{t(command.label)}</span>
              <span className="truncate text-small text-faint">{t(command.hint)}</span>
            </button>
          ))}
        </SuggestionMenu>
      )}
    </div>
  );
}
