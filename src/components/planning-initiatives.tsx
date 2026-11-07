"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Search, Trash2, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useT, useLocale } from "@/components/i18n-context";
import { useUI } from "@/components/ui-context";
import {
  INITIATIVE_STATUSES,
  INITIATIVE_STATUS_META,
  PRIORITY_META,
  type InitiativeStatus,
  type Priority,
} from "@/lib/constants";
import type { Label } from "@/lib/issues";
import type { Initiative, InitiativeInput } from "@/lib/planning/initiatives";
import { formatDay } from "@/lib/planning/dates";
import {
  FieldLabel,
  Pill,
  PriorityText,
  inputClass,
  primaryButton,
  quietButton,
  selectClass,
} from "@/components/planning-ui";
import {
  createInitiativeAction,
  deleteInitiativeAction,
  updateInitiativeAction,
} from "@/app/planning-actions";

type MemberOption = { id: string; displayName: string; avatar: string | null };
type ProjectOption = { id: string; name: string; key: string; color: string; icon: string | null };

type Draft = {
  id: string | null;
  name: string;
  description: string;
  status: InitiativeStatus;
  priority: Priority;
  ownerId: string;
  targetDate: string;
  labelIds: string[];
  projectIds: string[];
  resources: Array<{ title: string; url: string }>;
};

const COMPACT_FIELD =
  "rounded-md border border-border bg-bg px-2 py-1 text-small text-text";

function emptyDraft(): Draft {
  return {
    id: null,
    name: "",
    description: "",
    status: "proposed",
    priority: 0,
    ownerId: "",
    targetDate: "",
    labelIds: [],
    projectIds: [],
    resources: [],
  };
}

function draftFrom(initiative: Initiative): Draft {
  return {
    id: initiative.id,
    name: initiative.name,
    description: initiative.description,
    status: initiative.status,
    priority: initiative.priority,
    ownerId: initiative.ownerId ?? "",
    targetDate: initiative.targetDate ?? "",
    labelIds: initiative.labels.map((label) => label.id),
    projectIds: initiative.projects.map((project) => project.id),
    resources: initiative.resources.map((resource) => ({ ...resource })),
  };
}

