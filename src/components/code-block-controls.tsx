"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import { Check, ChevronDown, ChevronRight, Copy, SlidersHorizontal } from "lucide-react";
import type { CodeToken } from "@/lib/code-highlight";
import { useT } from "@/components/i18n-context";

// The languages a fence may carry. The ids stay word-only because the Markdown
// parser reads the info string with `^```(\w*)`.
export const CODE_LANGUAGES: { id: string; label: string }[] = [
  { id: "", label: "plain text" },
  { id: "python", label: "Python" },
  { id: "bash", label: "Bash" },
  { id: "shell", label: "Shell" },
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript" },
  { id: "jsx", label: "JSX" },
  { id: "tsx", label: "TSX" },
  { id: "json", label: "JSON" },
  { id: "sql", label: "SQL" },
  { id: "yaml", label: "YAML" },
  { id: "html", label: "HTML" },
  { id: "css", label: "CSS" },
  { id: "markdown", label: "Markdown" },
  { id: "go", label: "Go" },
  { id: "rust", label: "Rust" },
  { id: "java", label: "Java" },
  { id: "kotlin", label: "Kotlin" },
  { id: "swift", label: "Swift" },
  { id: "ruby", label: "Ruby" },
  { id: "php", label: "PHP" },
  { id: "c", label: "C" },
  { id: "cpp", label: "C++" },
  { id: "csharp", label: "C#" },
  { id: "lua", label: "Lua" },
  { id: "r", label: "R" },
  { id: "diff", label: "Diff" },
  { id: "graphql", label: "GraphQL" },
  { id: "dockerfile", label: "Dockerfile" },
  { id: "ini", label: "INI" },
  { id: "toml", label: "TOML" },
  { id: "xml", label: "XML" },
];

// Fences written by other tools (```js, ```py) keep their own spelling in the source;
// only the label is normalized.
const LANGUAGE_ALIASES: Record<string, string> = {
  js: "JavaScript",
  ts: "TypeScript",
  py: "Python",
  rb: "Ruby",
  sh: "Shell",
  zsh: "Shell",
  yml: "YAML",
  plaintext: "plain text",
  text: "plain text",
  txt: "plain text",
};

export function languageLabel(lang: string): string {
  if (!lang) return "plain text";
  const known = CODE_LANGUAGES.find((entry) => entry.id === lang);
  return known ? known.label : (LANGUAGE_ALIASES[lang] ?? lang);
}

// Line numbers are a reading preference, not document content: they stay out of the
// Markdown source so the importer and the API keep seeing the same fence. One store for
// the whole page keeps a toggle in one block in step with every other block, including
// the block that is currently open for editing.
const LINE_NUMBERS_KEY = "tacos.code.lineNumbers";

let lineNumbers: boolean | null = null;
const prefListeners = new Set<() => void>();

function readLineNumbers(): boolean {
  try {
    return window.localStorage.getItem(LINE_NUMBERS_KEY) !== "0";
  } catch {
    return true;
  }
}

function lineNumbersSnapshot(): boolean {
  if (lineNumbers === null) lineNumbers = readLineNumbers();
  return lineNumbers;
}

function subscribeLineNumbers(listener: () => void) {
  prefListeners.add(listener);
  return () => {
    prefListeners.delete(listener);
  };
}

export function setLineNumbers(next: boolean) {
  lineNumbers = next;
  try {
    window.localStorage.setItem(LINE_NUMBERS_KEY, next ? "1" : "0");
  } catch {
    // A blocked localStorage only costs the remembered choice.
  }
  for (const listener of prefListeners) listener();
}

export function useLineNumbers(): boolean {
  return useSyncExternalStore(subscribeLineNumbers, lineNumbersSnapshot, () => true);
}

// Colours only — no weight or style — because the editor draws this text in the ghost
// layer underneath a transparent textarea, and any metric change would move the caret.
const TOKEN_CLASS: Record<Exclude<CodeToken["kind"], "plain">, string> = {
  keyword: "text-code-keyword",
  builtin: "text-code-builtin",
  string: "text-code-string",
  number: "text-code-number",
  comment: "text-code-comment",
};

