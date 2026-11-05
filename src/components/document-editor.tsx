"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EditorContent, useEditor, type Editor, type Range } from "@tiptap/react";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import type { EditorState } from "@tiptap/pm/state";
import { BubbleMenu } from "@tiptap/react/menus";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import Placeholder from "@tiptap/extension-placeholder";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import {
  Bold,
  CheckSquare,
  Code,
  GripVertical,
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
} from "lucide-react";
import { AssigneeAvatar } from "@/components/issue-table";
import { DocMention, documentExtensions } from "@/lib/editor/extensions";
import { documentColor, documentLinkHref } from "@/lib/markdown";
import type { Member } from "@/lib/issues";
import { BLOCK_TURNS, canTurnBlock, turnBlock } from "@/lib/editor/block-turn";
import { documentMarkdown, markdownToDocument } from "@/lib/editor/document-markdown";
import { anchorFromSelection, anchorRanges } from "@/lib/editor/anchors";
import type { DocAnchor } from "@/lib/doc-anchor";
import type { PageContext } from "@/components/markdown";
import type { DocCollab } from "@/components/use-doc-collab";
import { useT } from "@/components/i18n-context";

type SlashCommand = {
  label: string;
  hint: string;
  keywords: string;
  icon: React.ComponentType<{ size?: number | string }>;
  run: (editor: Editor, range: Range) => void;
};

const PICK_FILE_EVENT = "tacos:pick-file";

