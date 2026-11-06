"use client";

import { loadAgentHistoryAction,loadAgentStepDetailAction } from "@/app/agent-actions";
import { ThreadSidebar } from "@/components/thread-sidebar";
import { ThreadMenu } from "@/components/thread-menu";
import { useStoredJson } from "@/lib/use-stored-json";
import { useDraft } from "@/lib/ui/draft-store";

import { createContext,useContext,useCallback,memo, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Dot,
  ExternalLink,
  FileText,
  Folder,
  GitBranch,
  Info,
  Link2,
  Loader2,
  Lock,
  MoreHorizontal,
  PanelLeft,
  Pencil,
  Pin,
  Paperclip,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { Menu, MenuItem } from "@/components/menu";
import { useUI } from "@/components/ui-context";
import { ThreadTaskChips } from "@/components/thread-task-chips";
import { Markdown } from "@/components/markdown";
import {
  AGENT_ATTACHMENT_MAX_COUNT,
  AGENT_DRAFT_PAGE,
  messageWithAttachments,
  splitAttachments,
  type AgentAttachment,
} from "@/lib/agent-attachments.shared";
import { uploadPageFile } from "@/lib/upload-client";
import { rememberHarness, streamAiEdit, type AgentApprovalCard, type AgentStepFrame } from "@/lib/ai-client";
import {
  createAgentSkillAction,
  deleteAgentSkillAction,
  deleteAgentThreadAction,
  forkAgentThreadFromMessageAction,
  renameAgentThreadAction,
  setAgentThreadApprovalAction,
  setAgentThreadEngineAction,
  setAgentThreadModelAction,
  setAgentThreadPinnedAction,
  setAgentThreadProjectAction,
  setAgentThreadUnreadAction,
  setAgentThreadVisibilityAction,
  startAgentThreadAction,
} from "@/app/agent-actions";
import {
  AGENT_APPROVALS,
  type AgentHarnessId,
  type AgentHarnessOption,
  type AgentSkill,
  type CodexModel,
} from "@/lib/ai-constants";
import type { AgentApproval, AgentThread, AgentThreadDetail } from "@/lib/agent-threads";
import { interpolate, useT } from "@/components/i18n-context";

type ProjectOption = { id: string; name: string; key: string; color: string };

type UiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  steps: AgentStepFrame[];
  // H-COLLAB-09: set when another member wrote this message in a shared chat.
  author?: string | null;
};

const availableEngines = (engines: AgentHarnessOption[]) => engines.filter((option) => option.available);


const WORK_SUGGESTIONS = [
  "Create tasks for the next milestone",
  "Update the overview with what shipped",
  "Comment a status update on the open tasks",
];

function toUi(thread: AgentThreadDetail | null): UiMessage[] {
  if (!thread) return [];
  return thread.messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    author: message.role === "user" && !message.fromViewer ? (message.authorName ?? null) : null,
    steps: message.steps.map((step) => ({
      key: step.id,
      kind: step.kind,
      title: step.title,
      detail: step.detail ?? undefined,
      detailAvailable:step.detailAvailable,
      status: step.status,
    })),
  }));
}

// Steps store JSON on purpose (commands carry cwd/exit code/output, tool calls carry
// arguments and results); the transcript shows the useful part first.
function stepDetail(step: AgentStepFrame): string {
  if (!step.detail) return "";
  try {
    const parsed = JSON.parse(step.detail) as { output?: unknown };
    if (typeof parsed.output === "string" && parsed.output.trim()) return parsed.output;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return step.detail;
  }
}

// Thinking keeps its own rows. Runs of tools and commands fold into one group, open while the
// turn is on its last run and shut once something follows; a group the user opens stays open.
function StepListContent({ steps, live }: { steps: AgentStepFrame[]; live: boolean }) {
  const t = useT();
  const runs: AgentStepFrame[][] = [];
  for (const step of steps) {
    const last = runs[runs.length - 1];
    if (step.kind !== "thinking" && last && last[0].kind !== "thinking") last.push(step);
    else runs.push([step]);
  }
  return (
    <div className="mb-2 space-y-0.5">
      {runs.map((run, index) => {
        if (run.length === 1) return <StepLine key={run[0].key} step={run[0]} />;
        const failed = run.filter((step) => step.status === "error" || step.status === "denied").length;
        const running = run.some((step) => step.status === "running");
        return (
          <StepGroup key={run[0].key} run={run} live={live && index===runs.length-1}>
            <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded px-1 py-0.5 text-small text-muted transition-colors hover:bg-elevated hover:text-text">
              <ChevronRight size={12} className="shrink-0 text-faint transition-transform group-open/run:rotate-90" />
              <span>{t("{count} steps", { count: String(run.length) })}</span>
              {running && <Loader2 size={11} className="shrink-0 animate-spin text-faint" />}
              {failed > 0 && (
                <span className="shrink-0 text-caption text-danger">
                  {t("{count} failed", { count: String(failed) })}
                </span>
              )}
            </summary>
          </StepGroup>
        );
      })}
    </div>
  );
}

const StepList=memo(StepListContent);
function StepGroup({run,live,children}:{run:AgentStepFrame[];live:boolean;children:ReactNode}){
 const [opened,setOpened]=useState<boolean|null>(null);const open=opened??live;
 return <details className="group/run" open={open} onToggle={event=>{if(event.currentTarget.open!==open)setOpened(event.currentTarget.open);}}>{children}{open&&<div className="ml-3 space-y-0.5">{run.map(step=><StepLine key={step.key} step={step}/>)}</div>}</details>;
}
const StepContext=createContext<{workspaceId:string;threadId:string}|null>(null);
function TurnStatus() {
  const t = useT();
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span className="text-faint" data-testid="turn-status">
      {seconds > 0 ? t("Thinking… {seconds}s", { seconds: String(seconds) }) : t("Thinking…")}
    </span>
  );
}

function translateTurnError(error: string, t: (key: string) => string): string {
  const using = error.match(/^(.+) is using this shared chat$/);
  if (using) return t("{name} is using this shared chat").replace("{name}", using[1]!);
  const hinted = error.split(" — ");
  if (hinted.length > 1) {
    const head = translateTurnError(hinted[0]!, t);
    return `${head} — ${t(hinted.slice(1).join(" — "))}`;
  }
  return t(error);
}

// Harness errors end with their log path. Splitting it off lets the sentence itself be translated.
function TurnError({ error }: { error: string }) {
  const t = useT();
  const [message, log] = error.split(" Log: ");
  return (
    <div className="mb-2 px-1 text-small" data-testid="turn-error">
      <p className="text-danger">{translateTurnError(message, t)}</p>
      {log && <p className="mt-0.5 break-all text-caption text-faint">{t("Log: {path}", { path: log })}</p>}
    </div>
  );
}

function StepLineContent({ step:source }: { step: AgentStepFrame }) {
  const context=useContext(StepContext);
  const [loaded,setLoaded]=useState<string|null|undefined>(undefined),[loadError,setLoadError]=useState<string|null>(null);
  const step=loaded===undefined?source:{...source,detail:loaded??undefined};
  const load=()=>{if(!source.detail&&source.detailAvailable&&loaded===undefined&&context)void loadAgentStepDetailAction(context.workspaceId,context.threadId,source.key).then(result=>{if(result.ok){setLoaded(result.data);setLoadError(null);}else setLoadError(result.error);});};
  const t = useT();
  const [expanded,setExpanded]=useState(false);
  if (step.kind === "thinking") {
    return (
      <details className="group/step" data-testid="thinking-step" onToggle={event=>{setExpanded(event.currentTarget.open);if(event.currentTarget.open)load();}}>
        <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded px-1 py-0.5 text-small text-muted transition-colors hover:bg-elevated hover:text-text">
          <Sparkles size={12} className="shrink-0 text-faint" />
          <span className="shrink-0">{t("Thinking")}</span>
          <span className="min-w-0 truncate text-faint">{step.title}</span>
        </summary>
        {expanded&&<div className="mb-1 ml-5 mt-1 border-l border-border pl-3 text-small text-muted">
          <Markdown source={step.detail ?? step.title} />
        </div>}
      </details>
    );
  }
  const Icon =
    step.kind === "command" ? Terminal : step.kind === "file" ? FileText : step.kind === "tool" ? Wrench : Info;
  const detail = expanded?(loadError??stepDetail(step)):"";
  const failed = step.status === "error" || step.status === "denied";
  return (
    <details className="group/step" onToggle={event=>{setExpanded(event.currentTarget.open);if(event.currentTarget.open)load();}}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded px-1 py-0.5 text-small text-muted transition-colors hover:bg-elevated [&::-webkit-details-marker]:hidden">
        <Icon size={12} className="shrink-0 text-faint" />
        <span className="min-w-0 truncate font-mono text-small">{step.title}</span>
        {step.status === "running" ? (
          <Loader2 size={11} className="shrink-0 animate-spin text-faint" />
        ) : failed ? (
          <span className="shrink-0 text-caption text-danger">
            {t(step.status === "denied" ? "denied" : "failed")}
          </span>
        ) : (
          <Check size={11} className="shrink-0 text-faint" />
        )}
      </summary>
      {detail && (
        <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-surface p-2 font-mono text-caption leading-relaxed text-muted">
          {detail}
        </pre>
      )}
    </details>
  );
}

const StepLine=memo(StepLineContent);

