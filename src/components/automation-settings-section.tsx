"use client";

// #80: Settings › Automations. Owner/admin create or edit rules from a template or from
// scratch, dry-run them against a task, and read the run log. Members see the enabled
// rules and the runs their own actions triggered.
import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useUI } from "@/components/ui-context";
import { useLocale, useT } from "@/components/i18n-context";
import { safeAction } from "@/lib/ui/safe-action";
import {
  createAutomationRuleAction,
  deleteAutomationRuleAction,
  dryRunAutomationRuleAction,
  setAutomationRuleEnabledAction,
  updateAutomationRuleAction,
} from "@/app/automation-actions";
import {
  AUTOMATION_ACTION_KINDS,
  AUTOMATION_CONDITION_KINDS,
  AUTOMATION_TEMPLATES,
  AUTOMATION_TRIGGER_TYPES,
  DUE_SOON_DAY_OPTIONS,
  automationTemplateDraft,
  defaultAction,
  defaultCondition,
  serializeAutomationTrigger,
  triggerShortSummary,
  triggerSummary,
  type AutomationAction,
  type AutomationActionKind,
  type AutomationCondition,
  type AutomationConditionKind,
  type AutomationDryRun,
  type AutomationTriggerSpec,
  type AutomationTriggerType,
} from "@/lib/automations/shared";
import type {
  AutomationAuditView,
  AutomationRuleView,
  AutomationRunView,
} from "@/lib/automations/store";
import { PRIORITY_META, STATUS_META, type Priority, type Status } from "@/lib/constants";
import type { Label, Member, Project } from "@/lib/issues";
import type { AgentView } from "@/lib/workspace-agents";
import { timeAgo } from "@/lib/format";

const BUTTON =
  "rounded-md border border-border px-2 py-1 text-small text-muted transition-colors hover:bg-elevated hover:text-text disabled:opacity-40";
const INPUT =
  "w-full rounded-md border border-border bg-elevated/50 px-2.5 py-1.5 text-small text-text placeholder:text-faint focus:border-border-strong";
const SELECT = "rounded-md border border-border bg-bg px-2 py-1 text-small text-text";
const LABEL = "space-y-1 text-small text-muted";

type Draft = {
  id: string | null;
  name: string;
  enabled: boolean;
  trigger: AutomationTriggerSpec;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
};

function emptyDraft(ownerId: string): Draft {
  return {
    id: null,
    name: "",
    enabled: true,
    trigger: { type: "task.created", days: null },
    conditions: [],
    actions: [defaultAction("add_comment", ownerId)],
  };
}

function runStatusLabel(status: string, t: ReturnType<typeof useT>): string {
  if (status === "success") return t("Succeeded");
  if (status === "partial") return t("Partly succeeded");
  if (status === "running") return t("Running");
  return t("Failed");
}

function auditActionLabel(action: string, t: ReturnType<typeof useT>): string {
  if (action === "created") return t("Created");
  if (action === "updated") return t("Updated");
  if (action === "enabled") return t("Enabled");
  if (action === "disabled") return t("Disabled");
  if (action === "deleted") return t("Deleted");
  return action;
}