const COMMANDS: SlashCommand[] = [
  { label: "Text", hint: "Plain paragraph", keywords: "plain body p", icon: Type, run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run() },
  { label: "Heading 1", hint: "Large section title", keywords: "h1 title", icon: Heading1, run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 1 }).run() },
  { label: "Heading 2", hint: "Medium section title", keywords: "h2 subtitle", icon: Heading2, run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run() },
  { label: "Heading 3", hint: "Small section title", keywords: "h3", icon: Heading3, run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run() },
  { label: "Bulleted list", hint: "Unordered items", keywords: "bullet ul dash list", icon: List, run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { label: "Numbered list", hint: "Ordered items", keywords: "ordered ol number list", icon: ListOrdered, run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { label: "To-do list", hint: "Checkable items", keywords: "todo task checkbox check", icon: CheckSquare, run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
  { label: "Quote", hint: "Set text apart", keywords: "blockquote citation", icon: Quote, run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
  { label: "Code", hint: "Fenced block", keywords: "code block pre", icon: Code, run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
  { label: "Table", hint: "Rows and columns", keywords: "table grid", icon: TableIcon, run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { label: "Image or file", hint: "Upload to this document", keywords: "image picture photo attachment upload file", icon: ImageIcon, run: (e, r) => {
    e.chain().focus().deleteRange(r).run();
    e.view.dom.dispatchEvent(new CustomEvent(PICK_FILE_EVENT));
  } },
  { label: "Divider", hint: "Visual break", keywords: "hr line rule separator", icon: Minus, run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
];

function matchCommands(query: string): SlashCommand[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return COMMANDS;
  return COMMANDS.filter((c) => `${c.label} ${c.keywords}`.toLowerCase().includes(needle));
}

type MenuState<T = SlashCommand> = { items: T[]; selected: number; x: number; y: number; pick: (item: T) => void };

// Arrow keys, Enter and Escape while a suggestion menu is open.
function menuKey<T>(event: KeyboardEvent, open: MenuState<T> | null, set: (next: MenuState<T> | null) => void): boolean {
  if (!open || open.items.length === 0) return false;
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
          className="flex basis-full items-center gap-1 px-1 py-1"
          onSubmit={(event) => {
            event.preventDefault();
            applyLink(linkDraft);
          }}
        >
          <input
            data-testid="doc-link-field"
            value={linkDraft}
            onChange={(event) => setLinkDraft(event.target.value)}
            placeholder={t("Web address")}
            aria-label={t("Web address")}
            className="min-w-0 flex-1 rounded border border-border bg-bg px-1 py-0.5 text-small text-text"
          />
          <button
            type="submit"
            disabled={documentLinkHref(linkDraft) === null}
            className="rounded px-1.5 py-1 text-small text-muted transition-colors hover:bg-elevated hover:text-text disabled:opacity-40"
          >
            {t("Add link")}
          </button>
          {editor.isActive("link") && (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                editor.chain().focus().extendMarkRange("link").unsetLink().run();
                setLinkDraft(null);
              }}
              className="rounded px-1.5 py-1 text-small text-muted transition-colors hover:bg-elevated hover:text-text"
            >
              {t("Remove link")}
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

export type EditorAnchor = DocAnchor & { id: string };

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
    return [
      new Plugin<DecorationSet>({
        key: anchorsKey,
        state: {
          init: (_, state) => build(state.doc),
          apply: (tr, set) => (tr.docChanged || tr.getMeta(anchorsKey) ? build(tr.doc) : set),
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
  anchors = NO_ANCHORS,
  members = NO_MEMBERS,
  viewerId = null,
  activeAnchor = null,
  onComment,
  onAnchorClick,
  onAnchorsLocated,
  onUpload,
  collab,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  pages?: PageContext;
  // A reader who cannot edit still sees the same page and can select text to comment on.
  editable?: boolean;
  anchors?: EditorAnchor[];
  // Who "@" offers; the viewer comes last.
  members?: Member[];
  viewerId?: string | null;
  activeAnchor?: string | null;
  onComment?: (anchor: DocAnchor) => void;
  onAnchorClick?: (id: string) => void;
  onAnchorsLocated?: (ids: Set<string>) => void;
  // Sends a pasted, dropped or picked file and returns its address, or null when it failed.
  onUpload?: (file: File) => Promise<string | null>;
  // A shared document; its text comes from here and not from `value`. Fixed for the editor's life.
  collab?: Extract<DocCollab, { doc: unknown }>;
}) {
  const t = useT();
  const router = useRouter();
  const markdown = useMemo(() => documentMarkdown(), []);
  const emitted = useRef(value);
  const onChangeRef = useRef(onChange);
  const pagesRef = useRef(pages);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [handleBlock, setHandleBlock] = useState<{ pos: number; name: string } | null>(null);
  const [turnMenu, setTurnMenu] = useState<{ x: number; y: number; pos: number } | null>(null);
  const menuRef = useRef<MenuState | null>(null);
  const [mentionMenu, setMentionMenu] = useState<MenuState<Member> | null>(null);
  const mentionMenuRef = useRef<MenuState<Member> | null>(null);
  const membersRef = useRef({ members, viewerId });
  // The text block under the pointer, for the comment button in the right margin.
  const [hovered, setHovered] = useState<{ from: number; to: number; top: number } | null>(null);
  const [anchorStore] = useState(() => new AnchorStore());
  const locatedRef = useRef(onAnchorsLocated);
  const anchorClickRef = useRef(onAnchorClick);
  const uploadRef = useRef(onUpload);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
    pagesRef.current = pages;
    menuRef.current = menu;
    mentionMenuRef.current = mentionMenu;
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

  const insertRef = useRef<(files: File[], at?: number) => void>(() => {});
  const dropFiles = (files: FileList | undefined | null, at?: number) => {
    if (!files?.length || !uploadRef.current) return false;
    insertRef.current([...files], at);
    return true;
  };

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      ...documentExtensions({ sharedHistory: Boolean(collab), mention }),
      Placeholder.configure({ placeholder: placeholder ?? "" }), slash, CommentAnchors.configure({ store: anchorStore }),
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
        if (node.type.name !== "pageRef" && node.type.name !== "pageEmbed") return false;
        const ctx = pagesRef.current;
        const target = node.attrs.pageId ?? ctx?.lookup[String(node.attrs.title).toLowerCase()]?.id;
        if (!ctx || !target) return false;
        if (ctx.onOpen) ctx.onOpen(target);
        else router.push(`${ctx.base}${target}`);
        return true;
      },
    },
    onUpdate: ({ editor: current }) => {
      const next = markdown.serialize(current.getJSON());
      if (next === emitted.current) return;
      emitted.current = next;
      onChangeRef.current(next);
    },
  });

  useEffect(() => {
    uploadRef.current = onUpload;
    insertRef.current = (files, at) => {
      if (!editor) return;
      void (async () => {
        let pos = at;
        for (const file of files) {
          const url = await onUpload?.(file);
          if (!url) continue;
          const chain = editor.chain().focus();
          if (pos !== undefined) chain.setTextSelection(pos);
          if (file.type.startsWith("image/")) chain.setImage({ src: url, alt: file.name });
          else chain.insertContent({ type: "text", text: file.name, marks: [{ type: "link", attrs: { href: url } }] });
          chain.run();
          pos = undefined;
        }
      })();
    };
  });

  useEffect(() => {
    const dom = editor?.view.dom;
    if (!dom) return;
    const pick = () => fileInputRef.current?.click();
    dom.addEventListener(PICK_FILE_EVENT, pick);
    return () => dom.removeEventListener(PICK_FILE_EVENT, pick);
  }, [editor]);

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
    const ranges = anchorRanges(editor.state.doc, anchors);
    locatedRef.current?.(new Set(ranges.map((range) => range.anchor.id)));
    const active = ranges.find((range) => range.anchor.id === activeAnchor);
    if (active) {
      const { node } = editor.view.domAtPos(active.from);
      (node instanceof Element ? node : node.parentElement)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [editor, anchorStore, anchors, activeAnchor, value]);

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
    const top = editor.view.coordsAtPos(from).top - event.currentTarget.getBoundingClientRect().top;
    setHovered((current) =>
      current?.from === from && current.to === to && current.top === top ? current : { from, to, top }
    );
  };

  return (
    <div
      className={`document-editor relative ${onComment ? "pr-7" : ""}`}
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
          shouldShow={({ state, view, element }) =>
            !state.selection.empty && (view.hasFocus() || element.contains(document.activeElement))
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
      <EditorContent editor={editor} />
      {editor && onComment && hovered && (
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
        <div
          role="listbox"
          data-testid="doc-mention-menu"
          style={{ position: "fixed", left: mentionMenu.x, top: mentionMenu.y + 4 }}
          className="z-50 max-h-72 w-64 overflow-y-auto rounded-md border border-border bg-overlay p-1 shadow-md"
        >
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
        </div>
      )}
      {menu && menu.items.length > 0 && (
        <div
          role="listbox"
          style={{ position: "fixed", left: menu.x, top: menu.y + 4 }}
          className="z-50 max-h-72 w-64 overflow-y-auto rounded-md border border-border bg-overlay p-1 shadow-md"
        >
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
        </div>
      )}
    </div>
  );
}