function ApprovalPanel({
  card,
  busy,
  onAnswer,
}: {
  card: AgentApprovalCard;
  busy: boolean;
  onAnswer: (requestId: string, decision: "accept" | "decline" | "accept-turn") => void;
}) {
  const t = useT();
  return (
    <div className="rounded-xl border border-border-strong bg-surface p-3">
      <div className="flex items-center gap-2 text-small font-medium">
        <Lock size={13} />
        {t("Permission needed")}
        <span className="ml-auto rounded-full border border-border bg-bg px-2 py-0.5 font-mono text-caption text-muted">
          {card.tool}
        </span>
      </div>
      <p className="mt-1.5 break-words [overflow-wrap:anywhere] text-small leading-relaxed text-muted">{card.message}</p>
      {card.description && <p className="mt-1 break-words [overflow-wrap:anywhere] text-small leading-relaxed text-faint">{card.description}</p>}
      {card.params && (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-md border border-border bg-bg p-2 font-mono text-caption leading-relaxed text-muted">
          {card.params}
        </pre>
      )}
      <div className="mt-2.5 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => onAnswer(card.requestId, "decline")}
          disabled={busy}
          className="rounded-md border border-border px-2.5 py-1 text-small text-muted transition-colors hover:border-border-strong hover:text-text disabled:opacity-50"
        >
          {t("Deny")}
        </button>
        <button
          type="button"
          onClick={() => onAnswer(card.requestId, "accept-turn")}
          disabled={busy}
          title={t("Stop asking for the rest of this turn")}
          className="rounded-md border border-border px-2.5 py-1 text-small text-muted transition-colors hover:border-border-strong hover:text-text disabled:opacity-50"
        >
          {t("Allow for this turn")}
        </button>
        <button
          type="button"
          onClick={() => onAnswer(card.requestId, "accept")}
          disabled={busy}
          className="rounded-md bg-accent px-2.5 py-1 text-small font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {t("Allow once")}
        </button>
      </div>
    </div>
  );
}

