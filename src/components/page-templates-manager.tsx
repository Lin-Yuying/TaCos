"use client";
import { safeAction } from "@/lib/ui/safe-action";

import { useState } from "react";
import { useUI } from "@/components/ui-context";
import {
  createPageTemplateAction,
  deletePageTemplateAction,
  updatePageTemplateAction,
} from "@/app/page-template-actions";
import type { PageTemplate } from "@/lib/page-templates";
import { useT } from "@/components/i18n-context";

type Draft = { name: string; title: string; doc: string; icon: string };

const EMPTY: Draft = { name: "", title: "", doc: "", icon: "" };

/**
 * Settings › Page templates. Everyone in the workspace sees the list a new document can
 * start from; only the owner or an admin gets the form and the row actions.
 */
export function PageTemplatesManager({
  workspaceId,
  initialTemplates,
  canManage,
}: {
  workspaceId: string;
  initialTemplates: PageTemplate[];
  canManage: boolean;
}) {
  const t = useT();
  const { confirm } = useUI();
  const [templates, setTemplates] = useState(initialTemplates);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function beginEdit(template: PageTemplate) {
    setEditing(template.id);
    setDraft({ name: template.name, title: template.title, doc: template.doc, icon: template.icon ?? "" });
    setError(null);
    setNotice(null);
  }

  function cancelEdit() {
    setEditing(null);
    setDraft(EMPTY);
    setError(null);
  }

  async function save() {
    if (busy || !draft.name.trim() || !draft.title.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const input = { name: draft.name, title: draft.title, doc: draft.doc, icon: draft.icon || null };
    const result = editing
      ? await safeAction(async () => updatePageTemplateAction(workspaceId, editing, input))
      : await safeAction(async () => createPageTemplateAction(workspaceId, input));
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const saved = result.data;
    setTemplates((current) =>
      editing
        ? current.map((template) => (template.id === saved.id ? saved : template))
        : [...current, saved].sort((a, b) => a.name.localeCompare(b.name))
    );
    setEditing(null);
    setDraft(EMPTY);
    setNotice(t("Template saved."));
  }

  async function remove(template: PageTemplate) {
    if (!(await confirm(t("Delete the template “{name}”?", { name: template.name })))) return;
    setBusy(true);
    setError(null);
    const result = await safeAction(async () => deletePageTemplateAction(workspaceId, template.id));
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setTemplates((current) => current.filter((row) => row.id !== template.id));
    if (editing === template.id) cancelEdit();
    setNotice(t("Template deleted. Documents created from it are unchanged."));
  }

  return (
    <div data-page-templates className="space-y-4">
      {error && (
        <div role="alert" className="text-small text-danger">
          {t(error)}
        </div>
      )}
      {notice && <div className="text-small text-muted">{t(notice)}</div>}

      <div className="divide-y divide-border rounded-lg border border-border">
        {templates.length === 0 && (
          <div className="p-4 text-body text-faint">{t("No page templates yet.")}</div>
        )}
        {templates.map((template) => (
          <div
            key={template.id}
            data-template-row={template.id}
            className="flex flex-wrap items-center gap-3 px-4 py-2.5"
          >
            {template.icon && <span className="flex w-6 shrink-0 justify-center text-lead">{template.icon}</span>}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body text-text">{template.name}</span>
              <span className="block truncate text-small text-faint">{t("Available when creating a document")}</span>
            </span>
            {canManage && (
              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  data-template-edit
                  onClick={() => beginEdit(template)}
                  aria-label={t("Edit template {name}", { name: template.name })}
                  className="rounded-md border border-border px-2.5 py-1 text-small text-muted transition-colors hover:text-text"
                >
                  {t("Edit")}
                </button>
                <button
                  type="button"
                  data-template-delete
                  disabled={busy}
                  onClick={() => void remove(template)}
                  aria-label={t("Delete template {name}", { name: template.name })}
                  className="rounded-md px-2 py-1 text-small text-muted transition-colors hover:bg-elevated hover:text-danger disabled:opacity-40"
                >
                  {t("Delete")}
                </button>
              </span>
            )}
          </div>
        ))}
      </div>
      {canManage && templates.length === 0 && (
        <p className="flex items-center gap-1 text-small text-faint">
          {t("Add one below; it appears when someone creates a document.")}
        </p>
      )}
      {canManage && (
        <section className="space-y-2.5">
          <h2 className="text-body font-semibold">{t(editing ? "Edit template" : "New template")}</h2>
          <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_4rem]">
            <label className="space-y-1 text-small text-muted">
              <span>{t("Template name")}</span>
              <input
                data-template-name
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                                className="w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-body text-text placeholder:text-faint focus:border-border-strong"
              />
            </label>
            <label className="space-y-1 text-small text-muted">
              <span>{t("Icon")}</span>
              <input
                data-template-icon
                value={draft.icon}
                onChange={(event) => setDraft({ ...draft, icon: event.target.value })}
                aria-label={t("Template icon")}
                maxLength={8}
                className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-center text-body text-text focus:border-border-strong"
              />
            </label>
          </div>
          <label className="block space-y-1 text-small text-muted">
            <span>{t("Page title")}</span>
            <input
              data-template-title
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              placeholder={t("{date} weekly report")}
              className="w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-body text-text placeholder:text-faint focus:border-border-strong"
            />
          </label>
          <label className="block space-y-1 text-small text-muted">
            <span>{t("Template text")}</span>
            <textarea
              data-template-body
              value={draft.doc}
              onChange={(event) => setDraft({ ...draft, doc: event.target.value })}
              rows={5}
              className="w-full resize-y rounded-md border border-border bg-bg px-2.5 py-1.5 font-mono text-small text-text placeholder:text-faint focus:border-border-strong"
            />
            <span className="block text-small text-faint">{t("Markdown with {date}, {author} and {project}.")}</span>
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              data-template-save
              disabled={busy || !draft.name.trim() || !draft.title.trim()}
              onClick={() => void save()}
              className="rounded-md bg-accent px-3 py-1.5 text-body font-medium text-white hover:bg-accent-hover disabled:opacity-40"
            >
              {t("Save template")}
            </button>
            {editing && (
              <button
                type="button"
                onClick={cancelEdit}
                className="rounded-md border border-border px-3 py-1.5 text-body text-muted hover:border-border-strong hover:text-text"
              >
                {t("Cancel")}
              </button>
            )}
          </div>
        </section>
      )}

    </div>
  );
}
