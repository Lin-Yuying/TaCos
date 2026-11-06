"use client";

import { useState } from "react";
import { Bot, Plus, Trash2 } from "lucide-react";
import { createAgentAction, deleteAgentAction, updateAgentAction } from "@/app/agent-actions";
import { AGENT_APPROVALS, AGENT_HARNESS_IDS } from "@/lib/ai-constants";
import type { AgentView } from "@/lib/workspace-agents";
import type { Project } from "@/lib/issues";
import { useT } from "@/components/i18n-context";

const BUTTON =
  "rounded-md border border-border px-2 py-1 text-small text-muted transition-colors hover:bg-elevated hover:text-text disabled:opacity-40";
const INPUT =
  "w-full rounded-md border border-border bg-elevated/50 px-2.5 py-1.5 text-small text-text placeholder:text-faint focus:border-border-strong";
const SELECT = "rounded-md border border-border bg-bg px-2 py-1 text-small text-text";

type Draft = {
  id: string | null;
  name: string;
  description: string;
  source: "harness" | "api";
  engine: string;
  model: string;
  approval: string;
  projectIds: string[];
};

const EMPTY: Draft = {
  id: null,
  name: "",
  description: "",
  source: "harness",
  engine: "codex",
  model: "",
  approval: "ask",
  projectIds: [],
};

