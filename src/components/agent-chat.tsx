"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
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
  Info,
  Link2,
  Loader2,
  Lock,
  MoreHorizontal,
  PanelLeft,
  Pencil,
  Pin,
  Plus,
  Search,
  Settings2,
  Square,
  Terminal,
  Trash2,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { Menu, MenuItem } from "@/components/menu";
import { useUI } from "@/components/ui-context";
import { Markdown } from "@/components/markdown";
import { rememberHarness, streamAiEdit, type AgentApprovalCard, type AgentStepFrame } from "@/lib/ai-client";
import {
  createAgentSkillAction,
  deleteAgentSkillAction,
  deleteAgentThreadAction,
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

type UiMessage = { id: string; role: "user" | "assistant"; content: string; steps: AgentStepFrame[] };

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
    steps: message.steps.map((step) => ({
      key: step.id,
      kind: step.kind,
      title: step.title,
      detail: step.detail ?? undefined,
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

function StepLine({ step }: { step: AgentStepFrame }) {
  const Icon =
    step.kind === "command" ? Terminal : step.kind === "file" ? FileText : step.kind === "tool" ? Wrench : Info;
  const detail = stepDetail(step);
  const failed = step.status === "error" || step.status === "denied";
  return (
    <details className="group/step">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded px-1 py-0.5 text-[12px] text-muted transition-colors hover:bg-elevated [&::-webkit-details-marker]:hidden">
        <Icon size={12} className="shrink-0 text-faint" />
        <span className="min-w-0 truncate font-mono text-[11.5px]">{step.title}</span>
        {step.status === "running" ? (
          <Loader2 size={11} className="shrink-0 animate-spin text-faint" />
        ) : failed ? (
          <span className="shrink-0 text-[10.5px] text-danger">
            {step.status === "denied" ? "denied" : "failed"}
          </span>
        ) : (
          <Check size={11} className="shrink-0 text-faint" />
        )}
      </summary>
      {detail && (
        <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-surface p-2 font-mono text-[11px] leading-relaxed text-muted">
          {detail}
        </pre>
      )}
    </details>
  );
}

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
      <div className="flex items-center gap-2 text-[12.5px] font-medium">
        <Lock size={13} />
        {t("Permission needed")}
        <span className="ml-auto rounded-full border border-border bg-bg px-2 py-0.5 font-mono text-[11px] text-muted">
          {card.tool}
        </span>
      </div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{card.message}</p>
      {card.description && <p className="mt-1 text-[12px] leading-relaxed text-faint">{card.description}</p>}
      {card.params && (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-bg p-2 font-mono text-[11px] leading-relaxed text-muted">
          {card.params}
        </pre>
      )}
      <div className="mt-2.5 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => onAnswer(card.requestId, "decline")}
          disabled={busy}
          className="rounded-md border border-border px-2.5 py-1 text-[12px] text-muted transition-colors hover:border-border-strong hover:text-text disabled:opacity-50"
        >
          {t("Deny")}
        </button>
        <button
          type="button"
          onClick={() => onAnswer(card.requestId, "accept-turn")}
          disabled={busy}
          title={t("Stop asking for the rest of this turn")}
          className="rounded-md border border-border px-2.5 py-1 text-[12px] text-muted transition-colors hover:border-border-strong hover:text-text disabled:opacity-50"
        >
          {t("Allow for this turn")}
        </button>
        <button
          type="button"
          onClick={() => onAnswer(card.requestId, "accept")}
          disabled={busy}
          className="rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
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
      triggerClassName="flex items-center gap-1.5 rounded-full px-2 py-1 text-[12.5px] text-text transition-colors hover:bg-elevated disabled:opacity-50"
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
          {projects.length === 0 && <p className="px-2 py-2 text-[12px] text-faint">{t("No projects yet.")}</p>}
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
    <p className="px-2 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-faint">
      {children}
    </p>
  );
}

// "GPT-6.1-Sol" reads as "GPT-6.1 Sol" in the chip, the way Codex writes it.
const prettyModel = (label: string) => label.replace(/-(?=[A-Za-z])/g, " ");

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

function ModelChip({
  options,
  value,
  onChange,
  models,
  model,
  effort,
  onModel,
  disabled,
}: {
  options: AgentHarnessOption[];
  value: AgentHarnessId;
  onChange: (engine: AgentHarnessId) => void;
  models: CodexModel[];
  model: string;
  effort: string;
  onModel: (model: string, effort: string) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const current = options.find((option) => option.id === value) ?? options[0];
  const picked = models.find((entry) => entry.slug === model) ?? models[0];
  const effortLabel = picked?.efforts.find((level) => level.id === effort)?.label ?? effort;
  if (options.length === 0) return null;
  const showingModel = value === "codex" && Boolean(picked);
  return (
    <Menu
      width={330}
      align="right"
      triggerClassName={`flex items-center gap-1 rounded-full px-2 py-1 text-[12.5px] text-text transition-colors hover:bg-elevated ${
        disabled ? "pointer-events-none opacity-50" : ""
      }`}
      trigger={
        <>
          {showingModel ? (
            <span className="max-w-[220px] truncate">
              {prettyModel(picked.label)}
              {effortLabel && <span className="text-muted"> {effortLabel}</span>}
            </span>
          ) : (
            <>
              <span className="max-w-[190px] truncate">{current?.label}</span>
              {current?.riskLabel ? (
                <span className="max-w-[120px] truncate text-danger">{t(current.riskLabel)}</span>
              ) : current?.detail ? (
                <span className="max-w-[110px] truncate text-faint">{t(current.detail)}</span>
              ) : null}
            </>
          )}
          <ChevronDown size={11} className="shrink-0 text-muted" />
        </>
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
                <span className="min-w-0 flex-1 truncate text-left">
                  <span className="block truncate">{option.label}</span>
                  {option.riskLabel ? (
                    <span
                      className="block truncate text-[11px] text-danger"
                      data-testid={`composer-risk-${option.id}`}
                    >
                      {t(option.riskLabel)}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-[11px] text-faint">{option.detail ? t(option.detail) : null}</span>
              </MenuItem>
            ))}
          {value === "codex" && picked && (
            <>
              <div className="my-1 border-t border-border" />
              <SectionLabel>{t("Model")}</SectionLabel>
              {models.map((entry) => (
                <MenuItem
                  key={entry.slug}
                  active={entry.slug === picked.slug}
                  // Keep the menu open: picking a model usually leads straight to an effort.
                  onSelect={() => onModel(entry.slug, entry.efforts.some((level) => level.id === effort) ? effort : entry.defaultEffort)}
                >
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate">{prettyModel(entry.label)}</span>
                    <span className="block truncate text-[11px] text-faint">{entry.description}</span>
                  </span>
                </MenuItem>
              ))}
              <div className="my-1 border-t border-border" />
              {/* Pinned so effort stays reachable while the model list scrolls. */}
              <div className="sticky bottom-0 -mx-1 -mb-1 border-t border-border bg-overlay px-1 pb-1">
                <div className="px-2 pt-2 text-center">
                  <p className="text-[15px] font-semibold leading-5 text-text">{effortLabel || t("Default")}</p>
                  <p className="mt-0.5 text-[11.5px] text-muted">{prettyModel(picked.label)}</p>
                </div>
                <EffortSlider
                  levels={picked.efforts}
                  value={effort}
                  onChange={(id) => onModel(picked.slug, id)}
                />
                <div className="flex justify-between px-3.5 pb-0.5 text-[10.5px] text-faint">
                  <span>{picked.efforts[0]?.label}</span>
                  <span>{picked.efforts[picked.efforts.length - 1]?.label}</span>
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
      width={300}
      align="right"
      triggerClassName={`flex items-center gap-1 rounded-full px-2 py-1 text-[12.5px] transition-colors hover:bg-elevated ${
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
                <span className="block text-[11px] text-faint">{t(entry.detail)}</span>
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
      className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[12.5px] text-text transition-colors hover:bg-elevated"
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
      !window.confirm(
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
        <div className="flex items-center justify-between border-b border-border px-4 py-2 text-[12px] text-faint">
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
            <div className="px-2 py-3 text-[12.5px] text-faint">{t("No skills found on this machine.")}</div>
          ) : (
            skills.map((skill) => (
              <div
                key={skill.path}
                className="flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-elevated"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-text">@{skillToken(skill)}</span>
                  <span className="mt-0.5 block truncate text-[11.5px] text-muted" title={skill.description}>
                    {skill.description}
                  </span>
                </span>
                <span className="mt-1 shrink-0 rounded-full border border-border px-1.5 text-[10px] leading-4 text-faint">
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
            <div className="text-[11px] uppercase tracking-wide text-faint">{t("New skill")}</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("Name, e.g. release-notes")}
                className="min-w-0 rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] outline-none placeholder:text-faint focus:border-border-strong"
              />
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t("What it does, when to use it")}
                className="min-w-0 rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] outline-none placeholder:text-faint focus:border-border-strong"
              />
            </div>
            <textarea
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              rows={4}
              placeholder={t("Instructions the agent follows when this skill is attached (Markdown)")}
              className="mt-2 w-full resize-none rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] leading-relaxed outline-none placeholder:text-faint focus:border-border-strong"
            />
            <div className="mt-2 flex items-center gap-2">
              {error ? (
                <span className="mr-auto min-w-0 text-[12px] text-danger">{t(error)}</span>
              ) : (
                <span className="mr-auto min-w-0 truncate text-[11px] text-faint">
                  {t("Saved to ~/.codex/skills/<name>/SKILL.md")}
                </span>
              )}
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!name.trim() || !description.trim() || busy}
                className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
              >
                {t(busy ? "Adding…" : "Add skill")}
              </button>
            </div>
          </div>
        ) : (
          <div className="border-t border-border px-4 py-3 text-[12px] text-faint">
            {t("Only workspace admins can add or remove skills on this machine.")}
          </div>
        )}
      </div>
    </>
  );
}

function Composer({
  value,
  onChange,
  onSubmit,
  busy,
  onStop,
  placeholder,
  submitDisabled,
  inputRef,
  children,
  actions,
  onNew,
  skills,
  canManageSkills,
  onCreateSkill,
  onDeleteSkill,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  busy?: boolean;
  onStop?: () => void;
  placeholder: string;
  submitDisabled?: boolean;
  inputRef?: { current: HTMLTextAreaElement | null };
  children?: ReactNode;
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
  const box = useRef<HTMLTextAreaElement | null>(null);
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

  return (
    <div className="relative rounded-[22px] border border-border bg-surface p-2 shadow-[0_1px_3px_rgba(0,0,0,0.05)] transition-colors focus-within:border-border-strong">
      {mention && matches.length > 0 && (
        <div
          ref={panel}
          className="absolute inset-x-0 bottom-full z-50 mb-2 overflow-hidden rounded-xl border border-border bg-overlay shadow-xl shadow-black/10"
        >
          <div className="flex items-center justify-between px-3 pb-1 pt-2 text-[11px] text-faint">
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
                  <span className="block truncate text-[13px] text-text">@{token}</span>
                  <span className="mt-0.5 block truncate text-[11.5px] text-muted" title={skill.description}>
                    {skill.description}
                  </span>
                </span>
                <span className="mt-1 shrink-0 rounded-full border border-border px-1.5 text-[10px] leading-4 text-faint">
                  {skill.name.includes(":") ? "plugin" : skill.scope}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      <textarea
        ref={(el) => {
          box.current = el;
          if (inputRef) inputRef.current = el;
        }}
        value={value}
        rows={1}
        placeholder={placeholder}
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
            if (!busy) onSubmit();
          }
        }}
        className="max-h-[220px] min-h-[30px] w-full resize-none bg-transparent px-2.5 pt-2 text-[14px] leading-relaxed outline-none placeholder:text-faint"
      />
      {/* The card can be narrow once the app sidebar is open, so the chips wrap
          instead of pushing the send button out of the composer. */}
      <div className="mt-1 flex flex-wrap items-center gap-x-0.5 gap-y-1 px-0.5 pb-0.5">
        {onNew && (
          <Menu
            width={260}
            align="left"
            triggerClassName="flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-elevated hover:text-text"
            trigger={<Plus size={15} />}
          >
            {(close) => (
              <>
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
                    <div className="px-2 pb-1 pt-1 text-[11px] uppercase tracking-wide text-faint">
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
                            className="block truncate text-[11px] text-faint"
                            title={skill.description}
                          >
                            {skill.description}
                          </span>
                        </span>
                      </MenuItem>
                    ))}
                  </>
                ) : (
                  <div className="px-2 py-1.5 text-[12px] text-faint">
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
        {children}
        <div className="ml-auto flex min-w-0 items-center gap-0.5">
          {actions}
          <button
            type="button"
            onClick={() => (busy && onStop ? onStop() : onSubmit())}
            disabled={!busy && (!value.trim() || submitDisabled)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0d0d0d] text-white transition-opacity hover:opacity-80 disabled:bg-elevated disabled:text-faint disabled:opacity-100"
            aria-label={t(busy ? "Stop" : "Send")}
            title={t(busy ? "Stop" : "Send")}
          >
            {busy ? <Square size={11} fill="currentColor" /> : <ArrowUp size={15} />}
          </button>
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
      className="h-[24px] w-full min-w-0 rounded border border-border-strong bg-bg px-1.5 text-[13px] outline-none"
    />
  );
}

function ThreadSidebar({
  workspaceId,
  threads,
  projects,
  activeId,
  variant = "docked",
  onNavigate,
}: {
  workspaceId: string;
  threads: AgentThread[];
  projects: ProjectOption[];
  activeId?: string;
  variant?: "docked" | "drawer";
  onNavigate?: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const { toast } = useUI();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  // The ChatGPT-style row menu: pinned rows leave their project group, unread rows keep a
  // dot until they are opened again.
  const [menu, setMenu] = useState<{ thread: AgentThread; left: number; top: number } | null>(
    null
  );
  const [pane, setPane] = useState<"root" | "project">("root");
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const closeMenu = () => {
    setMenu(null);
    setPane("root");
  };

  useEffect(() => {
    if (!menu) return;
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) closeMenu();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    // A fixed panel would drift away from its row while the list scrolls.
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
    };
  }, [menu]);

  const openMenu = (thread: AgentThread, x: number, y: number) => {
    const width = 224;
    const height = 336;
    setMenu({
      thread,
      left: Math.max(8, Math.min(x + 2, window.innerWidth - width - 8)),
      top: y + height > window.innerHeight - 8 ? Math.max(8, y - height) : y + 2,
    });
    setPane("root");
  };

  const pin = async (thread: AgentThread) => {
    closeMenu();
    const result = await setAgentThreadPinnedAction(workspaceId, thread.id, !thread.pinnedAt);
    if (!result.ok) toast(t(result.error));
    else router.refresh();
  };

  const markUnread = async (thread: AgentThread) => {
    closeMenu();
    const result = await setAgentThreadUnreadAction(workspaceId, thread.id, true);
    if (!result.ok) toast(t(result.error));
    else {
      toast(t("Marked as unread"));
      router.refresh();
    }
  };

  const moveToProject = async (thread: AgentThread, projectId: string) => {
    closeMenu();
    if (projectId === thread.projectId) return;
    const result = await setAgentThreadProjectAction(workspaceId, thread.id, projectId);
    if (!result.ok) toast(t(result.error));
    else router.refresh();
  };

  const toggleShared = async (thread: AgentThread) => {
    closeMenu();
    const result = await setAgentThreadVisibilityAction(
      workspaceId,
      thread.id,
      thread.visibility === "shared" ? "private" : "shared"
    );
    if (!result.ok) toast(t(result.error));
    else router.refresh();
  };

  const copyLink = async (thread: AgentThread) => {
    closeMenu();
    const url = `${window.location.origin}/${workspaceId}/agent?thread=${thread.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast(t("Link copied"));
    } catch {
      toast(t("Could not copy the link"));
    }
  };

  const openInWindow = (thread: AgentThread) => {
    closeMenu();
    window.open(`/${workspaceId}/agent?thread=${thread.id}`, "_blank", "noopener,noreferrer");
  };

  const remove = async (thread: AgentThread) => {
    closeMenu();
    if (!window.confirm(t("Delete “{title}” and its history?", { title: thread.title || t("this conversation") }))) return;
    const result = await deleteAgentThreadAction(workspaceId, thread.id);
    if (!result.ok) {
      toast(t(result.error));
      return;
    }
    if (thread.id === activeId) router.push(`/${workspaceId}/agent`);
    router.refresh();
  };

  const startRename = (thread: AgentThread) => {
    closeMenu();
    // The Recents copy steps aside while renaming, so make sure the one that stays is
    // actually on screen (a group only shows its first three rows before "Show more").
    setExpanded((prev) => ({ ...prev, [thread.projectId || "no-project"]: true }));
    setRenaming({ id: thread.id, value: thread.title });
  };

  const commitRename = async () => {
    const current = renaming;
    setRenaming(null);
    if (!current) return;
    const next = current.value.replace(/\s+/g, " ").trim();
    if (!next || next === threads.find((thread) => thread.id === current.id)?.title) return;
    const result = await renameAgentThreadAction(workspaceId, current.id, next);
    if (!result.ok) toast(t(result.error));
    else router.refresh();
  };

  const pinned = threads
    .filter((thread) => thread.pinnedAt)
    .sort((a, b) => (b.pinnedAt ?? "").localeCompare(a.pinnedAt ?? ""));
  const groups = projects
    .map((project) => ({
      project,
      items: threads.filter((thread) => thread.projectId === project.id && !thread.pinnedAt),
    }))
    .filter((group) => group.items.length > 0);
  // Conversations started with "Don't work in a project" have no folder to sit under.
  const loose = threads.filter((thread) => !thread.projectId && !thread.pinnedAt);
  const recents = threads
    .filter((thread) => !thread.pinnedAt && thread.id !== renaming?.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8);
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? threads.filter((thread) => (thread.title || "New conversation").toLowerCase().includes(needle))
    : [];

  const row = (thread: AgentThread, indent = false) => {
    if (renaming?.id === thread.id) {
      return (
        <div
          key={thread.id}
          className={`flex h-[30px] items-center rounded-md bg-elevated pr-1 ${
            indent ? "pl-6" : "pl-1"
          }`}
        >
          <ThreadRenameInput
            threadId={thread.id}
            value={renaming.value}
            onChange={(value) => setRenaming({ id: thread.id, value })}
            onCommit={() => void commitRename()}
            onCancel={() => setRenaming(null)}
          />
        </div>
      );
    }
    return (
      <div
        key={thread.id}
        onContextMenu={(event) => {
          event.preventDefault();
          openMenu(thread, event.clientX, event.clientY);
        }}
        className={`group relative flex h-[30px] items-center rounded-md text-[13px] transition-colors ${
          indent ? "pl-7" : "pl-2"
        } ${thread.id === activeId || menu?.thread.id === thread.id ? "bg-elevated text-text" : "text-text/85 hover:bg-elevated"}`}
      >
        <Link
          href={`/${workspaceId}/agent?thread=${thread.id}`}
          onClick={() => {
            if (thread.unread) void setAgentThreadUnreadAction(workspaceId, thread.id, false);
            onNavigate?.();
          }}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 pr-1"
        >
          {thread.unread && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" title={t("Unread")} />
          )}
          <span
            className={`min-w-0 flex-1 truncate ${thread.unread ? "font-medium text-text" : ""}`}
          >
            {thread.title || "New conversation"}
          </span>
          {thread.visibility === "shared" && <Users size={11} className="shrink-0 text-faint" />}
        </Link>
        <button
          type="button"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault();
            if (menu?.thread.id === thread.id) closeMenu();
            else {
              const rect = event.currentTarget.getBoundingClientRect();
              openMenu(thread, rect.left, rect.bottom);
            }
          }}
          className={`mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted transition-colors hover:bg-border/60 hover:text-text ${
            menu?.thread.id === thread.id ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          }`}
          aria-label={t("Conversation options")}
          title={t("Conversation options")}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>
    );
  };

  return (
    <aside
      className={
        variant === "drawer"
          ? "flex h-full w-[264px] shrink-0 flex-col border-r border-border bg-surface"
          : "hidden w-[248px] shrink-0 flex-col border-r border-border bg-surface @[620px]:flex"
      }
    >
      {/* The workspace switcher and Inbox live in the app sidebar now, so this column
          only has to frame the conversation list. */}
      <div className="flex h-12 shrink-0 items-center gap-1 px-3">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{t("Conversations")}</span>
        <button
          type="button"
          onClick={() => {
            setSearching((open) => !open);
            setQuery("");
          }}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-text"
          title={t("Search conversations")}
        >
          <Search size={14} />
        </button>
      </div>

      {searching && (
        <div className="px-2 pb-1">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setSearching(false);
                setQuery("");
              }
            }}
            placeholder={t("Search conversations")}
            className="h-[30px] w-full rounded-md border border-border bg-bg px-2 text-[12.5px] outline-none placeholder:text-faint focus:border-border-strong"
          />
        </div>
      )}

      <div className="px-2 pb-1">
        {/* H-P3-18: New chat leaves the thread URL. The empty composer creates a new session id. */}
        <Link
          href={`/${workspaceId}/agent`}
          onClick={onNavigate}
          className="flex h-[30px] items-center gap-2 rounded-md px-2 text-[13px] text-text/85 transition-colors hover:bg-elevated"
          data-testid="agent-new-chat"
        >
          <Pencil size={13} className="shrink-0 text-faint" /> {t("New chat")}
        </Link>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {needle ? (
          matches.length > 0 ? (
            <div className="pt-1">{matches.map((thread) => row(thread))}</div>
          ) : (
            <p className="px-2 py-2 text-[12px] text-faint">{t("No matches.")}</p>
          )
        ) : (
          <>
            {pinned.length > 0 && (
              <div className="pb-2">
                <div className="flex items-center gap-1.5 px-2 pb-1 pt-2 text-[12px] text-faint">
                  <Pin size={12} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{t("Pinned")}</span>
                </div>
                {pinned.map((thread) => row(thread))}
              </div>
            )}

            {groups.map(({ project, items }) => {
              const open = expanded[project.id];
              const shown = open ? items : items.slice(0, 3);
              return (
                <div key={project.id} className="pb-2">
                  <div className="flex items-center gap-1.5 px-2 pb-1 pt-2 text-[12px] text-faint">
                    <Folder size={12} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{project.name}</span>
                  </div>
                  {shown.map((thread) => row(thread, true))}
                  {!open && items.length > 3 && (
                    <button
                      type="button"
                      onClick={() => setExpanded((prev) => ({ ...prev, [project.id]: true }))}
                      className="ml-7 mt-0.5 rounded px-2 py-0.5 text-[12px] text-faint transition-colors hover:text-text"
                    >
                      {t("Show more")}
                    </button>
                  )}
                </div>
              );
            })}

            {loose.length > 0 && (
              <div className="pb-2">
                <div className="flex items-center gap-1.5 px-2 pb-1 pt-2 text-[12px] text-faint">
                  <Folder size={12} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{t("No project")}</span>
                </div>
                {(expanded["no-project"] ? loose : loose.slice(0, 3)).map((thread) => row(thread, true))}
                {!expanded["no-project"] && loose.length > 3 && (
                  <button
                    type="button"
                    onClick={() => setExpanded((prev) => ({ ...prev, "no-project": true }))}
                    className="ml-7 mt-0.5 rounded px-2 py-0.5 text-[12px] text-faint transition-colors hover:text-text"
                  >
                    {t("Show more")}
                  </button>
                )}
              </div>
            )}

            <div className="px-2 pb-1 pt-3 text-[12px] text-muted">{t("Recents")}</div>
            {recents.length === 0 ? (
              <p className="px-2 py-1 text-[12px] text-faint">{t("No conversations yet.")}</p>
            ) : (
              recents.map((thread) => row(thread))
            )}
          </>
        )}
      </nav>

      {menu &&
        createPortal(
          <div
            ref={menuRef}
            onContextMenu={(event) => event.preventDefault()}
            className="fixed z-[80] overflow-y-auto overflow-x-hidden rounded-lg border border-border bg-overlay p-1 shadow-xl shadow-black/10"
            style={{
              left: menu.left,
              top: menu.top,
              width: 224,
              maxHeight: "calc(100dvh - 16px)",
              overflowAnchor: "none",
            }}
          >
            {pane === "project" ? (
              <>
                <button
                  type="button"
                  onClick={() => setPane("root")}
                  className="mb-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12px] text-muted transition-colors hover:bg-elevated hover:text-text"
                >
                  <ChevronLeft size={13} /> {t("Project")}
                </button>
                <MenuItem
                  active={!menu.thread.projectId}
                  onSelect={() => void moveToProject(menu.thread, "")}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-faint" /> {t("No project")}
                </MenuItem>
                {projects.map((project) => (
                  <MenuItem
                    key={project.id}
                    active={project.id === menu.thread.projectId}
                    onSelect={() => void moveToProject(menu.thread, project.id)}
                  >
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: project.color }}
                    />
                    <span className="min-w-0 truncate">{project.name}</span>
                  </MenuItem>
                ))}
              </>
            ) : (
              <>
                {menu.thread.mine && (
                  <MenuItem onSelect={() => startRename(menu.thread)}>
                    <Pencil size={13} /> {t("Rename")}
                  </MenuItem>
                )}
                <MenuItem onSelect={() => void pin(menu.thread)}>
                  <Pin size={13} /> {t(menu.thread.pinnedAt ? "Unpin" : "Pin")}
                </MenuItem>
                <MenuItem onSelect={() => void markUnread(menu.thread)}>
                  <Dot size={13} /> {t("Mark as unread")}
                </MenuItem>
                {menu.thread.mine && (
                  <>
                    <div className="my-1 h-px bg-border" />
                    <MenuItem onSelect={() => setPane("project")}>
                      <Folder size={13} /> {t("Project")}
                      <ChevronRight size={13} className="ml-auto text-faint" />
                    </MenuItem>
                    <MenuItem onSelect={() => void toggleShared(menu.thread)}>
                      {menu.thread.visibility === "shared" ? (
                        <Lock size={13} />
                      ) : (
                        <Users size={13} />
                      )}
                      {t(menu.thread.visibility === "shared" ? "Make private" : "Share with workspace")}
                    </MenuItem>
                  </>
                )}
                <div className="my-1 h-px bg-border" />
                <MenuItem onSelect={() => void copyLink(menu.thread)}>
                  <Link2 size={13} /> {t("Copy link")}
                </MenuItem>
                <MenuItem onSelect={() => openInWindow(menu.thread)}>
                  <ExternalLink size={13} /> {t("Open in new window")}
                </MenuItem>
                {menu.thread.mine && (
                  <>
                    <div className="my-1 h-px bg-border" />
                    <MenuItem danger onSelect={() => void remove(menu.thread)}>
                      <Trash2 size={13} /> {t("Delete")}
                    </MenuItem>
                  </>
                )}
              </>
            )}
          </div>,
          document.body
        )}
    </aside>
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
}: {
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
  onStart: (text: string) => void;
}) {
  const t = useT();
  const [text, setText] = useState("");
  const submit = () => {
    const message = text.trim();
    if (!message || busy) return;
    onStart(message);
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-16 pt-6">
        <div className="w-full max-w-[720px]">
          <h1 className="text-center text-[32px] font-normal leading-tight tracking-[-0.015em] text-text">
            {t("What should we work on?")}
          </h1>
          <div className="mt-7">
            <Composer
              value={text}
              onChange={setText}
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
                  <ModelChip
                    options={options}
                    value={engine}
                    onChange={onEngine}
                    models={models}
                    model={model}
                    effort={effort}
                    onModel={onModel}
                    disabled={busy}
                  />
                </>
              }
            >
              <ProjectChip projects={projects} value={projectId} onChange={onProject} />
              <VisibilityChip value={visibility} onChange={onVisibility} />
            </Composer>
          </div>
          {error && <div className="mt-2 px-2 text-[12px] text-danger">{t(error)}</div>}
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {WORK_SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => setText(t(suggestion))}
                className="rounded-full border border-border px-3 py-1 text-[12px] text-muted transition-colors hover:bg-elevated hover:text-text"
              >
                {t(suggestion)}
              </button>
            ))}
          </div>
          <p className="mt-5 text-center text-[11.5px] text-faint">
            {t("The agent can change this project's tasks, comments and docs. Every change waits for your Allow.")}
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
  ready,
  engines,
  defaultEngine,
  models,
  skills,
  canManageSkills,
  codexDefault,
  projects,
  threads,
  active,
}: {
  workspaceId: string;
  ready: boolean;
  engines: AgentHarnessOption[];
  defaultEngine: AgentHarnessId;
  models: CodexModel[];
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
  const [drawer, setDrawer] = useState(false);
  const [draftProject, setDraftProject] = useState(projects[0]?.id ?? "");
  const [draftVisibility, setDraftVisibility] = useState<"private" | "shared">("private");
  const [draftEngine, setDraftEngine] = useState<AgentHarnessId>(defaultEngine);
  const [draftModel, setDraftModel] = useState(codexDefault.model);
  const [draftEffort, setDraftEffort] = useState(codexDefault.effort);
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
    const model = models.some((entry) => entry.slug === saved.model) ? saved.model! : fallback.model;
    const picked = models.find((entry) => entry.slug === model);
    const effort = picked?.efforts.some((level) => level.id === saved.effort)
      ? saved.effort!
      : (picked?.defaultEffort ?? fallback.effort);
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
    setDraftEngine(engine);
    rememberHarness(engine);
    rememberPrefs({ engine });
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

  async function start(text: string) {
    setStarting(true);
    setStartError(null);
    let result: Awaited<ReturnType<typeof startAgentThreadAction>>;
    try {
      result = await startAgentThreadAction(workspaceId, {
        projectId: draftProject,
        visibility: draftVisibility,
        engine: draftEngine,
        approval: draftApproval,
        // The model list currently describes Codex; other harnesses use their own defaults.
        ...(draftEngine === "codex" ? { model: draftModel, effort: draftEffort } : {}),
      });
    } catch {
      // A server action from a page opened before the server restarted rejects here; without
      // this the composer would sit on a dead Stop button and look like it cannot send.
      setStartError("Could not reach the server. Reload the window and try again.");
      setStarting(false);
      return;
    }
    if (!result.ok) {
      setStartError(result.error);
      setStarting(false);
      return;
    }
    // The first turn has to survive the navigation into the new thread, so it waits
    // here for Conversation to pick up on mount.
    try {
      sessionStorage.setItem(`tacos:agent:pending:${result.data.id}`, text);
    } catch {
      /* no storage — the thread still opens, the message just isn't pre-sent */
    }
    router.push(`/${workspaceId}/agent?thread=${result.data.id}`);
    router.refresh();
  }

  if (!ready) {
    return (
      <div
        className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto bg-bg p-6"
        data-testid="agent-harness-gate"
      >
        <div className="max-w-md rounded-xl border border-border bg-surface p-6">
          <div className="flex items-center gap-2 text-[14px] font-semibold">
            <Bot size={16} /> {t("Agent needs a ready harness")}
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            {t("Enable at least one local harness that is installed and ready. Open Settings to turn a harness on, install it, or sign in.")}
          </p>
          <ul className="mt-3 space-y-2">
            {engines.map((option) => (
              <li key={option.id} className="text-[12.5px] leading-relaxed">
                <span className="font-medium text-text">{option.label}</span>
                <span className="text-muted"> — {option.hint ? t(option.hint) : t("Available")}</span>
              </li>
            ))}
          </ul>
          <Link
            href={`/${workspaceId}/settings`}
            className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90"
          >
            <Settings2 size={13} /> {t("Open Settings")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="relative @container flex h-full min-h-0 w-full bg-bg">
      <ThreadSidebar
        workspaceId={workspaceId}
        threads={threads}
        projects={projects}
        activeId={active?.id}
        onNavigate={() => setDrawer(false)}
      />

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
        {active ? (
          // Keyed by thread so switching conversations starts from that thread's own state
          // instead of carrying the previous one's messages across.
          // New chat leaves the open thread. Start on the empty composer creates a new session id.
          <Conversation
            key={active.id}
            workspaceId={workspaceId}
            active={active}
            projects={projects}
            options={options}
            models={models}
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
              models={models}
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
              onStart={(text) => void start(text)}
            />
          </>
        )}
      </main>
    </div>
  );
}


function Conversation({
  workspaceId,
  active,
  projects,
  options,
  models,
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
  active: AgentThreadDetail;
  projects: ProjectOption[];
  options: AgentHarnessOption[];
  models: CodexModel[];
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
  const [messages, setMessages] = useState<UiMessage[]>(() => toUi(active));
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // Harness is a turn preference on this session. New chat creates a new session.
  const [engine, setEngine] = useState<AgentHarnessId>(() => {
    const fromThread = active.engine;
    if (options.some((option) => option.id === fromThread)) return fromThread as AgentHarnessId;
    return defaultEngine;
  });
  const [model, setModel] = useState(active.model || codexDefault.model);
  const [effort, setEffort] = useState(active.effort || codexDefault.effort);
  const [approvalMode, setApprovalMode] = useState<AgentApproval>(active.approval);

  // Harness is a turn pref on this session. Persist last-used. Do not open a new thread.
  async function chooseEngine(next: AgentHarnessId) {
    const before = engine;
    setEngine(next);
    rememberHarness(next);
    const result = await setAgentThreadEngineAction(workspaceId, active.id, next);
    if (!result.ok) {
      setEngine(before);
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
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement | null>(null);
  const box = useRef<HTMLTextAreaElement | null>(null);
  const pendingSent = useRef(false);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages, approval]);

  // A conversation created from the empty-state composer hands its first message over in
  // sessionStorage: creating the thread navigates away from the component that typed it.
  useEffect(() => {
    if (pendingSent.current) return;
    pendingSent.current = true;
    const key = `tacos:agent:pending:${active.id}`;
    let pending: string | null = null;
    try {
      pending = sessionStorage.getItem(key);
      if (pending) sessionStorage.removeItem(key);
    } catch {
      /* no storage — nothing to pre-send */
    }
    if (pending) void send(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function patchLastAssistant(patch: (message: UiMessage) => UiMessage) {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (!last || last.role !== "assistant") return prev;
      return [...prev.slice(0, -1), patch(last)];
    });
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
    setError(null);
    setApproval(null);
    setBusy(true);
    const startedAt = Date.now();
    setMessages((prev) => [
      ...prev,
      { id: `local-${startedAt}`, role: "user", content: message, steps: [] },
      { id: `streaming-${startedAt}`, role: "assistant", content: "", steps: [] },
    ]);
    const controller = new AbortController();
    abort.current = controller;
    try {
      await streamAiEdit(
        { workspaceId, action: "agent", threadId: active.id, engine, text: message },
        (delta) => patchLastAssistant((last) => ({ ...last, content: last.content + delta })),
        controller.signal,
        (frame) => {
          if (frame.type === "step") {
            patchLastAssistant((last) => {
              const key = frame.step.key || `${frame.step.kind}|${frame.step.title}`;
              const existing = last.steps.findIndex((step) => step.key === key);
              if (existing < 0) return { ...last, steps: [...last.steps, frame.step] };
              const steps = [...last.steps];
              steps[existing] = { ...steps[existing], ...frame.step };
              return { ...last, steps };
            });
          } else if (frame.type === "approval") {
            setApproval(frame.request);
          } else if (frame.type === "approval_done") {
            setApproval((current) => (current?.requestId === frame.requestId ? null : current));
          }
        }
      );
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && !last.content.trim() && last.steps.length === 0) {
          return prev.slice(0, -1);
        }
        return prev;
      });
      if (!aborted) setError(err instanceof Error ? err.message : "The agent could not answer");
    } finally {
      abort.current = null;
      setBusy(false);
      setApproval(null);
      router.refresh();
      box.current?.focus();
    }
  }

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
      }
      setApproval(null);
    } finally {
      setApprovalBusy(false);
    }
  }

  async function rename() {
    if (!active.mine) return;
    const next = window.prompt(t("Conversation name"), active.title || t("Untitled conversation"));
    if (!next || !next.trim()) return;
    const result = await renameAgentThreadAction(workspaceId, active.id, next.trim());
    if (!result.ok) setError(result.error);
    else router.refresh();
  }

  async function changeProject(projectId: string) {
    if (!active.mine || projectId === active.projectId) return;
    const result = await setAgentThreadProjectAction(workspaceId, active.id, projectId);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.refresh();
  }


  async function toggleVisibility() {
    if (!active.mine) return;
    const result = await setAgentThreadVisibilityAction(
      workspaceId,
      active.id,
      active.visibility === "shared" ? "private" : "shared"
    );
    if (!result.ok) setError(result.error);
    else router.refresh();
  }

  async function remove() {
    if (!active.mine) return;
    if (!window.confirm(t("Delete “{title}” and its history?", { title: active.title || t("this conversation") }))) return;
    const result = await deleteAgentThreadAction(workspaceId, active.id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push(`/${workspaceId}/agent`);
    router.refresh();
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="relative flex h-12 shrink-0 items-center justify-between gap-2 px-3">
        <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
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
          <span className="max-w-[180px] truncate">{active.projectName || "No project"}</span>
          {active.visibility === "shared" && <Users size={11} className="shrink-0 text-faint" />}
          {!active.mine && <span className="shrink-0 text-faint">· {active.createdByName}</span>}
        </div>
        <div className="absolute left-1/2 -translate-x-1/2">
        </div>
        <div className="flex shrink-0 items-center">
          {active.mine && (
            <Menu
              width={220}
              align="right"
              trigger={<MoreHorizontal size={16} />}
              triggerClassName="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-text"
            >
              {(close) => (
                <>
                  <MenuItem
                    onSelect={() => {
                      close();
                      void toggleVisibility();
                    }}
                  >
                    {active.visibility === "shared" ? <Lock size={13} /> : <Users size={13} />}
                    {t(active.visibility === "shared" ? "Make private" : "Share with workspace")}
                  </MenuItem>
                  <MenuItem
                    onSelect={() => {
                      close();
                      void rename();
                    }}
                  >
                    <Pencil size={13} /> {t("Rename")}
                  </MenuItem>
                  <MenuItem
                    danger
                    onSelect={() => {
                      close();
                      void remove();
                    }}
                  >
                    <Trash2 size={13} /> {t("Delete conversation")}
                  </MenuItem>
                </>
              )}
            </Menu>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 pb-8 pt-4">
          {messages.length === 0 && (
            <div className="pt-16 text-center">
              <h1 className="text-[28px] font-normal leading-tight tracking-[-0.015em]">
                {t("What should we work on?")}
              </h1>
              <p className="mt-2 text-[13px] text-muted">
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
                    className="rounded-full border border-border px-3 py-1 text-[12px] text-muted transition-colors hover:bg-elevated hover:text-text"
                  >
                    {t(suggestion)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message, index) =>
            message.role === "user" ? (
              <div key={message.id} className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-elevated px-3.5 py-2 text-[13.5px] leading-relaxed">
                  {message.content}
                </div>
              </div>
            ) : (
              <div key={message.id} className="min-w-0 text-[13.5px] leading-relaxed">
                {message.steps.length > 0 && (
                  <div className="mb-2 space-y-0.5">
                    {message.steps.map((step) => (
                      <StepLine key={step.key} step={step} />
                    ))}
                  </div>
                )}
                {message.content ? (
                  <Markdown source={message.content} />
                ) : busy && index === messages.length - 1 ? (
                  <span className="text-faint">{t("Thinking…")}</span>
                ) : null}
              </div>
            )
          )}

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
          {error && <div className="mb-2 px-1 text-[12px] text-danger">{t(error)}</div>}
          <Composer
            value={input}
            onChange={setInput}
            onSubmit={() => void send(input)}
            busy={busy}
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
                <ModelChip
                  options={options}
                  value={engine}
                  onChange={(next) => void chooseEngine(next)}
                  models={models}
                  model={model}
                  effort={effort}
                  onModel={(nextModel, nextEffort) => void changeModel(nextModel, nextEffort)}
                  disabled={busy || !active.mine}
                />
              </>
            }
          >
            {active.mine ? (
              <ProjectChip
                projects={projects}
                value={active.projectId}
                onChange={(projectId) => void changeProject(projectId)}
              />
            ) : (
              <span className="flex min-w-0 items-center gap-1.5 px-2 text-[12.5px] text-muted">
                <Folder size={13} className="shrink-0" />
                <span className="max-w-[170px] truncate">{active.projectName || "No project"}</span>
              </span>
            )}
          </Composer>
          <p className="mt-1.5 text-center text-[11px] text-faint">
            {t("The agent can create and edit tasks, comments, docs and the overview. Every change waits for your Allow.")}
          </p>
        </div>
      </div>
    </div>
  );
}