export function PlanningInitiatives({
  workspaceId,
  currentUserId,
  isAdmin,
  initiatives,
  members,
  projects,
  labels,
}: {
  workspaceId: string;
  currentUserId: string;
  isAdmin: boolean;
  initiatives: Initiative[];
  members: MemberOption[];
  projects: ProjectOption[];
  labels: Label[];
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const { confirm } = useUI();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<InitiativeStatus | "all">("all");
  const [owner, setOwner] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toolsHost, setToolsHost] = useState<HTMLElement | null>(null);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return initiatives.filter(
      (initiative) =>
        (status === "all" || initiative.status === status) &&
        (!owner || initiative.ownerId === owner) &&
        (!needle ||
          initiative.name.toLowerCase().includes(needle) ||
          initiative.description.toLowerCase().includes(needle))
    );
  }, [initiatives, query, status, owner]);

  async function save() {
    if (!draft) return;
    if (!draft.name.trim()) {
      setError(t("Name is required"));
      return;
    }
    setSaving(true);
    const input: InitiativeInput = {
      name: draft.name,
      description: draft.description,
      status: draft.status,
      priority: draft.priority,
      ownerId: draft.ownerId || null,
      targetDate: draft.targetDate || null,
      labelIds: draft.labelIds,
      resources: draft.resources.filter((resource) => resource.url.trim()),
    };
    const result = draft.id
      ? await updateInitiativeAction(workspaceId, draft.id, input, draft.projectIds)
      : await createInitiativeAction(workspaceId, input, draft.projectIds);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDraft(null);
    setError(null);
    router.refresh();
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToolsHost(document.getElementById("planning-header-tools"));
  }, []);

  async function remove() {
    if (!draft?.id) return;
    const ok = await confirm(t("Delete this initiative? Its projects and tasks stay."), { action: t("Delete") });
    if (!ok) return;
    setSaving(true);
    const result = await deleteInitiativeAction(workspaceId, draft.id);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDraft(null);
    setError(null);
    router.refresh();
  }


  return (
    <div className="mx-auto max-w-[880px] space-y-4">
      {toolsHost && createPortal(
        <button
          type="button"
          onClick={() => {
            setDraft(emptyDraft());
            setError(null);
          }}
          className={`${primaryButton} ml-2`}
          data-testid="initiative-new"
        >
          {t("New initiative")}
        </button>,
        toolsHost,
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-[180px] flex-1 items-center gap-2 rounded-md border border-border bg-elevated/40 px-2 py-1.5 focus-within:border-border-strong">
          <Search size={13} className="shrink-0 text-faint" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Search initiatives…")}
            aria-label={t("Search initiatives")}
            data-testid="initiative-search"
            className="w-full min-w-0 bg-transparent text-body text-text placeholder:text-faint"
          />
        </div>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value as InitiativeStatus | "all")}
          aria-label={t("Filter by status")}
          data-testid="initiative-status-filter"
          className={selectClass}
        >
          <option value="all">{t("All statuses")}</option>
          {INITIATIVE_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(INITIATIVE_STATUS_META[value].label)}
            </option>
          ))}
        </select>
        <select
          value={owner}
          onChange={(event) => setOwner(event.target.value)}
          aria-label={t("Filter by owner")}
          data-testid="initiative-owner-filter"
          className={selectClass}
        >
          <option value="">{t("All owners")}</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.displayName}
            </option>
          ))}
        </select>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-lg border border-border p-6 text-center" data-testid="initiative-empty">
          <p className="text-body text-faint">
            {initiatives.length === 0
              ? t("No initiatives yet. Group projects under one objective to report progress upward.")
              : t("No initiatives match these filters.")}
          </p>
          {initiatives.length === 0 && (
            <button
              type="button"
              onClick={() => setDraft(emptyDraft())}
              className={`${primaryButton} mt-3`}
            >
              {t("New initiative")}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3" data-testid="initiative-list">
          {shown.map((initiative) => (
            <article
              key={initiative.id}
              data-testid="initiative-row"
              className="rounded-lg border border-border p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="min-w-0 text-body font-semibold">{initiative.name}</h2>
                <Pill color={INITIATIVE_STATUS_META[initiative.status].color}>
                  {t(INITIATIVE_STATUS_META[initiative.status].label)}
                </Pill>
                <PriorityText priority={initiative.priority} />
                <button
                  type="button"
                  onClick={() => {
                    setDraft(draftFrom(initiative));
                    setError(null);
                  }}
                  aria-label={t("Edit {name}", { name: initiative.name })}
                  className={`${quietButton} ml-auto !px-2 !py-0.5 !text-small`}
                  data-testid="initiative-edit"
                >
                  {t("Edit")}
                </button>
              </div>
              <p className="mt-1 text-small text-faint">
                {initiative.targetDate
                  ? t("Target {date}", { date: formatDay(initiative.targetDate, locale) })
                  : t("No target date")}
                {initiative.ownerName && ` · ${t("Owner {name}", { name: initiative.ownerName })}`}
              </p>
              {initiative.description && (
                <p className="mt-1.5 line-clamp-2 text-body leading-relaxed text-text">
                  {initiative.description}
                </p>
              )}
              {initiative.projects.length === 0 ? (
                <p className="mt-1.5 text-small text-faint">{t("No projects linked")}</p>
              ) : (
                <div className="mt-2 divide-y divide-border border-t border-border">
                  {initiative.projects.map((project) => (
                    <Link
                      key={project.id}
                      href={`/${workspaceId}/projects/${project.id}?tab=timeline`}
                      className="flex items-center gap-2 py-1.5 text-body transition-colors hover:text-text"
                    >
                      <span className="min-w-0 flex-1 truncate">{project.name}</span>
                      <span className="shrink-0 text-small text-faint tabular-nums">
                        {t("{done}/{total} done", {
                          done: project.progress.done,
                          total: project.progress.total,
                        })}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
              {(initiative.labels.length > 0 || initiative.resources.length > 0) && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {initiative.labels.map((label) => (
                    <span
                      key={label.id}
                      className="inline-flex h-[18px] items-center rounded-[5px] px-1.5 whitespace-nowrap border text-caption"
                      style={{ borderColor: `${label.color}55`, color: label.color }}
                    >
                      {label.name}
                    </span>
                  ))}
                  {initiative.resources.map((resource) => (
                    <a
                      key={resource.url}
                      href={resource.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-0.5 text-caption text-muted underline decoration-border underline-offset-2 hover:text-text"
                    >
                      {resource.title} <ExternalLink size={10} />
                    </a>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      <Modal
        open={draft !== null}
        onClose={() => {
          if (!saving) setDraft(null);
        }}
        title={draft?.id ? t("Edit initiative") : t("New initiative")}
        className="max-w-[520px] !p-0"
      >
        {draft && (
          <div data-testid="initiative-editor">
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
              <h2 className="text-lead font-semibold">
                {draft.id ? t("Edit initiative") : t("New initiative")}
              </h2>
              <button
                type="button"
                onClick={() => setDraft(null)}
                aria-label={t("Close")}
                className="rounded p-1 text-faint transition-colors hover:bg-elevated hover:text-text"
              >
                <X size={14} />
              </button>
            </div>
            <div className="space-y-3 p-4">
            {error && <div className="rounded border border-danger/40 p-2 text-small text-danger">{error}</div>}
            <label className="block space-y-1">
              <FieldLabel>{t("Name")}</FieldLabel>
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                className={inputClass}
                data-testid="initiative-name"
                autoFocus
              />
            </label>
            <label className="block space-y-1">
              <FieldLabel>{t("Description")}</FieldLabel>
              <textarea
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                rows={2}
                className={inputClass}
              />
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
                <select
                  value={draft.status}
                  onChange={(event) =>
                    setDraft({ ...draft, status: event.target.value as InitiativeStatus })
                  }
                  aria-label={t("Status")}
                  className={COMPACT_FIELD}
                  data-testid="initiative-status"
                >
                  {INITIATIVE_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {t(INITIATIVE_STATUS_META[value].label)}
                    </option>
                  ))}
                </select>
                <select
                  value={draft.priority}
                  onChange={(event) =>
                    setDraft({ ...draft, priority: Number(event.target.value) as Priority })
                  }
                  aria-label={t("Priority")}
                  className={COMPACT_FIELD}
                >
                  {[0, 1, 2, 3, 4].map((value) => (
                    <option key={value} value={value}>
                      {t(PRIORITY_META[value as Priority].label)}
                    </option>
                  ))}
                </select>
                <select
                  value={draft.ownerId}
                  onChange={(event) => setDraft({ ...draft, ownerId: event.target.value })}
                  aria-label={t("Owner")}
                  className={COMPACT_FIELD}
                >
                  <option value="">{t("No owner")}</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.displayName}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  value={draft.targetDate}
                  onChange={(event) => setDraft({ ...draft, targetDate: event.target.value })}
                  aria-label={t("Target date")}
                  className={COMPACT_FIELD}
                />
            </div>
            <div className="space-y-1">
              <FieldLabel>{t("Projects")}</FieldLabel>
              <div className="max-h-40 divide-y divide-border overflow-y-auto rounded-lg border border-border" data-testid="initiative-projects">
                {projects.length === 0 ? (
                  <p className="text-small text-faint">{t("No projects yet.")}</p>
                ) : (
                  projects.map((project) => (
                    <label key={project.id} className="flex items-center gap-2 px-3 py-1.5 text-body hover:bg-elevated/50">
                      <input
                        type="checkbox"
                        data-testid="initiative-project"
                        checked={draft.projectIds.includes(project.id)}
                        onChange={() =>
                          setDraft({
                            ...draft,
                            projectIds: draft.projectIds.includes(project.id)
                              ? draft.projectIds.filter((id) => id !== project.id)
                              : [...draft.projectIds, project.id],
                          })
                        }
                      />
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: project.color }}
                      />
                      {project.name}
                    </label>
                  ))
                )}
              </div>
            </div>
            <div className="space-y-1">
              <FieldLabel>{t("Labels")}</FieldLabel>
              <div className="flex flex-wrap gap-1.5" data-testid="initiative-labels">
                {labels.length === 0 ? (
                  <span className="text-small text-faint">{t("No labels in this workspace.")}</span>
                ) : (
                  labels.map((label) => {
                    const on = draft.labelIds.includes(label.id);
                    return (
                      <button
                        key={label.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            labelIds: on
                              ? draft.labelIds.filter((id) => id !== label.id)
                              : [...draft.labelIds, label.id],
                          })
                        }
                        className={`rounded-lg border px-2 py-0.5 text-caption transition-colors ${
                          on ? "border-border-strong bg-elevated text-text" : "border-border text-muted"
                        }`}
                      >
                        {label.name}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
            <div className="space-y-1">
              <FieldLabel>{t("Resources")}</FieldLabel>
              <div className="space-y-1.5">
                {draft.resources.map((resource, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      value={resource.title}
                      onChange={(event) => {
                        const next = [...draft.resources];
                        next[index] = { ...resource, title: event.target.value };
                        setDraft({ ...draft, resources: next });
                      }}
                      placeholder={t("Title")}
                      aria-label={t("Resource title")}
                      className={`${inputClass} max-w-[200px]`}
                    />
                    <input
                      value={resource.url}
                      onChange={(event) => {
                        const next = [...draft.resources];
                        next[index] = { ...resource, url: event.target.value };
                        setDraft({ ...draft, resources: next });
                      }}
                      placeholder="https://"
                      aria-label={t("Resource link")}
                      className={inputClass}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          resources: draft.resources.filter((_, at) => at !== index),
                        })
                      }
                      aria-label={t("Remove resource")}
                      className="rounded p-1 text-faint hover:bg-elevated hover:text-danger"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setDraft({ ...draft, resources: [...draft.resources, { title: "", url: "" }] })
                  }
                  className="text-small text-muted hover:text-text"
                >
                  {t("Add resource")}
                </button>
              </div>
            </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
              {draft.id && (isAdmin || initiatives.find((row) => row.id === draft.id)?.createdBy === currentUserId) && (
                <button
                  type="button"
                  onClick={remove}
                  disabled={saving}
                  className="mr-auto flex items-center gap-1 rounded-md px-2 py-1.5 text-small text-faint transition-colors hover:bg-elevated hover:text-danger"
                  data-testid="initiative-delete"
                >
                  {t("Delete")}
                </button>
              )}
              <button type="button" onClick={() => setDraft(null)} className={quietButton} disabled={saving}>
                {t("Cancel")}
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className={primaryButton}
                data-testid="initiative-save"
              >
                {saving ? t("Saving…") : t("Save")}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
