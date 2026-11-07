"use client";

import { useState } from "react";
import { Bot, ChevronDown, Plus, Trash2, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Menu, MenuItem } from "@/components/menu";
import { createAgentAction, deleteAgentAction, updateAgentAction } from "@/app/agent-actions";
import { AGENT_APPROVALS, AGENT_HARNESS_IDS } from "@/lib/ai-constants";
import type { AgentView } from "@/lib/workspace-agents";
import type { Project } from "@/lib/issues";
import { useT } from "@/components/i18n-context";

const BUTTON =
  "rounded-md border border-border px-2 py-1 text-small text-muted transition-colors hover:bg-elevated hover:text-text disabled:opacity-40";
const INPUT =
  "w-full rounded-md border border-border bg-elevated/50 px-2.5 py-1.5 text-small text-text placeholder:text-faint focus:border-border-strong";
const SELECT = "w-full rounded-md border border-border bg-bg px-2 py-1.5 text-small text-text";
const FIELD = "block space-y-1 text-small text-muted";

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
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 text-body font-semibold">{t("Agents · {count}", { count: String(agents.length) })}</h2>
        <button
          type="button"
          onClick={() => {
            setDraft({ ...EMPTY });
            setError(null);
          }}
          disabled={!isAdmin || busy}
          data-testid="agent-create"
          className={`${BUTTON} inline-flex items-center gap-1`}
        >
          <Plus size={12} aria-hidden="true" /> {t("New agent")}
        </button>
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        {agents.length === 0 && <p className="px-4 py-3 text-small text-faint">{t("No agents yet.")}</p>}
        {agents.map((agent, index) => (
          <div
            key={agent.id}
            className={`flex flex-wrap items-center gap-3 px-4 py-3 ${index > 0 ? "border-t border-border" : ""}`}
            data-testid="agent-row"
            data-agent-id={agent.id}
            title={agent.description || undefined}
          >
            <Bot size={14} className="shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-body font-medium text-text">{agent.name}</span>
                {agent.personal && (
                  <span className="inline-flex h-[18px] items-center rounded-[5px] px-1.5 whitespace-nowrap bg-elevated text-caption text-faint">{t("Personal")}</span>
                )}
              </div>
              <p className="text-small text-faint">
                {agent.source === "api" ? t("Built-in API agent") : `${t("Local harness")} · ${agent.engine}`}
                {" · "}
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
            <span
              className={`inline-flex h-[18px] items-center rounded-[5px] px-1.5 whitespace-nowrap shrink-0 text-caption font-medium ${
                agent.enabled && agent.available ? "bg-accent/10 text-accent" : "bg-elevated text-faint"
              }`}
            >
              {agent.enabled ? (agent.available ? t("Available") : t("Not available")) : t("Off")}
            </span>
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
                    className="rounded-md p-1.5 text-danger transition-colors hover:bg-elevated disabled:opacity-40"
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
        <Modal open onClose={() => setDraft(null)} title={draft.id ? t("Edit agent") : t("New agent")} className="max-w-[480px] !p-0">
          <div data-testid="agent-form">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-lead font-semibold text-text">{draft.id ? t("Edit agent") : t("New agent")}</h2>
              <button type="button" aria-label={t("Close")} onClick={() => setDraft(null)} className="rounded-md p-1 text-faint hover:bg-elevated hover:text-text">
                <X size={14} />
              </button>
            </div>
            <div className="space-y-3 p-4">
              <label className={FIELD}>
                <span>{t("Agent name")}</span>
                <input
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  placeholder={t("e.g. Operations assistant")}
                  data-testid="agent-name"
                  className={INPUT}
                />
              </label>
              <div className={FIELD}>
                <span id="agent-source-label">{t("Source")}</span>
                <div role="group" aria-labelledby="agent-source-label" data-testid="agent-source" className="flex w-fit gap-px rounded-lg bg-elevated p-0.5">
                  {(
                    [
                      { id: "harness", label: t("Local harness") },
                      { id: "api", label: t("Built-in API agent") },
                    ] as const
                  ).map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={draft.source === option.id}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          source: option.id,
                          engine: option.id === "api" ? "api" : draft.engine === "api" ? "codex" : draft.engine,
                        })
                      }
                      className={`rounded-md px-2.5 py-1 text-small transition-colors ${
                        draft.source === option.id ? "bg-bg text-text shadow-sm" : "text-muted hover:text-text"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              {draft.source === "harness" && (
                <label className={FIELD}>
                  <span>{t("Harness")}</span>
                  <select
                    value={draft.engine}
                    onChange={(event) => setDraft({ ...draft, engine: event.target.value })}
                    data-testid="agent-engine"
                    className={SELECT}
                  >
                    {AGENT_HARNESS_IDS.map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className={FIELD}>
                <span>{t("Approval")}</span>
                <select
                  value={draft.approval}
                  onChange={(event) => setDraft({ ...draft, approval: event.target.value })}
                  data-testid="agent-approval"
                  className={SELECT}
                >
                  {AGENT_APPROVALS.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {t(entry.label)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={FIELD}>
                <span>{t("Model (leave empty for the default)")}</span>
                <input
                  value={draft.model}
                  onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                  className={INPUT}
                />
              </label>
              <label className={FIELD}>
                <span>{t("Description")}</span>
                <textarea
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  rows={2}
                  placeholder={t("What this agent is for")}
                  className={INPUT}
                />
              </label>
              <div className={FIELD}>
                <span>{t("Projects")}</span>
                <Menu
                  width={260}
                  triggerClassName={`${SELECT} flex items-center justify-between gap-2`}
                  className="block"
                  trigger={
                    <>
                      {draft.projectIds.length === 0
                        ? t("All projects")
                        : t("{count} projects", { count: String(draft.projectIds.length) })}
                      <ChevronDown size={12} className="text-faint" />
                    </>
                  }
                >
                  {() => (
                    <>
                      <MenuItem active={draft.projectIds.length === 0} onSelect={() => setDraft({ ...draft, projectIds: [] })}>
                        {t("All projects")}
                      </MenuItem>
                      {projects.map((project) => (
                        <MenuItem
                          key={project.id}
                          active={draft.projectIds.includes(project.id)}
                          onSelect={() =>
                            setDraft({
                              ...draft,
                              projectIds: draft.projectIds.includes(project.id)
                                ? draft.projectIds.filter((id) => id !== project.id)
                                : [...draft.projectIds, project.id],
                            })
                          }
                        >
                          {project.name}
                        </MenuItem>
                      ))}
                    </>
                  )}
                </Menu>
              </div>
              {error && <div className="text-small text-danger">{t(error)}</div>}
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
              <button type="button" onClick={() => setDraft(null)} className={BUTTON}>
                {t("Cancel")}
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={busy || !draft.name.trim()}
                data-testid="agent-save"
                className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[30px] rounded-lg px-2.5 text-small bg-accent font-medium text-white disabled:opacity-40 hover:bg-accent-hover"
              >
                {busy ? t("Saving…") : t("Save")}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {!draft && error && <div className="text-small text-danger">{t(error)}</div>}
      {!isAdmin && (
        <p className="text-small text-faint">{t("Only a workspace admin can add or change shared agents.")}</p>
      )}
    </section>
  );
}
