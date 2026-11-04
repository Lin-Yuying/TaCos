"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EditorContent, useEditor, type Editor, type Range } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Extension } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import {
  Bold,
  CheckSquare,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Minus,
  Quote,
  Strikethrough,
  Table as TableIcon,
  Type,
} from "lucide-react";
import { documentExtensions } from "@/lib/editor/extensions";
import { documentMarkdown, markdownToDocument } from "@/lib/editor/document-markdown";
import type { PageContext } from "@/components/markdown";
import { useT } from "@/components/i18n-context";

type SlashCommand = {
  label: string;
  hint: string;
  keywords: string;
  icon: React.ComponentType<{ size?: number | string }>;
  run: (editor: Editor, range: Range) => void;
};

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
  { label: "Divider", hint: "Visual break", keywords: "hr line rule separator", icon: Minus, run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
];

function matchCommands(query: string): SlashCommand[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return COMMANDS;
  return COMMANDS.filter((c) => `${c.label} ${c.keywords}`.toLowerCase().includes(needle));
}

type MenuState = { items: SlashCommand[]; selected: number; x: number; y: number; pick: (c: SlashCommand) => void };

export function DocumentEditor({
  value,
  onChange,
  placeholder,
  pages,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  pages?: PageContext;
}) {
  const t = useT();
  const router = useRouter();
  const markdown = useMemo(() => documentMarkdown(), []);
  const emitted = useRef(value);
  const onChangeRef = useRef(onChange);
  const pagesRef = useRef(pages);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<MenuState | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
    pagesRef.current = pages;
    menuRef.current = menu;
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

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [...documentExtensions(), Placeholder.configure({ placeholder: placeholder ?? "" }), slash],
    content: markdownToDocument(markdown, value),
    editorProps: {
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

  // A change from outside the editor (a linked page, an accepted AI edit) replaces the text.
  // Typing never lands here because `emitted` already holds it.
  useEffect(() => {
    if (!editor || value === emitted.current) return;
    emitted.current = value;
    editor.commands.setContent(markdownToDocument(markdown, value), { emitUpdate: false });
  }, [editor, markdown, value]);

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
          className="flex items-center gap-0.5 rounded-md border border-border bg-overlay p-0.5 shadow-md"
        >
          {marks.map((mark) => (
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
        </BubbleMenu>
      )}
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
