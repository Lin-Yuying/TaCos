"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EditorContent, useEditor, type Editor, type Range } from "@tiptap/react";
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
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  List,
  ListOrdered,
  MessageSquare,
  Minus,
  Quote,
  Strikethrough,
  Table as TableIcon,
  Type,
} from "lucide-react";
import { documentExtensions } from "@/lib/editor/extensions";
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

type MenuState = { items: SlashCommand[]; selected: number; x: number; y: number; pick: (c: SlashCommand) => void };

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
  const menuRef = useRef<MenuState | null>(null);
  const [anchorStore] = useState(() => new AnchorStore());
  const locatedRef = useRef(onAnchorsLocated);
  const anchorClickRef = useRef(onAnchorClick);
  const uploadRef = useRef(onUpload);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
    pagesRef.current = pages;
    menuRef.current = menu;
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
                onKeyDown: ({ event }) => {
                  const open = menuRef.current;
                  if (!open || open.items.length === 0) return false;
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    const step = event.key === "ArrowDown" ? 1 : open.items.length - 1;
                    setMenu({ ...open, selected: (open.selected + step) % open.items.length });
                    return true;
                  }
                  if (event.key === "Enter") {
                    open.pick(open.items[open.selected]);
                    return true;
                  }
                  if (event.key === "Escape") {
                    setMenu(null);
                    return true;
                  }
                  return false;
                },
              }),
            }),
          ];
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
      ...documentExtensions({ sharedHistory: Boolean(collab) }),
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

  return (
    <div className="document-editor">
      {editor && (
        <BubbleMenu
          editor={editor}
          shouldShow={({ state, view }) => !state.selection.empty && view.hasFocus()}
          className="flex items-center gap-0.5 rounded-md border border-border bg-overlay p-0.5 shadow-md"
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
              className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[13px] ${
                index === menu.selected ? "bg-elevated text-text" : "text-muted"
              }`}
            >
              <command.icon size={14} />
              <span className="min-w-0 flex-1 truncate">{t(command.label)}</span>
              <span className="truncate text-[11.5px] text-faint">{t(command.hint)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