// Composer chips shared by the empty state and an open conversation.
function ProjectChip({
  projects,
  value,
  onChange,
  disabled,
}: {
  projects: ProjectOption[];
  value: string;
  onChange: (projectId: string) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const { setProjectComposerOpen } = useUI();
  const current = projects.find((project) => project.id === value);
  return (
    <Menu
      width={240}
      align="left"
      triggerClassName="flex items-center gap-1.5 rounded-full px-2 py-1 text-small text-text transition-colors hover:bg-elevated disabled:opacity-50"
      trigger={
        <>
          <Folder size={13} className="shrink-0" />
          <span className="max-w-[150px] truncate">{current?.name ?? t("Don't work in a project")}</span>
          {!disabled && <ChevronDown size={11} className="shrink-0 text-muted" />}
        </>
      }
    >
      {(close) => (
        <>
          {projects.length === 0 && <p className="px-2 py-2 text-small text-faint">{t("No projects yet.")}</p>}
          {projects.map((project) => (
            <MenuItem
              key={project.id}
              active={project.id === value}
              onSelect={() => {
                close();
                onChange(project.id);
              }}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: project.color }} />
              <span className="min-w-0 flex-1 truncate text-left">{project.name}</span>
            </MenuItem>
          ))}
          <div className="my-1 border-t border-border" />
          <MenuItem
            active={!value}
            onSelect={() => {
              close();
              onChange("");
            }}
          >
            <span className="min-w-0 flex-1 truncate text-left">{t("Don't work in a project")}</span>
          </MenuItem>
          <MenuItem
            onSelect={() => {
              close();
              // Pick the project that comes back into this draft instead of navigating away.
              setProjectComposerOpen(true, (project) => onChange(project.id));
            }}
          >
            <Plus size={13} /> {t("New project")}
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-2 pb-1 pt-2 text-caption font-semibold uppercase tracking-[0.06em] text-faint">
      {children}
    </p>
  );
}

// "GPT-6.1-Sol" reads as "GPT-6.1 Sol" in the chip, the way Codex writes it.
const prettyModel = (label: string) => label.replace(/-(?=[A-Za-z])/g, " ");

type ModelsByEngine = Partial<Record<AgentHarnessId, CodexModel[]>>;

// A model id only means something to the harness that listed it. A saved id that is not on
// this harness's list (another harness's, or one since removed) gives way to its default.
function modelPrefFor(
  models: CodexModel[],
  fallback: { model: string; effort: string },
  model: string,
  effort: string
): { model: string; effort: string } {
  const picked = models.find((entry) => entry.slug === model);
  if (!picked) return fallback;
  return { model, effort: picked.efforts.some((level) => level.id === effort) ? effort : picked.defaultEffort };
}

// Codex picks reasoning with a dot slider instead of a list; dragging snaps to a level.
function EffortSlider({
  levels,
  value,
  onChange,
}: {
  levels: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  const t = useT();
  const rail = useRef<HTMLDivElement>(null);
  const index = Math.max(0, levels.findIndex((level) => level.id === value));
  const ratio = levels.length > 1 ? index / (levels.length - 1) : 0;
  const pickAt = (clientX: number) => {
    const el = rail.current;
    if (!el || levels.length < 2) return;
    const rect = el.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const next = levels[Math.round(t * (levels.length - 1))];
    if (next && next.id !== value) onChange(next.id);
  };
  const step = (delta: number) => {
    const next = levels[Math.min(levels.length - 1, Math.max(0, index + delta))];
    if (next && next.id !== value) onChange(next.id);
  };
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={t("Reasoning effort")}
      aria-valuemin={1}
      aria-valuemax={levels.length}
      aria-valuenow={index + 1}
      aria-valuetext={levels[index]?.label}
      className="relative mx-2 mb-2 mt-2 h-7 cursor-pointer touch-none select-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        pickAt(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) pickAt(e.clientX);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
          e.preventDefault();
          step(-1);
        } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
          e.preventDefault();
          step(1);
        }
      }}
    >
      <div ref={rail} className="absolute inset-x-2.5 top-1/2 h-6 -translate-y-1/2">
        <div className="absolute inset-0 rounded-full bg-elevated" />
        <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${ratio * 100}%` }} />
        {levels.map((level, i) => (
          <span
            key={level.id}
            className={`absolute top-1/2 h-[3px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full ${
              i <= index ? "bg-white/90" : "bg-faint"
            }`}
            style={{ left: `${(levels.length > 1 ? i / (levels.length - 1) : 0) * 100}%` }}
          />
        ))}
        <span
          className="absolute top-1/2 h-[22px] w-[22px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)]"
          style={{ left: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}

// H-FIX-31: harness picker. Only enabled and ready harnesses reach `options`.
function HarnessChip({
  options,
  value,
  onChange,
  disabled,
}: {
  options: AgentHarnessOption[];
  value: AgentHarnessId;
  onChange: (engine: AgentHarnessId) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const current = options.find((option) => option.id === value) ?? options[0];
  if (options.length === 0) return null;
  return (
    <Menu
      className="shrink-0"
      width={300}
      align="right"
      triggerClassName={`flex items-center gap-1 rounded-full px-2 py-1 text-small text-text transition-colors hover:bg-elevated ${
        disabled ? "pointer-events-none opacity-50" : ""
      }`}
      trigger={
        <span data-testid="composer-harness" className="flex items-center gap-1">
          <span className="max-w-[160px] truncate">{current?.label}</span>
          <ChevronDown size={11} className="shrink-0 text-muted" />
        </span>
      }
    >
      {(close) => (
        <>
          <SectionLabel>{t("Harness")}</SectionLabel>
          {options.map((option) => (
            <MenuItem
              key={option.id}
              active={option.id === value}
              onSelect={() => {
                close();
                onChange(option.id);
              }}
            >
              <span className="min-w-0 flex-1 truncate text-left">{option.label}</span>
            </MenuItem>
          ))}
        </>
      )}
    </Menu>
  );
}

// Long lists (OpenCode with a few providers) get a filter; short ones don't need it.
const MODEL_SEARCH_MIN = 8;

// Model and effort for the current harness. Each harness offers its own list; a harness
// whose list could not be read runs on its own setting.
function ModelChip({
  engine,
  models,
  model,
  effort,
  onModel,
  disabled,
}: {
  engine: AgentHarnessId;
  models: CodexModel[];
  model: string;
  effort: string;
  onModel: (model: string, effort: string) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const picked = models.find((entry) => entry.slug === model) ?? models[0];
  if (!picked) {
    return (
      <span
        data-testid="composer-model"
        title={t("Could not read this harness's model list. It runs on its own setting.")}
        className="flex items-center rounded-full px-2 py-1 text-small text-muted"
      >
        {t("Default model")}
      </span>
    );
  }
  const modelName = (entry: CodexModel) =>
    // A slash marks a person's own API, whose model names are theirs to spell.
    !entry.slug ? t(entry.label) : engine === "codex" && !entry.slug.includes("/") ? prettyModel(entry.label) : entry.label;
  const efforts = picked.efforts.map((level) => ({ ...level, label: t(level.label) }));
  const effortLabel = efforts.find((level) => level.id === effort)?.label ?? effort;
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? models.filter((entry) => `${entry.label} ${entry.slug}`.toLowerCase().includes(needle))
    : models;
  return (
    <Menu
      width={330}
      align="right"
      className="min-w-0"
      triggerClassName={`flex max-w-full items-center gap-1 rounded-full px-2 py-1 text-small text-text transition-colors hover:bg-elevated ${
        disabled ? "pointer-events-none opacity-50" : ""
      }`}
      trigger={
        <span data-testid="composer-model" className="flex min-w-0 items-center gap-1">
          <span className="max-w-[220px] truncate">
            {modelName(picked)}
            {effort && effortLabel && <span className="text-muted"> {effortLabel}</span>}
          </span>
          <ChevronDown size={11} className="shrink-0 text-muted" />
        </span>
      }
    >
      {() => (
        <>
          {models.length > MODEL_SEARCH_MIN && (
            <div className="sticky -top-1 z-10 -mx-1 -mt-1 bg-overlay px-2 pb-1 pt-2">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("Search models")}
                className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-small outline-none placeholder:text-faint focus:border-border-strong"
              />
            </div>
          )}
          <SectionLabel>{t("Model")}</SectionLabel>
          {shown.length === 0 && <p className="px-2 py-2 text-small text-faint">{t("No matching models.")}</p>}
          {shown.map((entry) => (
            <MenuItem
              key={entry.slug}
              active={entry.slug === picked.slug}
              // Keep the menu open: picking a model usually leads straight to an effort.
              onSelect={() => onModel(entry.slug, entry.efforts.some((level) => level.id === effort) ? effort : entry.defaultEffort)}
            >
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate">{modelName(entry)}</span>
                {entry.description && (
                  <span className="block truncate text-caption text-faint">
                    {entry.slug ? entry.description : t(entry.description)}
                  </span>
                )}
              </span>
            </MenuItem>
          ))}
          {efforts.length > 1 && (
            <>
              <div className="my-1 border-t border-border" />
              {/* Pinned so effort stays reachable while the model list scrolls. */}
              <div className="sticky -bottom-1 -mx-1 -mb-1 border-t border-border bg-overlay px-1 pb-1">
                <div className="px-2 pt-2 text-center">
                  <p className="text-lead font-semibold leading-5 text-text">{effortLabel || t("Default")}</p>
                  <p className="mt-0.5 text-small text-muted">{modelName(picked)}</p>
                </div>
                <EffortSlider
                  levels={efforts}
                  value={effort}
                  onChange={(id) => onModel(picked.slug, id)}
                />
                <div className="flex justify-between px-3.5 pb-0.5 text-caption text-faint">
                  <span>{efforts[0]?.label}</span>
                  <span>{efforts[efforts.length - 1]?.label}</span>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </Menu>
  );
}

// Codex's own three postures. Only Work turns write, so only they show this chip.
function ApprovalChip({
  value,
  onChange,
  disabled,
}: {
  value: AgentApproval;
  onChange: (value: AgentApproval) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const current = AGENT_APPROVALS.find((entry) => entry.id === value) ?? AGENT_APPROVALS[0];
  return (
    <Menu
      className="shrink-0"
      width={300}
      align="right"
      triggerClassName={`flex items-center gap-1 rounded-full px-2 py-1 text-small transition-colors hover:bg-elevated ${
        value === "full" ? "text-danger" : "text-text"
      } ${disabled ? "pointer-events-none opacity-50" : ""}`}
      trigger={
        <>
          <span className="max-w-[150px] truncate">{t(current.label)}</span>
          <ChevronDown size={11} className="shrink-0 text-muted" />
        </>
      }
    >
      {(close) => (
        <>
          {AGENT_APPROVALS.map((entry) => (
            <MenuItem
              key={entry.id}
              active={entry.id === value}
              onSelect={() => {
                close();
                onChange(entry.id);
              }}
            >
              <span className="min-w-0 flex-1 text-left">
                <span className="block">{t(entry.label)}</span>
                <span className="block whitespace-normal break-words text-caption text-faint">{t(entry.detail)}</span>
              </span>
            </MenuItem>
          ))}
        </>
      )}
    </Menu>
  );
}

function VisibilityChip({
  value,
  onChange,
}: {
  value: "private" | "shared";
  onChange: (value: "private" | "shared") => void;
}) {
  const t = useT();
  const Icon = value === "shared" ? Users : Lock;
  return (
    <button
      type="button"
      onClick={() => onChange(value === "shared" ? "private" : "shared")}
      title={t(value === "shared" ? "Anyone in this workspace can open it" : "Only you can open it")}
      className="flex items-center gap-1.5 rounded-full px-2 py-1 text-small text-text transition-colors hover:bg-elevated"
    >
      <Icon size={12} /> {t(value === "shared" ? "Shared" : "Private")}
    </button>
  );
}

// Skills are mentioned by their short name: "documents" stands for "documents:documents"
// (marketplace skills carry the plugin prefix; the turn resolver accepts either).
function skillToken(skill: AgentSkill): string {
  return skill.name.split(":").pop() || skill.name;
}

function matchSkills(skills: AgentSkill[], query: string) {
  const needle = query.trim().toLowerCase();
  const seen = new Set<string>();
  const named: { skill: AgentSkill; token: string }[] = [];
  const described: { skill: AgentSkill; token: string }[] = [];
  for (const skill of skills) {
    const token = skillToken(skill);
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    if (!needle || key.includes(needle)) {
      named.push({ skill, token });
      seen.add(key);
    } else if (skill.description.toLowerCase().includes(needle)) {
      described.push({ skill, token });
      seen.add(key);
    }
  }
  return [...named, ...described];
}

// The two skill mutations the composer's dialog can run; both are server actions that
// report failures instead of throwing.
type SkillDraft = { name: string; description: string; instructions: string };
type SkillCreateResult = { ok: true; data: AgentSkill } | { ok: false; error: string };
type SkillDeleteResult = { ok: true } | { ok: false; error: string };

function SkillManager({
  skills,
  canManage,
  onCreate,
  onDelete,
  onCreated,
  onClose,
}: {
  skills: AgentSkill[];
  canManage: boolean;
  onCreate: (input: SkillDraft) => Promise<SkillCreateResult>;
  onDelete: (skill: AgentSkill) => Promise<SkillDeleteResult>;
  onCreated: (skill: AgentSkill) => void;
  onClose: () => void;
}) {
  const t = useT();
  const {confirm}=useUI();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    const slug = name.trim().toLowerCase();
    if (!slug || !description.trim() || busy) return;
    setBusy(true);
    setError(null);
    const result = await onCreate({ name: slug, description: description.trim(), instructions });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onCreated(result.data);
  }

  async function remove(skill: AgentSkill) {
    if (
      !await confirm(
        t(
          'Delete the skill "{name}"? Its folder is removed from this machine, so every workspace using it loses it.',
          { name: skillToken(skill) }
        )
      )
    )
      return;
    setRemoving(skill.path);
    setError(null);
    const result = await onDelete(skill);
    setRemoving(null);
    if (!result.ok) setError(result.error);
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose} />
      <div className="fixed inset-x-0 top-[12vh] z-[60] mx-auto flex max-h-[72vh] w-[600px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-border bg-overlay shadow-2xl shadow-black/15">
        <div className="flex items-center justify-between border-b border-border px-4 py-2 text-small text-faint">
          <span>
            {interpolate(t("{skills} on this machine"), { skills: <span className="text-muted">{t("Skills")}</span> })}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("Close")}
            className="rounded p-1 transition-colors hover:bg-elevated hover:text-text"
          >
            <X size={13} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {skills.length === 0 ? (
            <div className="px-2 py-3 text-small text-faint">{t("No skills found on this machine.")}</div>
          ) : (
            skills.map((skill) => (
              <div
                key={skill.path}
                className="flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-elevated"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-text">@{skillToken(skill)}</span>
                  <span className="mt-0.5 block truncate text-small text-muted" title={skill.description}>
                    {skill.description}
                  </span>
                </span>
                <span className="mt-1 shrink-0 rounded-full border border-border px-1.5 text-caption leading-4 text-faint">
                  {skill.name.includes(":") ? "plugin" : skill.scope}
                </span>
                {/* Only plain folders TaCos owns can be removed; plugins and .system stay. */}
                {canManage && skill.managed && (
                  <button
                    type="button"
                    onClick={() => void remove(skill)}
                    disabled={removing !== null}
                    title={t("Delete this skill from this machine")}
                    aria-label={t("Delete {name}", { name: skillToken(skill) })}
                    className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-faint transition-colors hover:bg-elevated hover:text-danger disabled:opacity-40"
                  >
                    {removing === skill.path ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Trash2 size={12} />
                    )}
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        {canManage ? (
          <div className="border-t border-border px-4 py-3">
            <div className="text-caption uppercase tracking-wide text-faint">{t("New skill")}</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("Name, e.g. release-notes")}
                className="min-w-0 rounded-md border border-border bg-surface px-2 py-1.5 text-body outline-none placeholder:text-faint focus:border-border-strong"
              />
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t("What it does, when to use it")}
                className="min-w-0 rounded-md border border-border bg-surface px-2 py-1.5 text-body outline-none placeholder:text-faint focus:border-border-strong"
              />
            </div>
            <textarea
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              rows={4}
              placeholder={t("Instructions the agent follows when this skill is attached (Markdown)")}
              className="mt-2 w-full resize-none rounded-md border border-border bg-surface px-2 py-1.5 text-body leading-relaxed outline-none placeholder:text-faint focus:border-border-strong"
            />
            <div className="mt-2 flex items-center gap-2">
              {error ? (
                <span className="mr-auto min-w-0 text-small text-danger">{t(error)}</span>
              ) : (
                <span className="mr-auto min-w-0 truncate text-caption text-faint">
                  {t("Saved to ~/.codex/skills/<name>/SKILL.md")}
                </span>
              )}
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!name.trim() || !description.trim() || busy}
                className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-body font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
              >
                {t(busy ? "Adding…" : "Add skill")}
              </button>
            </div>
          </div>
        ) : (
          <div className="border-t border-border px-4 py-3 text-small text-faint">
            {t("Only workspace admins can add or remove skills on this machine.")}
          </div>
        )}
      </div>
    </>
  );
}

function UserMessageBody({ content, bubbleClass }: { content: string; bubbleClass: string }) {
  const { text, files } = splitAttachments(content);
  return (
    <>
      {text && <div className={bubbleClass}>{text}</div>}
      {files.length > 0 && (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5" data-testid="message-files">
          {files.map((file) =>
            file.image ? (
              <a key={file.id} href={`/api/files/${file.id}`} target="_blank" rel="noreferrer" title={file.name}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/files/${file.id}`} alt={file.name} className="max-h-40 rounded-lg border border-border object-contain" />
              </a>
            ) : (
              <a
                key={file.id}
                href={`/api/files/${file.id}`}
                className="flex max-w-[220px] items-center gap-1 rounded-full border border-border bg-elevated px-2 py-0.5 text-small text-muted hover:text-text"
              >
                <FileText size={14} className="shrink-0 text-faint" />
                <span className="truncate">{file.name}</span>
              </a>
            )
          )}
        </div>
      )}
    </>
  );
}

const SHARED_TURN_POLL_MS = 4000;

type ComposerAttachment = { key: string; name: string; image: boolean; previewUrl?: string; id?: string };