export function CodeTokens({ tokens }: { tokens: CodeToken[] }) {
  return (
    <>
      {tokens.map((token, i) =>
        token.kind === "plain" ? (
          <span key={i}>{token.text}</span>
        ) : (
          <span key={i} className={TOKEN_CLASS[token.kind]}>
            {token.text}
          </span>
        ),
      )}
    </>
  );
}

/** The header's copy control. Always on screen, in both the read and the edit header. */
export function CodeCopyButton({ code }: { code: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // A denied clipboard only costs the shortcut; the text stays selectable.
    }
  };
  return (
    <button
      type="button"
      // Reading the code is not opening the block, and copying must not blur an open line.
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
        void copy();
      }}
      title={t("Copy code")}
      aria-label={t("Copy code")}
      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-faint transition-colors hover:bg-elevated hover:text-text"
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? t("Copied") : t("Copy")}
    </button>
  );
}

/** Folds the code away so a long block leaves room for the text around it. */
export function CodeCollapseButton({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const label = collapsed ? t("Expand code") : t("Collapse code");
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-expanded={!collapsed}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className="flex h-5 w-5 items-center justify-center rounded text-faint transition-colors hover:bg-elevated hover:text-text"
    >
      {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
    </button>
  );
}

function useOutsideClose(open: boolean, ref: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && ref.current?.contains(target)) return;
      close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, ref, close]);
}

/**
 * The fence's language. Without `onChange` this is just the label the header has always
 * shown; with it, the label opens a Notion-style picker.
 */
export function CodeLanguageMenu({
  lang,
  onChange,
}: {
  lang: string;
  onChange?: (lang: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useOutsideClose(open, rootRef, () => setOpen(false));

  const label = languageLabel(lang);
  if (!onChange) return <span className="font-mono text-[11px] text-faint">{label}</span>;

  // A code block opens for editing on a plain click, and in edit mode a mousedown
  // outside the textarea would blur — and so close — the line. The picker is neither.
  const keep = (event: ReactMouseEvent) => event.stopPropagation();
  return (
    <div ref={rootRef} className="relative" onMouseDown={keep} onClick={keep}>
      <button
        type="button"
        title={t("Change language")}
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
        className={`group/lang flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] text-faint transition-colors hover:bg-elevated hover:text-text ${
          open ? "bg-elevated text-text" : ""
        }`}
      >
        {label}
        <ChevronDown
          size={10}
          className={open ? "" : "opacity-0 transition-opacity group-hover/lang:opacity-100"}
        />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 max-h-60 w-44 overflow-y-auto rounded-lg border border-border bg-overlay p-1 shadow-lg shadow-black/10"
        >
          {CODE_LANGUAGES.map((option) => (
            <button
              key={option.id || "plain"}
              type="button"
              role="menuitemradio"
              aria-checked={option.id === lang}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setOpen(false);
                onChange(option.id);
              }}
              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-[12.5px] hover:bg-elevated"
            >
              <span className="truncate">{option.label}</span>
              {option.id === lang ? <Check size={11} className="shrink-0 text-accent" /> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The sliders popover: for now the shared t("Show line numbers") switch. */
export function CodeOptionsMenu() {
  const t = useT();
  const showNumbers = useLineNumbers();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useOutsideClose(open, rootRef, () => setOpen(false));

  const keep = (event: ReactMouseEvent) => event.stopPropagation();
  return (
    <div ref={rootRef} className="relative" onMouseDown={keep} onClick={keep}>
      <button
        type="button"
        title={t("Code options")}
        aria-label={t("Code options")}
        aria-haspopup="true"
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
        className={`flex h-5 w-5 items-center justify-center rounded text-faint transition-colors hover:bg-elevated hover:text-text ${
          open ? "bg-elevated text-text" : ""
        }`}
      >
        <SlidersHorizontal size={11} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-lg border border-border bg-overlay p-1.5 shadow-lg shadow-black/10">
          <button
            type="button"
            role="switch"
            aria-checked={showNumbers}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setLineNumbers(!showNumbers)}
            className="flex w-full items-center justify-between gap-4 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-elevated"
          >
            {t("Show line numbers")}
            <span
              aria-hidden
              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                showNumbers ? "bg-accent" : "bg-border-strong"
              }`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                  showNumbers ? "left-[18px]" : "left-0.5"
                }`}
              />
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
