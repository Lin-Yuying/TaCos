"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Check, ChevronDown, ListChecks, LoaderCircle, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { createIssueAction } from "@/app/actions";
import { generateTasksAction } from "@/app/ai-actions";
import {
  AI_EDIT_ACTIONS,
  AI_EDIT_CHAR_LIMIT,
  type AgentEngineOption,
  type AiEditAction,
  type AiEngine,
  type AiTaskDraft,
} from "@/lib/ai-constants";
import { PRIORITY_META } from "@/components/icons";
import { readEngineCookie, rememberEngine, streamAiEdit } from "@/lib/ai-client";
import { Menu, MenuItem } from "@/components/menu";
import { useUI } from "@/components/ui-context";

export type AiEditTarget = {
  mode: "selection" | "document";
  text: string;
  context?: string;
  allowTasks?: boolean;
  allowContinue?: boolean;
  acceptLabel: string;
};

function clampPanel(x: number, y: number) {
  if (typeof window === "undefined") return { left: x, top: y };
  const left = Math.min(Math.max(12, x), Math.max(12, window.innerWidth - 420));
  const top = Math.min(Math.max(12, y), Math.max(12, window.innerHeight - 380));
  return { left, top };
}

export function AiEditPanel({
  workspaceId,
  x,
  y,
  target,
  onClose,
  onAccept,
  onTasks,
}: {
  workspaceId: string;
  x: number;
  y: number;
  target: AiEditTarget;
  onClose: () => void;
  onAccept: (text: string, action: AiEditAction) => void;
  onTasks?: () => void;
}) {
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<AiEditAction | null>(null);
  const [instruction, setInstruction] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The panel only mounts after a click, so reading the saved model here cannot cause a
  // hydration mismatch. Codex is the fallback because it spends the CLI login, not the key.
  const [engine, setEngine] = useState<AiEngine>(() => readEngineCookie() ?? "codex");
  const [engines, setEngines] = useState<AgentEngineOption[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { left, top } = clampPanel(x, y);
  const router = useRouter();
  // The replacement arrives in one answer, so a passage past this length would be refused
  // by the route after the click; the Agent in Work mode can rewrite it in steps.
  const tooLong = target.text.length > AI_EDIT_CHAR_LIMIT;

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    let alive = true;
    fetch(`/api/ai/engines?workspaceId=${encodeURIComponent(workspaceId)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { engines?: AgentEngineOption[] } | null) => {
        const options = data?.engines?.filter((option) => option.available) ?? [];
        if (!alive || options.length === 0) return;
        setEngines(data?.engines ?? options);
        setEngine((prev) =>
          options.some((option) => option.id === prev)
            ? prev
            : (options.find((option) => option.id === "codex")?.id ?? options[0]?.id ?? prev)
        );
      })
      .catch(() => {
        /* keep the guessed model; a failure surfaces on the first run anyway */
      });
    return () => {
      alive = false;
    };
  }, [workspaceId]);

  function chooseEngine(next: AiEngine) {
    setEngine(next);
    rememberEngine(next);
  }

  async function run(kind: AiEditAction) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setAction(kind);
    setError(null);
    setResult("");
    setBusy(true);
    try {
      const text = await streamAiEdit(
        {
          workspaceId,
          action: kind,
          engine,
          text: target.text,
          context: target.context,
          instruction: kind === "custom" ? instruction.trim() : undefined,
        },
        (delta) => setResult((prev) => prev + delta),
        controller.signal
      );
      setResult(text);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "The AI request failed");
    } finally {
      if (abortRef.current === controller) setBusy(false);
    }
  }

  function close() {
    abortRef.current?.abort();
    onClose();
  }

  const actionLabel = AI_EDIT_ACTIONS.find((entry) => entry.id === action)?.label;
  const available = engines.filter((option) => option.available);
  const current = engines.find((option) => option.id === engine);

  return (
    <div
      data-overview-pop
      data-ai-panel
      style={{ left, top }}
      className="fixed z-50 w-[400px] max-w-[calc(100vw-24px)] rounded-xl border border-border bg-bg p-3 shadow-[0_12px_40px_rgba(0,0,0,0.18)]"
    >
      <div className="mb-2 flex items-center gap-1.5">
        <Sparkles size={13} className="text-accent" />
        <span className="text-[12px] font-semibold text-text">AI assistant</span>
        <span className="truncate text-[11px] text-faint">
          {target.mode === "selection" ? "· selected passage" : "· whole document"}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {available.length > 1 && (
            <Menu
              width={220}
              align="right"
              triggerClassName="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:bg-elevated hover:text-text"
              trigger={
                <>
                  <span className="max-w-[92px] truncate">{current?.label ?? "Model"}</span>
                  <ChevronDown size={11} className="shrink-0 text-faint" />
                </>
              }
            >
              {(close) => (
                <>
                  {available.map((option) => (
                    <MenuItem
                      key={option.id}
                      active={option.id === engine}
                      onSelect={() => {
                        close();
                        chooseEngine(option.id);
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate text-left">{option.label}</span>
                      {option.detail && (
                        <span className="shrink-0 text-[10.5px] text-faint">{option.detail}</span>
                      )}
                    </MenuItem>
                  ))}
                </>
              )}
            </Menu>
          )}
          <button
            type="button"
            onClick={close}
            aria-label="Close AI assistant"
            className="rounded p-0.5 text-faint transition-colors hover:bg-elevated hover:text-text"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {tooLong ? (
        <div className="space-y-2 rounded-lg border border-border bg-elevated/30 px-2.5 py-2">
          <p className="text-[11.5px] leading-relaxed text-muted">
            {`${target.text.length.toLocaleString()} characters is past the ${AI_EDIT_CHAR_LIMIT.toLocaleString()}-character limit for a one-shot rewrite.`}
          </p>
          <p className="text-[11.5px] leading-relaxed text-faint">
            The Agent can take it in Work mode: it reads the document, rewrites it in steps and
            saves it back. Select a shorter passage to use this panel.
          </p>
          <button
            type="button"
            onClick={() => {
              close();
              router.push(`/${workspaceId}/agent`);
            }}
            className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[11.5px] font-medium text-white transition-opacity hover:opacity-90"
          >
            <Bot size={12} /> Open Agent in Work mode
          </button>
        </div>
      ) : (
        <>
      <div className="grid grid-cols-2 gap-1">
        {AI_EDIT_ACTIONS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            disabled={busy}
            onClick={() => void run(entry.id)}
            className="rounded-md border border-border px-2 py-1 text-left text-[11.5px] text-muted transition-colors hover:border-border-strong hover:text-text disabled:opacity-40"
          >
            {entry.label}
          </button>
        ))}
        {target.allowContinue && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run("continue")}
            className="col-span-2 rounded-md border border-border px-2 py-1 text-left text-[11.5px] text-muted transition-colors hover:border-border-strong hover:text-text disabled:opacity-40"
          >
            Continue writing from the end
          </button>
        )}
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <input
          ref={inputRef}
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (instruction.trim() && !busy) void run("custom");
            }
          }}
          placeholder="Or tell the AI what to change…"
          className="min-w-0 flex-1 rounded-md border border-border bg-elevated/40 px-2 py-1.5 text-[12px] text-text placeholder:text-faint focus:border-border-strong"
        />
        <button
          type="button"
          disabled={busy || !instruction.trim()}
          onClick={() => void run("custom")}
          className="shrink-0 rounded-md bg-accent px-2.5 py-1.5 text-[11.5px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Run
        </button>
      </div>

      {error && <div className="mt-2 text-[11.5px] text-danger">{error}</div>}

      {(busy || result) && (
        <div className="mt-2">
          <textarea
            value={result}
            onChange={(event) => setResult(event.target.value)}
            rows={7}
            aria-label="AI result"
            className="w-full resize-y rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-[12px] leading-relaxed text-text focus:border-border-strong focus:outline-none"
          />
          {busy && (
            <div className="mt-1 flex items-center gap-1 text-[11px] text-faint">
              <LoaderCircle size={11} className="animate-spin" />
              {actionLabel ? `${actionLabel}…` : "Writing…"}
            </div>
          )}
        </div>
      )}
        </>
      )}

      <div className="mt-2.5 flex items-center gap-2">
        {onTasks && target.allowTasks && !tooLong && (
          <button
            type="button"
            onClick={onTasks}
            className="flex items-center gap-1 text-[11.5px] text-muted transition-colors hover:text-text"
          >
            <ListChecks size={12} /> Turn into tasks
          </button>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={close}
            className="rounded-md border border-border px-2 py-1 text-[11.5px] text-muted transition-colors hover:text-text"
          >
            Cancel
          </button>
          {!tooLong && (
            <button
              type="button"
              disabled={busy || !result.trim()}
              onClick={() => onAccept(result.trim(), action ?? "custom")}
              className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[11.5px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <Check size={11} /> {target.acceptLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const PRIORITY_LABEL: Record<number, string> = {
  0: PRIORITY_META[0].label,
  1: PRIORITY_META[1].label,
  2: PRIORITY_META[2].label,
  3: PRIORITY_META[3].label,
  4: PRIORITY_META[4].label,
};

export function AiTaskDialog({
  workspaceId,
  projectId,
  initialPrompt,
  context,
  onClose,
  onCreated,
}: {
  workspaceId: string;
  projectId: string;
  initialPrompt: string;
  context?: string;
  onClose: () => void;
  onCreated?: (count: number) => void;
}) {
  const router = useRouter();
  const { toast } = useUI();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [tasks, setTasks] = useState<AiTaskDraft[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    const result = await generateTasksAction(workspaceId, {
      prompt,
      projectId,
      context,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setTasks(result.data);
    setPicked(new Set(result.data.map((_, index) => index)));
  }

  async function create() {
    if (!tasks || creating) return;
    const chosen = tasks.filter((_, index) => picked.has(index));
    if (chosen.length === 0) return;
    setCreating(true);
    setError(null);
    let made = 0;
    for (const task of chosen) {
      const result = await createIssueAction(workspaceId, {
        title: task.title,
        description: task.description,
        priority: task.priority,
        labelNames: task.labels,
        project: projectId,
      });
      if (!result.ok) {
        setError(result.error);
        break;
      }
      made += 1;
    }
    setCreating(false);
    if (made > 0) {
      toast(`${made} ${made === 1 ? "task" : "tasks"} created`);
      onCreated?.(made);
      router.refresh();
      onClose();
    }
  }

  function toggle(index: number) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/35 px-[12px] py-[8vh]">
      <div
        role="dialog"
        aria-label="Generate tasks with AI"
        className="w-[560px] max-w-full overflow-hidden rounded-xl border border-border bg-bg shadow-2xl shadow-black/20"
      >
        <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <Sparkles size={14} className="text-accent" />
          <span className="text-[13px] font-semibold">Generate tasks with AI</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto rounded p-1 text-faint transition-colors hover:bg-elevated hover:text-text"
          >
            <X size={14} />
          </button>
        </header>

        <div className="max-h-[72vh] space-y-3 overflow-y-auto p-4">
          <textarea
            autoFocus
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={3}
            placeholder="Describe the work, for example: 把微信登录的联调拆成几个任务，包含接口、前端和回归测试"
            className="w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 text-[13px] leading-relaxed text-text placeholder:text-faint focus:border-border-strong focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void generate()}
              disabled={!prompt.trim() || busy || creating}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {busy ? <LoaderCircle size={12} className="animate-spin" /> : <Sparkles size={12} />}
              {busy ? "Thinking…" : tasks ? "Regenerate" : "Generate"}
            </button>
            <span className="text-[11.5px] text-faint">Nothing is created until you confirm.</span>
          </div>

          {error && <div className="text-[12px] text-danger">{error}</div>}

          {tasks && (
            <div className="divide-y divide-border rounded-lg border border-border">
              {tasks.map((task, index) => {
                const on = picked.has(index);
                return (
                  <label
                    key={`${task.title}-${index}`}
                    className={`flex cursor-pointer items-start gap-2.5 px-3 py-2.5 transition-colors ${
                      on ? "bg-elevated/40" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(index)}
                      className="mt-0.5 h-3.5 w-3.5 accent-[#0d0d0d]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium text-text">{task.title}</span>
                      {task.description && (
                        <span className="mt-0.5 line-clamp-2 block whitespace-pre-wrap text-[11.5px] leading-relaxed text-muted">
                          {task.description}
                        </span>
                      )}
                      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[10.5px] text-faint">
                        <span className="rounded-full bg-elevated px-1.5 py-0.5">
                          {PRIORITY_LABEL[task.priority]}
                        </span>
                        {task.labels.map((label) => (
                          <span key={label} className="rounded-full bg-elevated px-1.5 py-0.5">
                            {label}
                          </span>
                        ))}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-4 py-2.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-[12.5px] text-muted transition-colors hover:text-text"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void create()}
            disabled={creating || picked.size === 0}
            className="rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {creating
              ? "Creating…"
              : `Create ${picked.size || ""} ${picked.size === 1 ? "task" : "tasks"}`.trim()}
          </button>
        </footer>
      </div>
    </div>
  );
}