function Composer({
  workspaceId,
  value,
  onChange,
  onSubmit,
  busy,
  onStop,
  placeholder,
  submitDisabled,
  inputRef,
  actions,
  onNew,
  skills,
  canManageSkills,
  onCreateSkill,
  onDeleteSkill,
}: {
  workspaceId: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (text: string, attachments: AgentAttachment[]) => void | boolean | Promise<void | boolean>;
  busy?: boolean;
  onStop?: () => void;
  placeholder: string;
  submitDisabled?: boolean;
  inputRef?: { current: HTMLTextAreaElement | null };
  // Right-aligned chips (model, approval) sit next to Send, as in Codex.
  actions?: ReactNode;
  onNew?: () => void;
  // Skills this machine's Codex can load; typing "@" lists them.
  skills?: AgentSkill[];
  // Workspace admins may add and delete the skill folders Codex reads on this machine.
  canManageSkills?: boolean;
  onCreateSkill?: (input: SkillDraft) => Promise<SkillCreateResult>;
  onDeleteSkill?: (skill: AgentSkill) => Promise<SkillDeleteResult>;
}) {
  const t = useT();
  const {confirm}=useUI();
  const box = useRef<HTMLTextAreaElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  // The "+" menu steals focus on click, so remember where the caret was when the
  // textarea last had it.
  const caret = useRef(0);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const [manageSkills, setManageSkills] = useState(false);
  const [active, setActive] = useState(0);
  const matches = mention ? matchSkills(skills ?? [], mention.query) : [];
  // Plugin skills can shadow a plain skill of the same name; one row per token.
  const visibleSkills = (() => {
    const seen = new Set<string>();
    return (skills ?? []).filter((skill) => {
      const key = skillToken(skill).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })();
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);
  useEffect(() => {
    if (!mention) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      // A press on the list itself must not close it: the pick runs on click, and a
      // mousedown that already cleared `mention` left the row with nothing to insert.
      if (box.current?.contains(target) || panel.current?.contains(target)) return;
      setMention(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [mention]);

  function syncMention(next: string, caret: number) {
    const found = /(?:^|\s)@([A-Za-z0-9_.:-]{0,40})$/.exec(next.slice(0, caret));
    if (!found || (skills ?? []).length === 0) return setMention(null);
    const query = found[1];
    // Nothing to offer means nothing to show: keep the "@" as plain text.
    if (query && matchSkills(skills ?? [], query).length === 0) return setMention(null);
    setMention({ start: caret - query.length - 1, query });
    setActive(0);
  }

  function writeToken(start: number, end: number, token: string) {
    const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
    onChange(next);
    setMention(null);
    const pos = start + token.length;
    caret.current = pos;
    requestAnimationFrame(() => {
      const el = box.current;
      el?.focus();
      el?.setSelectionRange(pos, pos);
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  function insertSkill(skill: AgentSkill) {
    if (!mention) return;
    const caret = box.current?.selectionStart ?? value.length;
    writeToken(mention.start, caret, `@${skillToken(skill)} `);
  }

  // The "+" menu inserts at the caret instead of replacing an "@" the user typed.
  function insertSkillFromMenu(skill: AgentSkill) {
    const at = caret.current;
    const needsSpace = at > 0 && !/\s/.test(value[at - 1]);
    writeToken(at, at, `${needsSpace ? " " : ""}@${skillToken(skill)} `);
  }

  // Previews stay valid while their chips are up, so they are revoked only on the way out.
  const previews = useRef(new Set<string>());
  useEffect(
    () => () => {
      for (const url of previews.current) URL.revokeObjectURL(url);
    },
    []
  );

  function forgetPreview(item: ComposerAttachment) {
    if (!item.previewUrl) return;
    URL.revokeObjectURL(item.previewUrl);
    previews.current.delete(item.previewUrl);
  }

  function addFiles(files: FileList | File[] | null | undefined) {
    if (!files?.length || busy) return;
    setAttachError(null);
    const room = AGENT_ATTACHMENT_MAX_COUNT - attachments.length;
    const list = Array.from(files);
    if (list.length > room) setAttachError(t("At most {n} files per message", { n: AGENT_ATTACHMENT_MAX_COUNT }));
    for (const file of list.slice(0, Math.max(room, 0))) {
      const image = file.type.startsWith("image/");
      const item: ComposerAttachment = {
        key: crypto.randomUUID(),
        name: file.name,
        image,
        previewUrl: image ? URL.createObjectURL(file) : undefined,
      };
      if (item.previewUrl) previews.current.add(item.previewUrl);
      setAttachments((prev) => [...prev, item]);
      uploadPageFile(workspaceId, AGENT_DRAFT_PAGE, file).then(
        ({ id }) => setAttachments((prev) => prev.map((entry) => (entry.key === item.key ? { ...entry, id } : entry))),
        (err: unknown) => {
          forgetPreview(item);
          setAttachments((prev) => prev.filter((entry) => entry.key !== item.key));
          setAttachError(`${file.name}: ${t(err instanceof Error ? err.message : "Upload failed")}`);
        }
      );
    }
  }

  function removeAttachment(item: ComposerAttachment) {
    forgetPreview(item);
    setAttachments((prev) => prev.filter((entry) => entry.key !== item.key));
  }

  const uploading = attachments.some((item) => !item.id);

  async function submitComposer() {
    if (busy || uploading || submitDisabled) return;
    const text = value.trim();
    if (!text && attachments.length === 0) return;
    const accepted = await onSubmit(
      text,
      attachments.map(({ id, name, image }) => ({ id: id!, name, image }))
    );
    if (accepted === false) return;
    attachments.forEach(forgetPreview);
    setAttachments([]);
    setAttachError(null);
  }

  const canSend = Boolean(value.trim() || attachments.length) && !uploading;

  return (
    <div
      className="relative rounded-[22px] border border-border bg-surface p-2 shadow-[0_1px_3px_rgba(0,0,0,0.05)] transition-colors focus-within:border-border-strong"
      onDragOver={(event) => {
        if (busy) return;
        event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        addFiles(event.dataTransfer.files);
      }}
    >
      {mention && matches.length > 0 && (
        <div
          ref={panel}
          className="absolute inset-x-0 bottom-full z-50 mb-2 overflow-hidden rounded-xl border border-border bg-overlay shadow-xl shadow-black/10"
        >
          <div className="flex items-center justify-between px-3 pb-1 pt-2 text-caption text-faint">
            <span className="font-medium uppercase tracking-wide">{t("Skills")}</span>
            <span>↑↓ Enter</span>
          </div>
          <div className="max-h-[264px] overflow-y-auto p-1">
            {matches.map(({ skill, token }, index) => (
              <button
                key={skill.path}
                type="button"
                // Pick on mouse-down: any listener that closes the list on a press outside
                // the textarea runs later in the bubble, so it can no longer cancel the pick.
                // preventDefault keeps focus in the textarea so typing can continue.
                onMouseDown={(event) => {
                  event.preventDefault();
                  insertSkill(skill);
                }}
                onClick={() => insertSkill(skill)}
                onMouseEnter={() => setActive(index)}
                className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                  index === active ? "bg-elevated" : ""
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-text">@{token}</span>
                  <span className="mt-0.5 block truncate text-small text-muted" title={skill.description}>
                    {skill.description}
                  </span>
                </span>
                <span className="mt-1 shrink-0 rounded-full border border-border px-1.5 text-caption leading-4 text-faint">
                  {skill.name.includes(":") ? "plugin" : skill.scope}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      {attachments.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1.5 px-1.5 pt-1">
          {attachments.map((item) => (
            <span
              key={item.key}
              className={`flex max-w-full items-center gap-1 rounded-full border border-border bg-elevated py-0.5 pl-1 pr-1.5 text-small text-muted ${item.id ? "" : "opacity-60"}`}
            >
              {item.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.previewUrl} alt="" className="h-6 w-6 shrink-0 rounded object-cover" />
              ) : (
                <FileText size={14} className="shrink-0 text-faint" />
              )}
              <span className="max-w-[160px] truncate" title={item.id ? item.name : t("Uploading…")}>
                {item.name}
              </span>
              <button
                type="button"
                onClick={() => removeAttachment(item)}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-surface hover:text-text"
                aria-label={t("Remove attachment")}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      {attachError && <p className="px-2 pb-1 text-small text-danger">{attachError}</p>}
      <input
        ref={fileInput}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          addFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <textarea
        ref={(el) => {
          box.current = el;
          if (inputRef) inputRef.current = el;
        }}
        value={value}
        rows={1}
        placeholder={placeholder}
        onPaste={(event) => {
          const files = event.clipboardData?.files;
          if (files?.length) {
            event.preventDefault();
            addFiles(files);
          }
        }}
        onChange={(event) => {
          onChange(event.target.value);
          caret.current = event.target.selectionStart ?? event.target.value.length;
          syncMention(event.target.value, event.target.selectionStart ?? event.target.value.length);
        }}
        onSelect={(event) => {
          caret.current = event.currentTarget.selectionStart ?? 0;
        }}
        onKeyDown={(event) => {
          if (mention && matches.length > 0) {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((index) => (index + 1) % matches.length);
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => (index - 1 + matches.length) % matches.length);
              return;
            }
            if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing)) {
              event.preventDefault();
              insertSkill(matches[active].skill);
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setMention(null);
              return;
            }
          }
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (!busy) submitComposer();
          }
        }}
        className="max-h-[220px] min-h-[30px] w-full resize-none bg-transparent px-2.5 pt-2 text-body leading-relaxed outline-none placeholder:text-faint"
      />
      {/* One row, the model name truncating first. Only a card too narrow for that wraps, so
          the send button never leaves it. z-10 keeps open menus above the row under the card. */}
      <div className="@container relative z-10 mt-1 px-0.5 pb-0.5">
        <div className="flex flex-wrap items-center gap-x-0.5 gap-y-1 @[340px]:flex-nowrap">
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-elevated hover:text-text disabled:opacity-40"
            aria-label={t("Attach files")}
            title={t("Attach files")}
          >
            <Paperclip size={15} />
          </button>
          {onNew && (
            <Menu
              width={260}
              align="left"
              triggerClassName="flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-elevated hover:text-text"
              trigger={<Plus size={15} />}
            >
              {(close) => (
                <>
                  <MenuItem
                    onSelect={() => {
                      close();
                      fileInput.current?.click();
                    }}
                  >
                    <Paperclip size={13} /> {t("Attach files…")}
                  </MenuItem>
                  <div className="my-1 border-t border-border" />
                  {/* Machine-level skill folders: keep the entry above the list, which is long
                      enough to scroll on a short window. */}
                  {onCreateSkill && onDeleteSkill && (
                    <>
                      <MenuItem
                        onSelect={() => {
                          close();
                          setManageSkills(true);
                        }}
                      >
                        <Wrench size={13} /> {t("Manage skills…")}
                      </MenuItem>
                      <div className="my-1 border-t border-border" />
                    </>
                  )}
                  {/* The same skills "@" offers, without having to remember a name. */}
                  {visibleSkills.length > 0 ? (
                    <>
                      <div className="px-2 pb-1 pt-1 text-caption uppercase tracking-wide text-faint">
                        {t("Skills")}
                      </div>
                      {visibleSkills.map((skill) => (
                        <MenuItem
                          key={skill.path}
                          onSelect={() => {
                            insertSkillFromMenu(skill);
                            close();
                          }}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">@{skillToken(skill)}</span>
                            <span
                              className="block truncate text-caption text-faint"
                              title={skill.description}
                            >
                              {skill.description}
                            </span>
                          </span>
                        </MenuItem>
                      ))}
                    </>
                  ) : (
                    <div className="px-2 py-1.5 text-small text-faint">
                      {t("No skills found on this machine.")}
                    </div>
                  )}
                  <div className="my-1 border-t border-border" />
                  <MenuItem
                    onSelect={() => {
                      close();
                      onNew();
                    }}
                  >
                    <Plus size={13} /> {t("New conversation")}
                  </MenuItem>
                </>
              )}
            </Menu>
          )}
          <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-0.5 whitespace-nowrap @[340px]:flex-nowrap">
            {actions}
            <button
              type="button"
              onClick={() => (busy && onStop ? onStop() : submitComposer())}
              disabled={!busy && (!canSend || submitDisabled)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0d0d0d] text-white transition-opacity hover:opacity-80 disabled:bg-elevated disabled:text-faint disabled:opacity-100"
              aria-label={t(busy ? "Stop" : "Send")}
              title={t(busy ? "Stop" : "Send")}
            >
              {busy ? <Square size={11} fill="currentColor" /> : <ArrowUp size={15} />}
            </button>
          </div>
        </div>
      </div>
      {manageSkills && onCreateSkill && onDeleteSkill && (
        <SkillManager
          skills={visibleSkills}
          canManage={Boolean(canManageSkills)}
          onCreate={onCreateSkill}
          onDelete={onDeleteSkill}
          onCreated={(skill) => {
            setManageSkills(false);
            insertSkillFromMenu(skill);
          }}
          onClose={() => setManageSkills(false)}
        />
      )}
    </div>
  );
}

// Where this conversation lives, not how a turn runs, so it sits under the card.
function ComposerContext({ children }: { children: ReactNode }) {
  return <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1 px-1">{children}</div>;
}

function ThreadRenameInput({
  threadId,
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  threadId: string;
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  // Focus after the menu that opened this editor is gone: autoFocus would fire first and
  // the removed menu button would then drop focus to the body, committing instantly.
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      data-thread-rename={threadId}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={(event) => {
        // A conversation is listed twice (its project group and Recents), so both copies
        // render this editor. Focus passing between them must not end the edit.
        const next = event.relatedTarget as HTMLElement | null;
        if (next?.getAttribute("data-thread-rename") === threadId) return;
        onCommit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onCommit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
      className="h-[24px] w-full min-w-0 rounded border border-border-strong bg-bg px-1.5 text-body outline-none"
    />
  );
}

function StartComposer({
  projects,
  options,
  models,
  skills,
  canManageSkills,
  onCreateSkill,
  onDeleteSkill,
  projectId,
  visibility,
  engine,
  model,
  effort,
  approval,
  busy,
  error,
  codexReady,
  onProject,
  onVisibility,
  onEngine,
  onModel,
  onApproval,
  onStart,
  workspaceId,
}: {
  workspaceId: string;
  projects: ProjectOption[];
  options: AgentHarnessOption[];
  models: CodexModel[];
  skills: AgentSkill[];
  canManageSkills: boolean;
  onCreateSkill: (input: SkillDraft) => Promise<SkillCreateResult>;
  onDeleteSkill: (skill: AgentSkill) => Promise<SkillDeleteResult>;
  projectId: string;
  visibility: "private" | "shared";
  engine: AgentHarnessId;
  model: string;
  effort: string;
  approval: AgentApproval;
  busy: boolean;
  error: string | null;
  codexReady: boolean;
  onProject: (projectId: string) => void;
  onVisibility: (visibility: "private" | "shared") => void;
  onEngine: (engine: AgentHarnessId) => void;
  onModel: (model: string, effort: string) => void;
  onApproval: (approval: AgentApproval) => void;
  onStart: (text: string, attachments: AgentAttachment[]) => Promise<boolean>;
}) {
  const t = useT();
  const [text, setText] = useDraft("agent-new", "new", "");
  const submit = async (message: string, attachments: AgentAttachment[]) => {
    if ((!message.trim() && attachments.length === 0) || busy) return false;
    const accepted = await onStart(message.trim(), attachments);
    if (accepted) setText("");
    return accepted;
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-16 pt-6">
        <div className="w-full max-w-[720px]">
          <h1 className="text-center text-display font-normal leading-tight tracking-[-0.015em] text-text">
            {t("What should we work on?")}
          </h1>
          <div className="mt-7">
            <Composer
              workspaceId={workspaceId}
              value={text}
              onChange={setText}
              busy={busy}
              onSubmit={submit}
              placeholder={t("Message TaCos")}
              onNew={() => setText("")}
              skills={skills}
              canManageSkills={canManageSkills}
              onCreateSkill={onCreateSkill}
              onDeleteSkill={onDeleteSkill}
              actions={
                <>
                  <ApprovalChip value={approval} onChange={onApproval} disabled={busy} />
                  <HarnessChip options={options} value={engine} onChange={onEngine} disabled={busy} />
                  <ModelChip
                    engine={engine}
                    models={models}
                    model={model}
                    effort={effort}
                    onModel={onModel}
                    disabled={busy}
                  />
                </>
              }
            />
            <ComposerContext>
              <ProjectChip projects={projects} value={projectId} onChange={onProject} />
              <VisibilityChip value={visibility} onChange={onVisibility} />
            </ComposerContext>
          </div>
          {error && <div className="mt-2 px-2 text-small text-danger">{t(error)}</div>}
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {WORK_SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => setText(t(suggestion))}
                className="rounded-full border border-border px-3 py-1 text-small text-muted transition-colors hover:bg-elevated hover:text-text"
              >
                {t(suggestion)}
              </button>
            ))}
          </div>
          <p className="mt-5 text-center text-small text-faint">
            {approval === "ask"
              ? t("The agent can change this project's tasks, comments and docs. Every change waits for your Allow.")
              : t(AGENT_APPROVALS.find((entry) => entry.id === approval)?.detail ?? "")}
          </p>
        </div>
      </div>
    </div>
  );
}

// What the empty-state composer should look like when /agent is reopened. Kept per
// workspace (project ids only make sense there) and per browser, like the sidebar width.
const PREFS_KEY = "tacos.agent.prefs";

type AgentDraftPrefs = {
  project: string;
  visibility: "private" | "shared";
  engine: AgentHarnessId;
  model: string;
  effort: string;
  approval: AgentApproval;
};

export function AgentWorkspace({
  workspaceId,
  viewerId,
  ready,
  engines,
  defaultEngine,
  modelsByEngine,
  skills,
  canManageSkills,
  codexDefault,
  projects,
  threads,
  active,
}: {
  workspaceId: string;
  viewerId: string;
  ready: boolean;
  engines: AgentHarnessOption[];
  defaultEngine: AgentHarnessId;
  modelsByEngine: ModelsByEngine;
  skills: AgentSkill[];
  canManageSkills: boolean;
  codexDefault: { model: string; effort: string };
  projects: ProjectOption[];
  threads: AgentThread[];
  active: AgentThreadDetail | null;
}) {
  const t = useT();
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  // This component stays mounted across threads, so New chat would come back still busy.
  if (starting && active) setStarting(false);
  const [drawer, setDrawer] = useState(false);
  const {scope}=useUI();
  const [sidebarClosed,setSidebarClosed]=useStoredJson(`tacos.agent.sidebar.closed.${scope}`,false);
  const [draftProject, setDraftProject] = useState(projects[0]?.id ?? "");
  const [draftVisibility, setDraftVisibility] = useState<"private" | "shared">("private");
  const [draftEngine, setDraftEngine] = useState<AgentHarnessId>(defaultEngine);
  const modelPref = (engine: AgentHarnessId, model = "", effort = "") =>
    modelPrefFor(
      modelsByEngine[engine] ?? [],
      engine === "codex" ? codexDefault : { model: "", effort: "" },
      model,
      effort
    );
  const [draftModel, setDraftModel] = useState(() => modelPref(defaultEngine).model);
  const [draftEffort, setDraftEffort] = useState(() => modelPref(defaultEngine).effort);
  const [draftApproval, setDraftApproval] = useState<AgentApproval>("ask");
  const codexReady = engines.some((option) => option.id === "codex" && option.available);
  const options = availableEngines(engines);
  const prefsKey = `${PREFS_KEY}.${workspaceId}`;
  const current = useRef<AgentDraftPrefs>({
    project: draftProject,
    visibility: draftVisibility,
    engine: draftEngine,
    model: draftModel,
    effort: draftEffort,
    approval: draftApproval,
  });

  // Restored after mount so the server markup and the first client render agree, and
  // read once so unrelated prop refreshes never overwrite what the user picked.
  useEffect(() => {
    let saved: Partial<AgentDraftPrefs>;
    try {
      const raw = window.localStorage.getItem(prefsKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      saved = parsed;
    } catch {
      return;
    }
    const fallback = current.current;
    const project = projects.some((entry) => entry.id === saved.project)
      ? saved.project!
      : fallback.project;
    const engine = options.some((entry) => entry.id === saved.engine)
      ? saved.engine!
      : fallback.engine;
    const { model, effort } = modelPref(engine, saved.model ?? "", saved.effort ?? "");
    const approval = AGENT_APPROVALS.some((entry) => entry.id === saved.approval)
      ? saved.approval!
      : fallback.approval;
    const visibility = saved.visibility === "shared" ? "shared" : "private";
    setDraftProject(project);
    setDraftVisibility(visibility);
    setDraftEngine(engine);
    setDraftModel(model);
    setDraftEffort(effort);
    setDraftApproval(approval);
    current.current = { project, visibility, engine, model, effort, approval };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function rememberPrefs(patch: Partial<AgentDraftPrefs>) {
    const next = { ...current.current, ...patch };
    current.current = next;
    try {
      window.localStorage.setItem(prefsKey, JSON.stringify(next));
    } catch {
      /* storage unavailable — the choice still applies to this page view */
    }
  }

  function chooseEngine(engine: AgentHarnessId) {
    if (engine === draftEngine) return;
    const { model, effort } = modelPref(engine);
    setDraftEngine(engine);
    setDraftModel(model);
    setDraftEffort(effort);
    rememberHarness(engine);
    rememberPrefs({ engine, model, effort });
  }


  // Both actions revalidate the Agent page, so the list behind the dialog comes back from
  // the server render that follows the call.
  async function createSkill(input: SkillDraft): Promise<SkillCreateResult> {
    try {
      return await createAgentSkillAction(workspaceId, input);
    } catch {
      return { ok: false, error: "Could not reach the server. Reload the window and try again." };
    }
  }

  async function deleteSkill(skill: AgentSkill): Promise<SkillDeleteResult> {
    try {
      const result = await deleteAgentSkillAction(workspaceId, skill.path);
      return result.ok ? { ok: true } : result;
    } catch {
      return { ok: false, error: "Could not reach the server. Reload the window and try again." };
    }
  }

  async function start(text: string, attachments: AgentAttachment[] = []) {
    setStarting(true);
    setStartError(null);
    let result: Awaited<ReturnType<typeof startAgentThreadAction>>;
    try {
      result = await startAgentThreadAction(workspaceId, {
        projectId: draftProject,
        visibility: draftVisibility,
        engine: draftEngine,
        approval: draftApproval,
        model: draftModel,
        effort: draftEffort,
      });
    } catch {
      // A server action from a page opened before the server restarted rejects here; without
      // this the composer would sit on a dead Stop button and look like it cannot send.
      setStartError("Could not reach the server. Reload the window and try again.");
      setStarting(false);
      return false;
    }
    if (!result.ok) {
      setStartError(result.error);
      setStarting(false);
      return false;
    }
    // The first turn has to survive the navigation into the new thread, so it waits
    // here for Conversation to pick up on mount.
    try {
      sessionStorage.setItem(
        `tacos:agent:pending:${result.data.id}`,
        JSON.stringify({ text, attachments })
      );
    } catch {
      setStartError("Could not save. Retry.");
      setStarting(false);
      return false;
    }
    router.push(`/${workspaceId}/agent?thread=${result.data.id}`);
    router.refresh();
    return true;
  }

  if (!ready) {
    return (
      <div
        className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto bg-bg p-6"
        data-testid="agent-harness-gate"
      >
        <div className="max-w-md rounded-xl border border-border bg-surface p-6">
          <div className="flex items-center gap-2 text-body font-semibold">
            <Bot size={16} /> {t("Agent needs a ready harness")}
          </div>
          <p className="mt-2 text-body leading-relaxed text-muted">
            {t("Enable at least one local harness that is installed and ready. Open Settings to turn a harness on, install it, or sign in.")}
          </p>
          <ul className="mt-3 space-y-2">
            {engines.map((option) => (
              <li key={option.id} className="text-small leading-relaxed">
                <span className="font-medium text-text">{option.label}</span>
                <span className="text-muted"> — {option.hint ? t(option.hint) : t("Available")}</span>
              </li>
            ))}
          </ul>
          <Link
            href={`/${workspaceId}/settings`}
            className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-small font-medium text-white transition-opacity hover:opacity-90"
          >
            <Settings2 size={13} /> {t("Open Settings")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="relative @container flex h-full min-h-0 w-full bg-bg">
      {!sidebarClosed&&<ThreadSidebar onCollapse={()=>setSidebarClosed(true)}
        workspaceId={workspaceId}
        threads={threads}
        projects={projects}
        activeId={active?.id}
        onNavigate={() => setDrawer(false)}
      />}

      {/* Narrow windows drop the docked sidebar; the panel button in each header opens
          this copy of it instead so conversations stay reachable. */}
      {drawer && (
        <div className="absolute inset-0 z-30 flex @[620px]:hidden">
          <button
            type="button"
            aria-label={t("Close conversations")}
            onClick={() => setDrawer(false)}
            className="absolute inset-0 bg-black/15"
          />
          <div className="relative flex h-full">
            <ThreadSidebar
              workspaceId={workspaceId}
              threads={threads}
              projects={projects}
              activeId={active?.id}
              variant="drawer"
              onNavigate={() => setDrawer(false)}
            />
          </div>
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <button className="self-start px-3 py-1 text-small text-muted" onClick={()=>{setSidebarClosed(!sidebarClosed);setDrawer(true);}}>{t(sidebarClosed?"Show conversations":"Conversations")}</button>
        {active ? (
          // Keyed by thread so switching conversations starts from that thread's own state
          // instead of carrying the previous one's messages across.
          // New chat leaves the open thread. Start on the empty composer creates a new session id.
          <Conversation
            key={active.id}
            workspaceId={workspaceId}
            viewerId={viewerId}
            active={active}
            projects={projects}
            options={options}
            modelsByEngine={modelsByEngine}
            skills={skills}
            canManageSkills={canManageSkills}
            onCreateSkill={createSkill}
            onDeleteSkill={deleteSkill}
            codexDefault={codexDefault}
            defaultEngine={defaultEngine}
            codexReady={codexReady}
            onOpenSidebar={() => setDrawer(true)}
            onNew={() => router.push(`/${workspaceId}/agent`)}
          />
        ) : (
          <>
            <header className="relative flex h-12 shrink-0 items-center justify-center px-4">
              <button
                type="button"
                onClick={() => setDrawer(true)}
                className="absolute left-2 top-2 flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-text @[620px]:hidden"
                title={t("Conversations")}
              >
                <PanelLeft size={15} />
              </button>
            </header>
            <StartComposer
              projects={projects}
              options={options}
              models={modelsByEngine[draftEngine] ?? []}
              skills={skills}
              canManageSkills={canManageSkills}
              onCreateSkill={createSkill}
              onDeleteSkill={deleteSkill}
              projectId={draftProject}
              visibility={draftVisibility}
              engine={draftEngine}
              model={draftModel}
              effort={draftEffort}
              approval={draftApproval}
              busy={starting}
              error={startError}
              codexReady={codexReady}
              onModel={(model, effort) => {
                setDraftModel(model);
                setDraftEffort(effort);
                rememberPrefs({ model, effort });
              }}
              onApproval={(approval) => {
                setDraftApproval(approval);
                rememberPrefs({ approval });
              }}
              onProject={(projectId) => {
                setDraftProject(projectId);
                rememberPrefs({ project: projectId });
              }}
              onVisibility={(visibility) => {
                setDraftVisibility(visibility);
                rememberPrefs({ visibility });
              }}
              onEngine={chooseEngine}
              workspaceId={workspaceId}
              onStart={start}
            />
          </>
        )}
      </main>
    </div>
  );
}


function Conversation({
  workspaceId,
  viewerId,
  active,
  projects,
  options,
  modelsByEngine,
  skills,
  canManageSkills,
  onCreateSkill,
  onDeleteSkill,
  codexDefault,
  defaultEngine,
  codexReady,
  onOpenSidebar,
  onNew,
}: {
  workspaceId: string;
  viewerId: string;
  active: AgentThreadDetail;
  projects: ProjectOption[];
  options: AgentHarnessOption[];
  modelsByEngine: ModelsByEngine;
  skills: AgentSkill[];
  canManageSkills: boolean;
  onCreateSkill: (input: SkillDraft) => Promise<SkillCreateResult>;
  onDeleteSkill: (skill: AgentSkill) => Promise<SkillDeleteResult>;
  codexDefault: { model: string; effort: string };
  defaultEngine: AgentHarnessId;
  codexReady: boolean;
  onOpenSidebar: () => void;
  onNew: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const [{messages,historyCursor,restore:historyRestore},setHistory] = useState(()=>({messages:toUi(active),historyCursor:active.historyCursor??null,restore:null as {beforeHeight:number}|null}));
  const setMessages=useCallback((update:UiMessage[]|((previous:UiMessage[])=>UiMessage[]))=>setHistory(previous=>({...previous,messages:typeof update==="function"?update(previous.messages):update})),[]);
  const [liveMessage,setLiveMessage]=useState<UiMessage|null>(null);
  const liveMessageRef=useRef<UiMessage|null>(null);
  const [loadingHistory,setLoadingHistory]=useState(false);
  const loadHistory=async()=>{if(!historyCursor||loadingHistory)return;setLoadingHistory(true);const beforeHeight=chatScroll.current?.scrollHeight??0,firstId=messages[0]?.id;setFollow(false);try{const result=await loadAgentHistoryAction(workspaceId,active.id,historyCursor);if(!result.ok){setError(result.error);return;}setHistory(previous=>{if(previous.historyCursor!==historyCursor||previous.messages[0]?.id!==firstId)return previous;const ids=new Set(previous.messages.map(row=>row.id));return {messages:[...toUi(result.data).filter(row=>!ids.has(row.id)),...previous.messages],historyCursor:result.data.historyCursor??null,restore:{beforeHeight}};});}catch(error){setError(error instanceof Error?error.message:"Could not load messages. Retry.");}finally{setLoadingHistory(false);}};
  const {confirm,toast}=useUI();
  const [failedAccepted,setFailedAccepted]=useDraft("agent-failed-accepted",active.id,false);
  const [failedText,setFailedText]=useDraft<string|null>("agent-failed-turn",active.id,null);
  const [failedAttachments,setFailedAttachments]=useDraft<AgentAttachment[]>("agent-failed-attachments",active.id,[]);
  const [follow,setFollow]=useState(true);
  const running=useRef(false),chatScroll=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!historyRestore)return;const frame=requestAnimationFrame(()=>{if(chatScroll.current)chatScroll.current.scrollTop+=chatScroll.current.scrollHeight-historyRestore.beforeHeight;});return()=>cancelAnimationFrame(frame);},[historyRestore]);
  const [input, setInput] = useDraft("agent", active.id, "");
  const [busy, setBusy] = useState(false);
  // H-COLLAB-13: a live refresh brings new server messages (another member's turn).
  // Take them when no turn of ours is running; a running turn owns the list, and a
  // snapshot from during that turn is stale for good, so it counts as seen. A reply is
  // filled in on its existing row, so the key has to change with the row's content.
  const serverKey = active.messages;
  const [seenKey, setSeenKey] = useState(serverKey);
  if (serverKey !== seenKey) {
    setSeenKey(serverKey);
    if (!busy) setHistory(previous=>{const refreshed=toUi(active),ids=new Set(refreshed.map(row=>row.id)),overlap=previous.messages.findIndex(row=>row.id===refreshed[0]?.id);return overlap<0?{messages:refreshed,historyCursor:active.historyCursor??null,restore:null}:{messages:[...previous.messages.slice(0,overlap).filter(row=>!ids.has(row.id)),...refreshed],historyCursor:previous.historyCursor,restore:null};});
  }
  // Harness is a turn preference on this session. New chat creates a new session.
  const [engine, setEngine] = useState<AgentHarnessId>(() => {
    const fromThread = active.engine;
    if (options.some((option) => option.id === fromThread)) return fromThread as AgentHarnessId;
    return defaultEngine;
  });
  const modelPref = (id: AgentHarnessId, savedModel = "", savedEffort = "") =>
    modelPrefFor(
      modelsByEngine[id] ?? [],
      id === "codex" ? codexDefault : { model: "", effort: "" },
      savedModel,
      savedEffort
    );
  const [model, setModel] = useState(() => modelPref(engine, active.model, active.effort).model);
  const [effort, setEffort] = useState(() => modelPref(engine, active.model, active.effort).effort);
  const [approvalMode, setApprovalMode] = useState<AgentApproval>(active.approval);

  // Harness is a turn pref on this session. Persist last-used. Do not open a new thread.
  async function chooseEngine(next: AgentHarnessId) {
    if (next === engine) return;
    const before = { engine, model, effort };
    const pref = modelPref(next);
    setEngine(next);
    setModel(pref.model);
    setEffort(pref.effort);
    rememberHarness(next);
    const result = await setAgentThreadEngineAction(workspaceId, active.id, next);
    if (!result.ok) {
      setEngine(before.engine);
      setModel(before.model);
      setEffort(before.effort);
      setError(result.error);
    }
  }

  // H-P3-18: model change keeps this session. It does not create a thread.
  async function changeModel(nextModel: string, nextEffort: string) {
    const before = { model, effort };
    setModel(nextModel);
    setEffort(nextEffort);
    const result = await setAgentThreadModelAction(workspaceId, active.id, nextModel, nextEffort);
    if (!result.ok) {
      setModel(before.model);
      setEffort(before.effort);
      setError(result.error);
    }
  }

  async function changeApproval(next: AgentApproval) {
    const before = approvalMode;
    setApprovalMode(next);
    const result = await setAgentThreadApprovalAction(workspaceId, active.id, next);
    if (!result.ok) {
      setApprovalMode(before);
      setError(result.error);
    }
  }
  const [approval, setApproval] = useState<AgentApprovalCard | null>(null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forkBusy, setForkBusy] = useState<string | null>(null);
  const turnTaken =
    active.visibility === "shared" && Boolean(active.turnUserId) && active.turnUserId !== viewerId;
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement | null>(null);
  const box = useRef<HTMLTextAreaElement | null>(null);
  const pendingSent = useRef(false);

  // Nothing tells this viewer when the other person's turn ends, so ask while it lasts.
  useEffect(() => {
    if (!turnTaken) return;
    const timer = setInterval(() => router.refresh(), SHARED_TURN_POLL_MS);
    return () => clearInterval(timer);
  }, [turnTaken, router]);

  useEffect(() => {
    if(follow)bottom.current?.scrollIntoView({ block: "end" });
  }, [messages,liveMessage, approval,follow]);

  const stepIndexes=useRef(new WeakMap<AgentStepFrame[],Map<string,number>>());
  const patchQueue=useRef<((message:UiMessage)=>UiMessage)[]>([]),patchFrame=useRef(0);
  const flushPatches=()=>{cancelAnimationFrame(patchFrame.current);patchFrame.current=0;const patches=patchQueue.current;patchQueue.current=[];if(!patches.length)return;const last=liveMessageRef.current;if(!last)return;const next=patches.reduce((message,patch)=>patch(message),last);liveMessageRef.current=next;setLiveMessage(next);};
  useEffect(()=>()=>cancelAnimationFrame(patchFrame.current),[]);
  function patchLastAssistant(patch:(message:UiMessage)=>UiMessage){patchQueue.current.push(patch);if(!patchFrame.current)patchFrame.current=requestAnimationFrame(flushPatches);}

  const forkAt=useCallback(async(messageId: string) => {
    if (forkBusy) return;
    setForkBusy(messageId);
    setError(null);
    try {
      const result = await forkAgentThreadFromMessageAction(workspaceId, active.id, messageId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/${workspaceId}/agent?thread=${result.data.id}`);
      router.refresh();
    } finally {
      setForkBusy(null);
    }
  },[forkBusy,workspaceId,active.id,router]);
  const editMessage=useCallback((text:string)=>{setInput(text);box.current?.focus();},[setInput]);

  async function send(text: string, attachments: AgentAttachment[] = []) {
    const message = text.trim();
    if ((!message && attachments.length === 0) || running.current || turnTaken) return;
    running.current=true;setFollow(true);
    setError(null);
    setApproval(null);
    setBusy(true);
    const startedAt = Date.now();
    setMessages((prev) => [
      ...prev,
      {
        id: `local-${startedAt}`,
        role: "user",
        content: messageWithAttachments(message, attachments),
        steps: [],
      },
    ]);
    const initial:UiMessage={id:`streaming-${startedAt}`,role:"assistant",content:"",steps:[]};liveMessageRef.current=initial;setLiveMessage(initial);
    const controller = new AbortController();
    abort.current = controller;
    let accepted = false;
    try {
      await streamAiEdit(
        {
          workspaceId,
          action: "agent",
          threadId: active.id,
          engine,
          text: message,
          attachments: attachments.length ? attachments.map((file) => file.id) : undefined,
        },
        (delta) => { if (!accepted) {accepted=true;setInput(current=>current.trim()===message?"":current);} patchLastAssistant((last) => ({ ...last, content: last.content + delta })); },
        controller.signal,
        (frame) => {
          if (!accepted) {accepted=true;setInput(current=>current.trim()===message?"":current);}
          if (frame.type === "step") {
            patchLastAssistant((last) => {
              const key = frame.step.key || `${frame.step.kind}|${frame.step.title}`;
              let indexes=stepIndexes.current.get(last.steps);if(!indexes){indexes=new Map(last.steps.map((step,index)=>[step.key,index]));stepIndexes.current.set(last.steps,indexes);}
              const existing = indexes.get(key)??-1;
              if (existing < 0){const steps=[...last.steps,frame.step];const extended=new Map(indexes);extended.set(key,steps.length-1);stepIndexes.current.set(steps,extended);return {...last,steps};}
              const steps = [...last.steps];
              steps[existing] = { ...steps[existing], ...frame.step };stepIndexes.current.set(steps,indexes);
              return { ...last, steps };
            });
          } else if (frame.type === "approval") {
            setApproval(frame.request);
          } else if (frame.type === "approval_done") {
            setApproval((current) => (current?.requestId === frame.requestId ? null : current));
          }
        }
      );
      setInput(current=>current.trim()===message?"":current);setFailedText(null);setFailedAttachments([]);setFailedAccepted(false);
    } catch (err) {
      flushPatches();
      setFailedText(message);setFailedAttachments(attachments);setFailedAccepted(accepted);
      const aborted = err instanceof Error && err.name === "AbortError";
      if (!aborted) setError(err instanceof Error ? err.message : "The agent could not answer");
    } finally {
      flushPatches();
      const final=liveMessageRef.current;if(final&&(final.content.trim()||final.steps.length))setMessages(previous=>[...previous,final]);liveMessageRef.current=null;setLiveMessage(null);
      abort.current = null;
      running.current=false;setBusy(false);
      setApproval(null);
      router.refresh();
      box.current?.focus();
    }
  }

  // A conversation created from the empty-state composer hands its first message over in
  // sessionStorage: creating the thread navigates away from the component that typed it.
  useEffect(() => {
    if (pendingSent.current) return;
    pendingSent.current = true;
    const key = `tacos:agent:pending:${active.id}`;
    let pendingText = "";
    let pendingAttachments: AgentAttachment[] = [];
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        sessionStorage.removeItem(key);
        try {
          const parsed = JSON.parse(raw) as { text?: string; attachments?: AgentAttachment[] };
          if (parsed && typeof parsed === "object" && ("text" in parsed || "attachments" in parsed)) {
            pendingText = typeof parsed.text === "string" ? parsed.text : "";
            pendingAttachments = Array.isArray(parsed.attachments) ? parsed.attachments : [];
          } else {
            pendingText = raw;
          }
        } catch {
          pendingText = raw;
        }
      }
    } catch {
      /* no storage — nothing to pre-send */
    }
    if (pendingText.trim() || pendingAttachments.length) void send(pendingText, pendingAttachments);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function answer(requestId: string, decision: "accept" | "decline" | "accept-turn") {
    setApprovalBusy(true);
    try {
      const response = await fetch("/api/ai/chat/approval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, threadId: active.id, requestId, decision }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? "Could not send the answer");
        return;
      }
      if (response.ok) setApproval((current)=>current?.requestId===requestId?null:current);
    } catch { setError("Could not send the answer"); } finally {
      setApprovalBusy(false);
    }
  }

  async function changeProject(projectId:string){const result=await setAgentThreadProjectAction(workspaceId,active.id,projectId);if(!result.ok)setError(result.error);else router.refresh();}
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="relative flex h-12 shrink-0 items-center justify-between gap-2 px-3">
        <div className="flex min-w-0 items-center gap-1.5 text-small text-muted">
          <button
            type="button"
            onClick={onOpenSidebar}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-text @[620px]:hidden"
            title={t("Conversations")}
          >
            <PanelLeft size={15} />
          </button>
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: active.projectColor || "var(--color-faint)" }}
          />
          <span className="max-w-[200px] truncate font-medium text-text" title={active.title}>{active.title||t("Untitled conversation")}</span><span className="max-w-[120px] truncate">{active.projectName||t("No project")}</span>
          {active.visibility === "shared" && <Users size={11} className="shrink-0 text-faint" />}
          {!active.mine && <span className="shrink-0 text-faint">· {active.createdByName}</span>}
        </div>
        <div className="min-w-0 flex-1 overflow-x-auto">
          <ThreadTaskChips workspaceId={workspaceId} threadId={active.id} busy={busy} />
        </div>
        <div className="flex shrink-0 items-center">
          <ThreadMenu workspaceId={workspaceId} thread={active} projects={projects}/>
        </div>
      </header>

      <div ref={chatScroll} onScroll={e=>{const element=e.currentTarget;setFollow(element.scrollHeight-element.scrollTop-element.clientHeight<80);}} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 pb-8 pt-4">
          {messages.length === 0 && (
            <div className="pt-16 text-center">
              <h1 className="text-display font-normal leading-tight tracking-[-0.015em]">
                {t("What should we work on?")}
              </h1>
              <p className="mt-2 text-body text-muted">
                {active.projectId
                  ? t("Work in {project} — every change waits for your Allow.", { project: active.projectName })
                  : t("Ask about any project in this workspace, or have the agent draft a task for you.")}
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {WORK_SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void send(suggestion)}
                    className="rounded-full border border-border px-3 py-1 text-small text-muted transition-colors hover:bg-elevated hover:text-text"
                  >
                    {t(suggestion)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {historyCursor&&<button disabled={loadingHistory} onClick={()=>void loadHistory()} className="text-small text-muted">{t(loadingHistory?"Loading…":"Load earlier messages")}</button>}
          <MessageList messages={messages} live={false} visibility={active.visibility} forkBusy={forkBusy} workspaceId={workspaceId} threadId={active.id} busy={busy} onFork={forkAt} onEdit={editMessage} onCopy={toast}/>
          {liveMessage&&<MessageList messages={[liveMessage]} live visibility={active.visibility} forkBusy={forkBusy} workspaceId={workspaceId} threadId={active.id} busy={busy} onFork={forkAt} onEdit={editMessage} onCopy={toast}/>}

          {approval && (
            <ApprovalPanel
              card={approval}
              busy={approvalBusy}
              onAnswer={(id, decision) => void answer(id, decision)}
            />
          )}
          <div ref={bottom} />
        </div>
      </div>

      <div className="shrink-0 px-4 pb-4">
        <div className="mx-auto w-full max-w-3xl">
          {!follow&&<button className="mb-2 rounded border border-border px-3 py-1 text-small" onClick={()=>{setFollow(true);bottom.current?.scrollIntoView({block:"end"});}}>{t("Jump to latest")}</button>}
          {turnTaken && active.turnUserName && (
            <p className="mb-2 text-center text-small text-muted" data-testid="shared-turn-lock">
              {interpolate(t("{name} is using this shared chat"), { name: active.turnUserName })}
            </p>
          )}
          {error && <TurnError error={error} />}
          {failedText!==null&&<div className="mb-2 flex gap-3 text-small"><button disabled={busy} onClick={()=>{setInput(failedText);box.current?.focus();}}>{t("Edit failed message")}</button>{failedAttachments.length>0&&<span>{failedAttachments.map(file=>file.name).join(", ")}</span>}{!failedAccepted&&<button disabled={busy} onClick={()=>void (async()=>{if(await confirm(t("Send this request again? Check the conversation first; the previous request may already have run.")))await send(failedText,failedAttachments);})()}>{t("Retry")}</button>}{failedAccepted&&<span>{t("The request started. Review its results before sending another request.")}</span>}<button onClick={()=>void navigator.clipboard.writeText(failedText).then(()=>toast(t("Copied"))).catch(()=>toast(t("Could not copy the link")))}>{t("Copy")}</button></div>}
          <Composer
            workspaceId={workspaceId}
            value={input}
            onChange={setInput}
            onSubmit={(text, attachments) => void send(text, attachments)}
            busy={busy}
            submitDisabled={turnTaken}
            onStop={() => abort.current?.abort()}
            placeholder={t("Message TaCos")}
            inputRef={box}
            onNew={onNew}
            skills={skills}
            canManageSkills={canManageSkills}
            onCreateSkill={onCreateSkill}
            onDeleteSkill={onDeleteSkill}
            actions={
              <>
                <ApprovalChip
                  value={approvalMode}
                  onChange={(next) => void changeApproval(next)}
                  disabled={busy || !active.mine}
                />
                <HarnessChip
                  options={options}
                  value={engine}
                  onChange={(next) => void chooseEngine(next)}
                  disabled={busy || !active.mine}
                />
                <ModelChip
                  engine={engine}
                  models={modelsByEngine[engine] ?? []}
                  model={model}
                  effort={effort}
                  onModel={(nextModel, nextEffort) => void changeModel(nextModel, nextEffort)}
                  disabled={busy || !active.mine}
                />
              </>
            }
          />
          <ComposerContext>
            {active.mine ? (
              <ProjectChip
                projects={projects}
                value={active.projectId}
                onChange={(projectId) => void changeProject(projectId)}
              />
            ) : (
              <span className="flex min-w-0 items-center gap-1.5 px-2 text-small text-muted">
                <Folder size={13} className="shrink-0" />
                <span className="max-w-[170px] truncate">{active.projectName || t("No project")}</span>
              </span>
            )}
          </ComposerContext>
          <p className="mt-1.5 text-center text-caption text-faint">
            {active.mine
              ? approvalMode === "ask"
                ? t("The agent can create and edit tasks, comments, docs and the overview. Every change waits for your Allow.")
                : t(AGENT_APPROVALS.find((entry) => entry.id === approvalMode)?.detail ?? "")
              : t("You are writing in {name}'s shared chat. Every change waits for your Allow.", {
                  name: active.createdByName,
                })}
          </p>
        </div>
      </div>
    </div>
  );
}

const MessageList=memo(function MessageList({messages,live,visibility,forkBusy,workspaceId,threadId,busy,onFork,onEdit,onCopy}:{messages:UiMessage[];live:boolean;visibility:string;forkBusy:string|null;workspaceId:string;threadId:string;busy:boolean;onFork:(id:string)=>void;onEdit:(text:string)=>void;onCopy:(text:string)=>void}){
 const t=useT();return <>{messages.map((message,index)=>{
            const forkButton =
              visibility === "shared" ? (
                <button
                  type="button"
                  disabled={forkBusy === message.id}
                  onClick={() => void onFork(message.id)}
                  className="mt-1 flex items-center gap-1 text-caption text-faint transition-colors hover:text-muted disabled:opacity-50"
                  data-testid="fork-message"
                >
                  <GitBranch size={11} />
                  {t(forkBusy === message.id ? "Opening private chat…" : "Continue in private chat")}
                </button>
              ) : null;
            return message.role === "user" ? (
              <div key={message.id} className="flex flex-col items-end gap-1">
                {message.author && (
                  <span className="px-1 text-small text-faint" data-testid="message-author">
                    {message.author}
                  </span>
                )}
                <UserMessageBody content={message.content} bubbleClass={"max-w-[85%] whitespace-pre-wrap [overflow-wrap:anywhere] rounded-2xl rounded-br-md bg-elevated px-3.5 py-2 text-body leading-relaxed"} />
                {forkButton}
<div className="flex gap-3 text-small text-faint"><button disabled={busy} onClick={()=>{onEdit(message.content);}}>{t("Edit and resend")}</button><button onClick={()=>void navigator.clipboard.writeText(message.content).then(()=>onCopy(t("Copied"))).catch(()=>onCopy(t("Could not copy the link")))}>{t("Copy")}</button></div>
              </div>
            ) : (
              <div key={message.id} style={{contentVisibility:"auto",containIntrinsicSize:"auto 150px"}} className="min-w-0 text-body leading-relaxed">
                {message.steps.length > 0 && <StepContext.Provider value={{workspaceId,threadId:threadId}}><StepList steps={message.steps} live={live && index === messages.length - 1} /></StepContext.Provider>}
                {message.content ? (
                  <Markdown source={message.content} />
                ) : live && index === messages.length - 1 ? (
                  <TurnStatus />
                ) : null}
                {forkButton}
              </div>
            );
})}</>;
});