export function AutomationSettingsSection({
  workspaceId,
  currentUserId,
  canManage,
  rules,
  runs,
  audit,
  members,
  projects,
  labels,
  agents,
}: {
  workspaceId: string;
  currentUserId: string;
  canManage: boolean;
  rules: AutomationRuleView[];
  runs: AutomationRunView[];
  audit: AutomationAuditView[];
  members: Member[];
  projects: Project[];
  labels: Array<Label & { issueCount: number }>;
  agents: AgentView[];
}) {
  const t = useT();
  const locale = useLocale();
  const { confirm } = useUI();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dryTask, setDryTask] = useState("");
  const [dryRun, setDryRun] = useState<AutomationDryRun | null>(null);
  const [dryBusy, setDryBusy] = useState(false);
  const sharedAgents = agents.filter((agent) => !agent.personal);
  const lastRun = draft?.id ? runs.find((run) => run.ruleId === draft.id) ?? null : null;

  function start(draft: Draft) {
    setDraft(draft);
    setDryRun(null);
    setDryTask("");
    setError(null);
    setNotice(null);
  }

  function beginCreate() {
    start(emptyDraft(currentUserId));
  }

  function beginTemplate(id: string) {
    const template = automationTemplateDraft(id, currentUserId);
    if (!template) return;
    start({
      id: null,
      enabled: true,
      name: template.name,
      trigger: template.trigger,
      conditions: template.conditions,
      actions: template.actions,
    });
  }

  function beginEdit(rule: AutomationRuleView) {
    start({
      id: rule.id,
      name: rule.name,
      enabled: rule.enabled,
      trigger: rule.trigger,
      conditions: rule.conditions,
      actions: rule.actions,
    });
  }

  function patchDraft(patch: Partial<Draft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setDryRun(null);
  }

  function setAction(index: number, action: AutomationAction) {
    setDraft((current) =>
      current
        ? { ...current, actions: current.actions.map((row, at) => (at === index ? action : row)) }
        : current
    );
    setDryRun(null);
  }

  function removeAction(index: number) {
    setDraft((current) =>
      current ? { ...current, actions: current.actions.filter((_, at) => at !== index) } : current
    );
    setDryRun(null);
  }

  function moveAction(index: number, delta: -1 | 1) {
    setDraft((current) => {
      if (!current) return current;
      const to = index + delta;
      if (to < 0 || to >= current.actions.length) return current;
      const actions = [...current.actions];
      [actions[index], actions[to]] = [actions[to], actions[index]];
      return { ...current, actions };
    });
    setDryRun(null);
  }

  function setCondition(index: number, condition: AutomationCondition) {
    setDraft((current) =>
      current
        ? {
            ...current,
            conditions: current.conditions.map((row, at) => (at === index ? condition : row)),
          }
        : current
    );
    setDryRun(null);
  }

  async function save() {
    if (!draft || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const input = {
      name: draft.name,
      trigger: serializeAutomationTrigger(draft.trigger),
      conditions: draft.conditions,
      actions: draft.actions,
    };
    const result = draft.id
      ? await safeAction(async () => updateAutomationRuleAction(workspaceId, draft.id!, input))
      : await safeAction(async () => createAutomationRuleAction(workspaceId, input));
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDraft(null);
    setNotice(draft.id ? t("Rule saved.") : t("Rule created."));
  }

  async function toggle(rule: AutomationRuleView) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await safeAction(async () =>
      setAutomationRuleEnabledAction(workspaceId, rule.id, !rule.enabled)
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(result.data.enabled ? t("Rule enabled.") : t("Rule disabled."));
  }

  async function remove(rule: AutomationRuleView) {
    if (busy) return;
    if (!(await confirm(t("Delete the rule “{name}”? Its run log stays.", { name: rule.name })))) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await safeAction(async () => deleteAutomationRuleAction(workspaceId, rule.id));
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (draft?.id === rule.id) setDraft(null);
    setNotice(t("Rule deleted."));
  }

  async function runDryRun(mode: "task" | "last") {
    if (!draft?.id || dryBusy) return;
    const target = mode === "last" ? { runId: lastRun?.id } : { issueId: dryTask.trim() };
    if (mode === "task" && !target.issueId) {
      setError(t("Enter a task identifier or id."));
      return;
    }
    if (mode === "last" && !target.runId) {
      setError(t("This rule has no run yet."));
      return;
    }
    setDryBusy(true);
    setError(null);
    const result = await safeAction(async () =>
      dryRunAutomationRuleAction(workspaceId, draft.id!, target)
    );
    setDryBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDryRun(result.data);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-elevated px-2 py-0.5 text-caption text-faint">
          {t("{count} rules", { count: String(rules.length) })}
        </span>
        {canManage && (
          <button
            type="button"
            onClick={beginCreate}
            disabled={busy}
            data-testid="automation-create"
            className={`ml-auto ${BUTTON}`}
          >
            <span className="flex items-center gap-1">
              <Plus size={12} /> {t("New rule")}
            </span>
          </button>
        )}
      </div>
      <p className="text-body leading-relaxed text-muted">
        {t(
          "When a trigger happens, matching rules run their actions in order inside TaCos. Actions fail independently and stay in the run log."
        )}
      </p>
      {!canManage && (
        <p className="text-small text-faint">
          {t("You see enabled rules and the runs your own actions triggered. The owner or an admin manages rules.")}
        </p>
      )}

      {canManage && (
        <div className="flex flex-wrap items-center gap-2 text-small text-muted" data-testid="automation-templates">
          <span>{t("Start from a template")}</span>
          {AUTOMATION_TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => beginTemplate(template.id)}
              disabled={busy}
              data-testid={`automation-template-${template.id}`}
              title={t(template.description)}
              className={BUTTON}
            >
              {t(template.name)}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div role="alert" data-testid="automation-error" className="text-small text-danger">
          {t(error)}
        </div>
      )}
      {notice && (
        <div data-testid="automation-notice" className="text-small text-muted">
          {t(notice)}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border">
        {rules.length === 0 && (
          <p className="px-4 py-3 text-small text-faint">{t("No rules yet.")}</p>
        )}
        {rules.map((rule, index) => (
          <div
            key={rule.id}
            data-testid="automation-row"
            data-rule-id={rule.id}
            className={`flex flex-wrap items-start gap-3 px-4 py-3 ${index > 0 ? "border-t border-border" : ""}`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-body font-medium" data-testid="automation-rule-name">
                  {rule.name}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-caption ${
                    rule.enabled ? "bg-accent/10 text-accent" : "bg-elevated text-faint"
                  }`}
                  data-testid="automation-rule-state"
                >
                  {rule.enabled ? t("On") : t("Off")}
                </span>
                <span className="text-caption text-faint">
                  v{rule.version} · {rule.createdByName}
                </span>
              </div>
              <p className="text-small text-muted">
                {t(triggerSummary(rule.trigger).key, triggerSummary(rule.trigger).params)}
                {" · "}
                {t("{count} actions", { count: String(rule.actions.length) })}
                {" · "}
                {rule.lastRunAt
                  ? t("Last run {when}", { when: timeAgo(rule.lastRunAt, locale) })
                  : t("Never run")}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {canManage && (
                <>
                  <button
                    type="button"
                    onClick={() => void toggle(rule)}
                    disabled={busy}
                    aria-label={rule.enabled ? t("Disable rule") : t("Enable rule")}
                    data-testid="automation-enable"
                    aria-pressed={rule.enabled}
                    className={BUTTON}
                  >
                    {rule.enabled ? t("Disable") : t("Enable")}
                  </button>
                  <button
                    type="button"
                    onClick={() => beginEdit(rule)}
                    disabled={busy}
                    data-testid="automation-edit"
                    className={BUTTON}
                  >
                    {t("Edit")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(rule)}
                    disabled={busy}
                    aria-label={t("Delete rule")}
                    data-testid="automation-delete"
                    className={BUTTON}
                  >
                    <Trash2 size={12} />
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {draft && (
        <div
          className="space-y-3 rounded-lg border border-border bg-surface/60 p-4"
          data-testid="automation-editor"
        >
          <div className="text-body font-medium">{draft.id ? t("Edit rule") : t("New rule")}</div>
          <label className={LABEL}>
            <span>{t("Rule name")}</span>
            <input
              value={draft.name}
              onChange={(event) => patchDraft({ name: event.target.value })}
              placeholder={t("Rule name")}
              data-testid="automation-name"
              className={INPUT}
            />
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={LABEL}>
              <span>{t("Trigger")}</span>
              <select
                value={draft.trigger.type}
                onChange={(event) => {
                  const type = event.target.value as AutomationTriggerType;
                  patchDraft({
                    trigger: { type, days: type === "task.due_soon" ? 2 : null },
                  });
                }}
                data-testid="automation-trigger"
                className={SELECT}
              >
                {AUTOMATION_TRIGGER_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(triggerSummary({ type, days: 2 }).key, { days: "2" })}
                  </option>
                ))}
              </select>
            </label>
            {draft.trigger.type === "task.due_soon" && (
              <label className={LABEL}>
                <span>{t("Days before the due date")}</span>
                <select
                  value={String(draft.trigger.days ?? 2)}
                  onChange={(event) =>
                    patchDraft({ trigger: { type: "task.due_soon", days: Number(event.target.value) } })
                  }
                  data-testid="automation-due-days"
                  className={SELECT}
                >
                  {DUE_SOON_DAY_OPTIONS.map((days) => (
                    <option key={days} value={String(days)}>
                      {t("{count} days", { count: String(days) })}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <fieldset className="space-y-2">
            <legend className="text-small font-medium text-muted">{t("Conditions")}</legend>
            {draft.conditions.length === 0 && (
              <p className="text-small text-faint">{t("No conditions: every event of this trigger matches.")}</p>
            )}
            {draft.conditions.map((condition, index) => (
              <ConditionEditor
                key={index}
                condition={condition}
                projects={projects}
                labels={labels}
                onChange={(next) => setCondition(index, next)}
                onRemove={() =>
                  patchDraft({ conditions: draft.conditions.filter((_, at) => at !== index) })
                }
              />
            ))}
            <button
              type="button"
              onClick={() =>
                patchDraft({
                  conditions: [
                    ...draft.conditions,
                    defaultCondition("project", projects[0]?.id ?? ""),
                  ],
                })
              }
              data-testid="automation-add-condition"
              className={BUTTON}
            >
              <span className="flex items-center gap-1">
                <Plus size={12} /> {t("Add condition")}
              </span>
            </button>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-small font-medium text-muted">{t("Actions")}</legend>
            {draft.actions.map((action, index) => (
              <ActionEditor
                key={index}
                action={action}
                members={members}
                agents={sharedAgents}
                onChange={(next) => setAction(index, next)}
                onRemove={() => removeAction(index)}
                onMove={(delta) => moveAction(index, delta)}
                first={index === 0}
                last={index === draft.actions.length - 1}
              />
            ))}
            <button
              type="button"
              onClick={() =>
                patchDraft({
                  actions: [...draft.actions, defaultAction("add_comment", currentUserId)],
                })
              }
              data-testid="automation-add-action"
              className={BUTTON}
            >
              <span className="flex items-center gap-1">
                <Plus size={12} /> {t("Add action")}
              </span>
            </button>
          </fieldset>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || !draft.name.trim()}
              data-testid="automation-save"
              className="rounded-md bg-accent px-3 py-1.5 text-body font-medium text-white hover:bg-accent-hover disabled:opacity-40"
            >
              {t("Save rule")}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setDryRun(null);
              }}
              data-testid="automation-cancel"
              className={BUTTON}
            >
              {t("Cancel")}
            </button>
          </div>

          <div className="space-y-2 rounded-md border border-border bg-bg p-3" data-testid="automation-dry-run">
            <div className="text-small font-medium text-muted">{t("Dry run")}</div>
            <p className="text-small text-faint">
              {t(
                "Evaluate the saved rule against a task or its last event. Nothing is executed."
              )}
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <label className={LABEL}>
                <span>{t("Task identifier or id")}</span>
                <input
                  value={dryTask}
                  onChange={(event) => setDryTask(event.target.value)}
                  placeholder="TAC-12"
                  data-testid="automation-dry-task"
                  className={INPUT}
                />
              </label>
              <button
                type="button"
                onClick={() => void runDryRun("task")}
                disabled={dryBusy || !draft.id}
                data-testid="automation-dry-run-task"
                className={BUTTON}
              >
                {t("Dry run")}
              </button>
              <button
                type="button"
                onClick={() => void runDryRun("last")}
                disabled={dryBusy || !lastRun}
                data-testid="automation-dry-run-last"
                className={BUTTON}
              >
                {t("Use last event")}
              </button>
            </div>
            {!draft.id && (
              <p className="text-small text-faint">{t("Save the rule before a dry run.")}</p>
            )}
            {dryRun && (
              <div data-testid="automation-dry-result" className="space-y-1 text-small">
                <div className="font-medium">
                  {dryRun.matched ? t("This rule would run.") : t("This rule would not run.")}
                </div>
                {dryRun.issue && (
                  <p className="text-muted">
                    {dryRun.issue.identifier} · {dryRun.issue.title}
                  </p>
                )}
                {dryRun.conditions.length > 0 && (
                  <ul className="space-y-1">
                    {dryRun.conditions.map((condition, index) => (
                      <li key={index} className="text-muted">
                        {condition.passed ? t("Pass") : t("Fail")}:{" "}
                        {t(condition.text.key, condition.text.params)}
                      </li>
                    ))}
                  </ul>
                )}
                {dryRun.actions.length > 0 && (
                  <ul className="space-y-1">
                    {dryRun.actions.map((action, index) => (
                      <li key={index} className="text-muted">
                        {index + 1}. {t(action.key, action.params)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="space-y-2" data-testid="automation-run-log">
        <h3 className="text-body font-semibold">{t("Run log")}</h3>
        {runs.length === 0 ? (
          <p className="text-small text-faint">{t("No runs yet.")}</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            {runs.map((run, index) => (
              <div
                key={run.id}
                data-testid="automation-run"
                className={`space-y-1 px-4 py-2 ${index > 0 ? "border-t border-border" : ""}`}
              >
                <div className="flex flex-wrap items-center gap-2 text-small">
                  <span className="font-medium">{run.ruleName}</span>
                  <span className="text-faint">
                    {t(triggerShortSummary(run.trigger).key, triggerShortSummary(run.trigger).params)}
                  </span>
                  {run.issueIdentifier && <span className="text-faint">{run.issueIdentifier}</span>}
                  <span
                    className={
                      run.status === "failed"
                        ? "text-danger"
                        : run.status === "partial"
                          ? "text-muted"
                          : "text-muted"
                    }
                    data-testid="automation-run-status"
                  >
                    {runStatusLabel(run.status, t)}
                  </span>
                  <span className="text-faint">
                    {run.durationMs} ms · {timeAgo(run.createdAt, locale)} · {run.triggeredByName}
                  </span>
                </div>
                {run.actionResults.length > 0 && (
                  <p className="text-caption text-faint">
                    {run.actionResults
                      .map(
                        (result) =>
                          `${result.index + 1}. ${t(
                            result.status === "ok"
                              ? "ok"
                              : result.status === "skipped"
                                ? "skipped"
                                : "failed"
                          )}`
                      )
                      .join(" · ")}
                  </p>
                )}
                {run.error && (
                  <p role="alert" className="text-small text-danger">
                    {run.error}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {canManage && audit.length > 0 && (
        <div className="space-y-2" data-testid="automation-audit">
          <h3 className="text-body font-semibold">{t("Rule changes")}</h3>
          <ul className="space-y-1 text-small text-muted">
            {audit.map((row) => (
              <li key={row.id}>
                {row.ruleName} · {auditActionLabel(row.action, t)} · {row.actorName} ·{" "}
                {timeAgo(row.createdAt, locale)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ConditionEditor({
  condition,
  projects,
  labels,
  onChange,
  onRemove,
}: {
  condition: AutomationCondition;
  projects: Project[];
  labels: Label[];
  onChange: (condition: AutomationCondition) => void;
  onRemove: () => void;
}) {
  const t = useT();
  return (
    <div
      className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-bg p-2"
      data-testid="automation-condition"
    >
      <label className={LABEL}>
        <span>{t("Condition")}</span>
        <select
          value={condition.kind}
          onChange={(event) =>
            onChange(defaultCondition(event.target.value as AutomationConditionKind, projects[0]?.id ?? ""))
          }
          data-testid="automation-condition-kind"
          className={SELECT}
        >
          {AUTOMATION_CONDITION_KINDS.map((entry) => (
            <option key={entry.kind} value={entry.kind}>
              {t(entry.label)}
            </option>
          ))}
        </select>
      </label>
      {condition.kind === "project" && (
        <label className={LABEL}>
          <span>{t("Project")}</span>
          <select
            value={condition.projectId}
            onChange={(event) => onChange({ kind: "project", projectId: event.target.value })}
            data-testid="automation-condition-project"
            className={SELECT}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {condition.kind === "label" && (
        <label className={LABEL}>
          <span>{t("Label")}</span>
          <select
            value={condition.label}
            onChange={(event) => onChange({ kind: "label", label: event.target.value })}
            data-testid="automation-condition-label"
            className={SELECT}
          >
            <option value="">{t("Choose a label")}</option>
            {labels.map((label) => (
              <option key={label.id} value={label.name}>
                {label.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {condition.kind === "priority" && (
        <label className={LABEL}>
          <span>{t("Priority")}</span>
          <select
            value={String(condition.priority)}
            onChange={(event) =>
              onChange({ kind: "priority", priority: Number(event.target.value) as Priority })
            }
            data-testid="automation-condition-priority"
            className={SELECT}
          >
            {([0, 1, 2, 3, 4] as Priority[]).map((priority) => (
              <option key={priority} value={String(priority)}>
                {t(PRIORITY_META[priority].label)}
              </option>
            ))}
          </select>
        </label>
      )}
      {condition.kind === "assignee" && (
        <label className={LABEL}>
          <span>{t("Assignee")}</span>
          <select
            value={condition.present ? "present" : "absent"}
            onChange={(event) =>
              onChange({ kind: "assignee", present: event.target.value === "present" })
            }
            data-testid="automation-condition-assignee"
            className={SELECT}
          >
            <option value="present">{t("Has an assignee")}</option>
            <option value="absent">{t("Has no assignee")}</option>
          </select>
        </label>
      )}
      {condition.kind === "status" && (
        <label className={LABEL}>
          <span>{t("Status")}</span>
          <select
            value={condition.status}
            onChange={(event) => onChange({ kind: "status", status: event.target.value as Status })}
            data-testid="automation-condition-status"
            className={SELECT}
          >
            {(Object.keys(STATUS_META) as Status[]).map((status) => (
              <option key={status} value={status}>
                {t(STATUS_META[status].label)}
              </option>
            ))}
          </select>
        </label>
      )}
      {condition.kind === "text" && (
        <label className={LABEL}>
          <span>{t("Text contains")}</span>
          <input
            value={condition.contains}
            onChange={(event) => onChange({ kind: "text", contains: event.target.value })}
            data-testid="automation-condition-text"
            className={INPUT}
          />
        </label>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={t("Remove condition")}
        data-testid="automation-remove-condition"
        className={BUTTON}
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

function ActionEditor({
  action,
  members,
  agents,
  onChange,
  onRemove,
  onMove,
  first,
  last,
}: {
  action: AutomationAction;
  members: Member[];
  agents: AgentView[];
  onChange: (action: AutomationAction) => void;
  onRemove: () => void;
  onMove: (delta: -1 | 1) => void;
  first: boolean;
  last: boolean;
}) {
  const t = useT();
  const selectedMembers = "assigneeIds" in action ? action.assigneeIds : "userIds" in action ? action.userIds : [];
  return (
    <div
      className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-bg p-2"
      data-testid="automation-action"
    >
      <label className={LABEL}>
        <span>{t("Action")}</span>
        <select
          value={action.kind}
          onChange={(event) =>
            onChange(defaultAction(event.target.value as AutomationActionKind, members[0]?.id ?? ""))
          }
          data-testid="automation-action-kind"
          className={SELECT}
        >
          {AUTOMATION_ACTION_KINDS.map((entry) => (
            <option key={entry.kind} value={entry.kind}>
              {t(entry.label)}
            </option>
          ))}
        </select>
      </label>
      {action.kind === "set_status" && (
        <label className={LABEL}>
          <span>{t("Status")}</span>
          <select
            value={action.status}
            onChange={(event) => onChange({ kind: "set_status", status: event.target.value as Status })}
            data-testid="automation-action-status"
            className={SELECT}
          >
            {(Object.keys(STATUS_META) as Status[]).map((status) => (
              <option key={status} value={status}>
                {t(STATUS_META[status].label)}
              </option>
            ))}
          </select>
        </label>
      )}
      {(action.kind === "set_assignees" || action.kind === "notify_users") && (
        <label className={LABEL}>
          <span>{action.kind === "set_assignees" ? t("Assignees") : t("People to notify")}</span>
          <select
            multiple
            size={Math.min(4, Math.max(1, members.length))}
            value={selectedMembers}
            onChange={(event) => {
              const chosen = [...event.target.selectedOptions].map((option) => option.value);
              if (action.kind === "set_assignees") {
                onChange({ kind: "set_assignees", assigneeIds: chosen });
              } else {
                onChange({ kind: "notify_users", userIds: chosen, message: action.message });
              }
            }}
            data-testid={action.kind === "set_assignees" ? "automation-action-assignees" : "automation-action-notify"}
            className="min-w-40 rounded-md border border-border bg-bg px-2 py-1 text-small text-text"
          >
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.displayName}
              </option>
            ))}
          </select>
        </label>
      )}
      {action.kind === "notify_users" && (
        <label className={LABEL}>
          <span>{t("Notification message")}</span>
          <input
            value={action.message}
            onChange={(event) =>
              onChange({ kind: "notify_users", userIds: action.userIds, message: event.target.value })
            }
            data-testid="automation-action-message"
            className={INPUT}
          />
        </label>
      )}
      {action.kind === "set_labels" && (
        <label className={LABEL}>
          <span>{t("Labels, comma separated")}</span>
          <input
            value={action.labels.join(", ")}
            onChange={(event) =>
              onChange({
                kind: "set_labels",
                labels: event.target.value
                  .split(",")
                  .map((name) => name.trim())
                  .filter(Boolean),
              })
            }
            data-testid="automation-action-labels"
            className={INPUT}
          />
        </label>
      )}
      {action.kind === "add_comment" && (
        <label className={LABEL}>
          <span>{t("Comment")}</span>
          <textarea
            value={action.body}
            onChange={(event) => onChange({ kind: "add_comment", body: event.target.value })}
            rows={2}
            data-testid="automation-action-comment"
            className={INPUT}
          />
        </label>
      )}
      {action.kind === "delegate_agent" && (
        <>
          <label className={LABEL}>
            <span>{t("Agent")}</span>
            <select
              value={action.agentId}
              onChange={(event) =>
                onChange({ kind: "delegate_agent", agentId: event.target.value, note: action.note })
              }
              data-testid="automation-action-agent"
              className={SELECT}
            >
              <option value="">{t("Choose an agent")}</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL}>
            <span>{t("Note to the agent")}</span>
            <input
              value={action.note}
              onChange={(event) =>
                onChange({ kind: "delegate_agent", agentId: action.agentId, note: event.target.value })
              }
              data-testid="automation-action-note"
              className={INPUT}
            />
          </label>
        </>
      )}
      {action.kind === "create_document" && (
        <>
          <label className={LABEL}>
            <span>{t("Document title")}</span>
            <input
              value={action.title}
              onChange={(event) =>
                onChange({ kind: "create_document", title: event.target.value, doc: action.doc })
              }
              data-testid="automation-action-doc-title"
              className={INPUT}
            />
          </label>
          <label className={LABEL}>
            <span>{t("Document text")}</span>
            <textarea
              value={action.doc}
              onChange={(event) =>
                onChange({ kind: "create_document", title: action.title, doc: event.target.value })
              }
              rows={2}
              data-testid="automation-action-doc-body"
              className={INPUT}
            />
          </label>
        </>
      )}
      {action.kind === "create_task" && (
        <>
          <label className={LABEL}>
            <span>{t("Task title")}</span>
            <input
              value={action.title}
              onChange={(event) =>
                onChange({
                  kind: "create_task",
                  title: event.target.value,
                  description: action.description,
                })
              }
              data-testid="automation-action-task-title"
              className={INPUT}
            />
          </label>
          <label className={LABEL}>
            <span>{t("Task description")}</span>
            <textarea
              value={action.description}
              onChange={(event) =>
                onChange({
                  kind: "create_task",
                  title: action.title,
                  description: event.target.value,
                })
              }
              rows={2}
              data-testid="automation-action-task-description"
              className={INPUT}
            />
          </label>
        </>
      )}
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={() => onMove(-1)}
          disabled={first}
          aria-label={t("Move action up")}
          data-testid="automation-action-up"
          className={BUTTON}
        >
          <ArrowUp size={12} />
        </button>
        <button
          type="button"
          onClick={() => onMove(1)}
          disabled={last}
          aria-label={t("Move action down")}
          data-testid="automation-action-down"
          className={BUTTON}
        >
          <ArrowDown size={12} />
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={t("Remove action")}
          data-testid="automation-remove-action"
          className={BUTTON}
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}