// #79: named workspace agents plus each member's personal agent. Shared agents are
// admin-managed and project-scoped; a personal agent belongs to its creator.
export function AgentSettingsSection({
  workspaceId,
  agents: initial,
  projects,
  isAdmin,
}: {
  workspaceId: string;
  agents: AgentView[];
  projects: Project[];
  isAdmin: boolean;
}) {
  const t = useT();
  const [agents, setAgents] = useState(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function edit(agent: AgentView) {
    setDraft({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      source: agent.source,
      engine: agent.engine,
      model: agent.model,
      approval: agent.approval,
      projectIds: agent.projectIds,
    });
    setError(null);
  }

  async function save() {
    if (!draft || busy) return;
    setBusy(true);
    setError(null);
    const input = {
      name: draft.name,
      description: draft.description,
      source: draft.source,
      engine: draft.engine,
      model: draft.model,
      approval: draft.approval,
      projectIds: draft.projectIds,
    };
    const result = draft.id
      ? await updateAgentAction(workspaceId, draft.id, input)
      : await createAgentAction(workspaceId, input);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAgents((rows) => {
      const next = rows.filter((row) => row.id !== result.data.id);
      return [...next, result.data];
    });
    setDraft(null);
  }

  async function toggle(agent: AgentView) {
    setBusy(true);
    setError(null);
    const result = await updateAgentAction(workspaceId, agent.id, { enabled: !agent.enabled });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAgents((rows) => rows.map((row) => (row.id === result.data.id ? result.data : row)));
  }

  async function remove(agent: AgentView) {
    setBusy(true);
    setError(null);
    const result = await deleteAgentAction(workspaceId, agent.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAgents((rows) => rows.filter((row) => row.id !== agent.id));
    if (draft?.id === agent.id) setDraft(null);
  }

  return (
    <section className="space-y-3" data-testid="agent-settings">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-body font-semibold">{t("Agents")}</h2>
        <span className="rounded-full bg-elevated px-2 py-0.5 text-caption text-faint">
          {t("{count} agents", { count: String(agents.length) })}
        </span>
        <button
          type="button"
          onClick={() => {
            setDraft({ ...EMPTY });
            setError(null);
          }}
          disabled={!isAdmin || busy}
          data-testid="agent-create"
          className={`ml-auto ${BUTTON}`}
        >
          <span className="flex items-center gap-1">
            <Plus size={12} /> {t("New agent")}
          </span>
        </button>
      </div>
      <p className="text-body leading-relaxed text-muted">
        {t(
          "Agents are teammates you can delegate tasks to. Shared agents are admin-managed and scoped to projects; each member also has a personal agent."
        )}
      </p>
      <div className="overflow-hidden rounded-lg border border-border">
        {agents.length === 0 && <p className="px-4 py-3 text-small text-faint">{t("No agents yet.")}</p>}
        {agents.map((agent, index) => (
          <div
            key={agent.id}
            className={`flex flex-wrap items-start gap-3 px-4 py-3 ${index > 0 ? "border-t border-border" : ""}`}
            data-testid="agent-row"
            data-agent-id={agent.id}
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Bot size={13} className={agent.available ? "text-accent" : "text-faint"} />
                <span className="text-body font-medium text-text">{agent.name}</span>
                {agent.personal && (
                  <span className="rounded-full bg-elevated px-2 py-0.5 text-caption text-faint">{t("Personal")}</span>
                )}
                <span className="rounded-full bg-elevated px-2 py-0.5 font-mono text-caption text-faint">
                  {agent.source === "api" ? "api" : agent.engine}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-caption font-medium ${
                    agent.available ? "bg-accent/10 text-accent" : "bg-elevated text-faint"
                  }`}
                >
                  {agent.enabled ? (agent.available ? t("Available") : t("Not available")) : t("Off")}
                </span>
              </div>
              {agent.description && <p className="text-small text-muted">{agent.description}</p>}
              <p className="text-small text-faint">
                {agent.approval === "ask"
                  ? t("Every write asks")
                  : agent.approval === "auto"
                    ? t("Writes go through")
                    : t("Full access")}
                {" · "}
                {agent.projectIds.length === 0
                  ? t("All projects")
                  : t("{count} projects", { count: String(agent.projectIds.length) })}
              </p>
              {!agent.available && agent.availabilityHint && (
                <p className="text-small text-faint">{t(agent.availabilityHint)}</p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {((isAdmin && !agent.personal) || agent.mine) && (
                <>
                  <button type="button" disabled={busy} onClick={() => edit(agent)} className={BUTTON}>
                    {t("Edit")}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void toggle(agent)}
                    data-testid="agent-toggle"
                    className={BUTTON}
                  >
                    {agent.enabled ? t("Turn off") : t("Turn on")}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void remove(agent)}
                    aria-label={t("Delete {name}", { name: agent.name })}
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
        <div className="space-y-2 rounded-lg border border-border p-3" data-testid="agent-form">
          <div className="flex flex-wrap gap-2">
            <input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              placeholder={t("Agent name")}
              aria-label={t("Agent name")}
              data-testid="agent-name"
              className={INPUT}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              value={draft.source}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  source: event.target.value as Draft["source"],
                  engine: event.target.value === "api" ? "api" : draft.engine === "api" ? "codex" : draft.engine,
                })
              }
              aria-label={t("Source")}
              data-testid="agent-source"
              className={SELECT}
            >
              <option value="harness">{t("Local harness")}</option>
              <option value="api">{t("Built-in API agent")}</option>
            </select>
            {draft.source === "harness" && (
              <select
                value={draft.engine}
                onChange={(event) => setDraft({ ...draft, engine: event.target.value })}
                aria-label={t("Harness")}
                data-testid="agent-engine"
                className={SELECT}
              >
                {AGENT_HARNESS_IDS.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            )}
            <select
              value={draft.approval}
              onChange={(event) => setDraft({ ...draft, approval: event.target.value })}
              aria-label={t("Approval")}
              data-testid="agent-approval"
              className={SELECT}
            >
              {AGENT_APPROVALS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {t(entry.label)}
                </option>
              ))}
            </select>
            <input
              value={draft.model}
              onChange={(event) => setDraft({ ...draft, model: event.target.value })}
              placeholder={t("Model (leave empty for the default)")}
              aria-label={t("Model")}
              className={`${SELECT} min-w-[220px] flex-1`}
            />
          </div>
          <textarea
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            rows={2}
            placeholder={t("What this agent is for")}
            aria-label={t("Description")}
            className={INPUT}
          />
          <fieldset className="space-y-1">
            <legend className="text-small text-muted">{t("Projects")}</legend>
            <label className="flex items-center gap-1.5 text-small text-text">
              <input
                type="checkbox"
                checked={draft.projectIds.length === 0}
                onChange={() => setDraft({ ...draft, projectIds: [] })}
              />
              {t("All projects")}
            </label>
            {projects.map((project) => (
              <label key={project.id} className="flex items-center gap-1.5 text-small text-text">
                <input
                  type="checkbox"
                  checked={draft.projectIds.includes(project.id)}
                  onChange={(event) => {
                    const next = event.target.checked
                      ? [...draft.projectIds, project.id]
                      : draft.projectIds.filter((id) => id !== project.id);
                    setDraft({ ...draft, projectIds: next });
                  }}
                />
                {project.name}
              </label>
            ))}
          </fieldset>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || !draft.name.trim()}
              data-testid="agent-save"
              className="rounded-md bg-accent px-3 py-1.5 text-small font-medium text-white disabled:opacity-40"
            >
              {busy ? t("Saving…") : t("Save")}
            </button>
            <button type="button" onClick={() => setDraft(null)} className={BUTTON}>
              {t("Cancel")}
            </button>
          </div>
        </div>
      )}
      {error && <div className="text-small text-danger">{t(error)}</div>}
      {!isAdmin && (
        <p className="text-small text-faint">{t("Only a workspace admin can add or change shared agents.")}</p>
      )}
    </section>
  );
}
