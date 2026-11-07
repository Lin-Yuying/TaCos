"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { AssigneeAvatar } from "@/components/issue-table";
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
  ProgressBar,
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

  async function remove() {
    if (!draft?.id) return;
    const ok = await confirm(t("Delete this initiative? Its projects and tasks stay."));
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
    <div className="space-y-4">
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
        <button
          type="button"
          onClick={() => {
            setDraft(emptyDraft());
            setError(null);
          }}
          className={`${primaryButton} flex items-center gap-1`}
          data-testid="initiative-new"
        >
          <Plus size={13} /> {t("New initiative")}
        </button>
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
              <div className="flex flex-wrap items-start gap-2">
                <h2 className="min-w-0 text-lead font-semibold">{initiative.name}</h2>
                <Pill color={INITIATIVE_STATUS_META[initiative.status].color}>
                  {t(INITIATIVE_STATUS_META[initiative.status].label)}
                </Pill>
                <PriorityText priority={initiative.priority} />
                <div className="ml-auto flex shrink-0 items-center gap-3">
                  {initiative.ownerName && (
                    <span className="flex items-center gap-1.5 text-small text-muted">
                      <AssigneeAvatar
                        displayName={initiative.ownerName}
                        avatar={initiative.ownerAvatar}
                        size={16}
                      />
                      {initiative.ownerName}
                    </span>
                  )}
                  {initiative.targetDate && (
                    <span className="text-small text-faint">
                      {t("Target {date}", { date: formatDay(initiative.targetDate, locale) })}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(draftFrom(initiative));
                      setError(null);
                    }}
                    aria-label={t("Edit {name}", { name: initiative.name })}
                    title={t("Edit")}
                    className="rounded p-1 text-faint transition-colors hover:bg-elevated hover:text-text"
                    data-testid="initiative-edit"
                  >
                    <Pencil size={13} />
                  </button>
                </div>
              </div>
              {initiative.description && (
                <p className="mt-1 line-clamp-2 text-small leading-relaxed text-muted">
                  {initiative.description}
                </p>
              )}
              <div className="mt-3 flex items-center gap-2">
                <ProgressBar percent={initiative.progress.percent} className="max-w-xs flex-1" />
                <span className="text-caption text-faint tabular-nums">
                  {t("{done}/{total} done", {
                    done: initiative.progress.done,
                    total: initiative.progress.total,
                  })}
                </span>
                <span className="text-caption text-faint tabular-nums">
                  {initiative.progress.percent}%
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {initiative.projects.map((project) => (
                  <Link
                    key={project.id}
                    href={`/${workspaceId}/projects/${project.id}?tab=timeline`}
                    className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-caption hover:border-border-strong"
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: project.color }}
                    />
                    {project.name}
                    <span className="text-faint tabular-nums">{project.progress.percent}%</span>
                  </Link>
                ))}
                {initiative.projects.length === 0 && (
                  <span className="text-caption text-faint">{t("No projects linked")}</span>
                )}
                {initiative.labels.map((label) => (
                  <span
                    key={label.id}
                    className="rounded-full border px-1.5 py-0.5 text-caption"
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
        className="max-w-[760px]"
      >
        {draft && (
          <div className="space-y-3" data-testid="initiative-editor">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lead font-semibold">
                {draft.id ? t("Edit initiative") : t("New initiative")}
              </h2>
              <button
                type="button"
                onClick={() => setDraft(null)}
                aria-label={t("Close")}
                className="text-faint hover:text-text"
              >
                <X size={14} />
              </button>
            </div>
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
                rows={3}
                className={inputClass}
              />
            </label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <FieldLabel>{t("Status")}</FieldLabel>
                <select
                  value={draft.status}
                  onChange={(event) =>
                    setDraft({ ...draft, status: event.target.value as InitiativeStatus })
                  }
                  className={`${selectClass} w-full`}
                  data-testid="initiative-status"
                >
                  {INITIATIVE_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {t(INITIATIVE_STATUS_META[value].label)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <FieldLabel>{t("Priority")}</FieldLabel>
                <select
                  value={draft.priority}
                  onChange={(event) =>
                    setDraft({ ...draft, priority: Number(event.target.value) as Priority })
                  }
                  className={`${selectClass} w-full`}
                >
                  {[0, 1, 2, 3, 4].map((value) => (
                    <option key={value} value={value}>
                      {t(PRIORITY_META[value as Priority].label)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <FieldLabel>{t("Owner")}</FieldLabel>
                <select
                  value={draft.ownerId}
                  onChange={(event) => setDraft({ ...draft, ownerId: event.target.value })}
                  className={`${selectClass} w-full`}
                >
                  <option value="">{t("No owner")}</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <FieldLabel>{t("Target date")}</FieldLabel>
                <input
                  type="date"
                  value={draft.targetDate}
                  onChange={(event) => setDraft({ ...draft, targetDate: event.target.value })}
                  className={inputClass}
                />
              </label>
            </div>
            <div className="space-y-1">
              <FieldLabel>{t("Projects")}</FieldLabel>
              <div className="max-h-40 overflow-y-auto rounded-md border border-border p-2" data-testid="initiative-projects">
                {projects.length === 0 ? (
                  <p className="text-small text-faint">{t("No projects yet.")}</p>
                ) : (
                  projects.map((project) => (
                    <label key={project.id} className="flex items-center gap-2 py-0.5 text-body">
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
                        className={`rounded-full border px-2 py-0.5 text-caption transition-colors ${
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
            <div className="flex items-center justify-end gap-2 pt-1">
              {draft.id && (isAdmin || initiatives.find((row) => row.id === draft.id)?.createdBy === currentUserId) && (
                <button
                  type="button"
                  onClick={remove}
                  disabled={saving}
                  className="mr-auto flex items-center gap-1 rounded-md px-2 py-1.5 text-small text-faint transition-colors hover:bg-elevated hover:text-danger"
                  data-testid="initiative-delete"
                >
                  <Trash2 size={12} /> {t("Delete")}
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
