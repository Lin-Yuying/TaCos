"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Plus } from "lucide-react";
import { Menu, MenuItem } from "@/components/menu";
import { createPageAction, setPageSharedAction } from "@/app/pages-actions";
import { createPageFromTemplateAction, listPageTemplatesAction } from "@/app/page-template-actions";
import type { PageTemplate } from "@/lib/page-templates";
import { useT } from "@/components/i18n-context";

/**
 * "New document" with the workspace's page templates behind it. Every creation point
 * (document tree, document index, project Documents) shares this menu so a template is
 * available wherever a blank page is.
 */
export function NewPageMenu({
  workspaceId,
  parentId,
  projectId,
  shared = false,
  label,
  variant = "button",
  className,
}: {
  workspaceId: string;
  parentId?: string | null;
  projectId?: string | null;
  // A page created in the Shared section joins it; everything else starts private.
  shared?: boolean;
  label?: string;
  variant?: "button" | "icon";
  className?: string;
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(templateId?: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = templateId
      ? await createPageFromTemplateAction(workspaceId, templateId, { parentId, projectId })
      : await createPageAction(workspaceId, { parentId, projectId });
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }
    if (shared) await setPageSharedAction(workspaceId, result.data.id, true);
    router.push(`/${workspaceId}/docs/${result.data.id}`);
    router.refresh();
    setBusy(false);
  }

  const trigger =
    variant === "icon" ? (
      <>
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
        <span className="sr-only">{label ?? t("New document")}</span>
      </>
    ) : (
      <>
        <Plus size={13} /> {label ?? t("New document")}
      </>
    );

  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <Menu
        width={260}
        trigger={trigger}
        triggerClassName={
          className ??
          (variant === "icon"
            ? "rounded p-1 text-faint transition-colors hover:bg-elevated hover:text-text disabled:opacity-50"
            : "flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-small font-medium text-muted transition-colors hover:border-border-strong hover:text-text")
        }
      >
        {(close) => (
          <TemplateChoices
            workspaceId={workspaceId}
            busy={busy}
            onClose={close}
            onPick={(templateId) => {
              close();
              void create(templateId);
            }}
          />
        )}
      </Menu>
      {error && (
        <span role="alert" className="text-caption text-danger">
          {t(error)}
        </span>
      )}
    </span>
  );
}

function TemplateChoices({
  workspaceId,
  busy,
  onClose,
  onPick,
}: {
  workspaceId: string;
  busy: boolean;
  onClose: () => void;
  onPick: (templateId?: string) => void;
}) {
  const t = useT();
  const [templates, setTemplates] = useState<PageTemplate[] | null>(null);

  useEffect(() => {
    let live = true;
    void listPageTemplatesAction(workspaceId).then((result) => {
      if (live) setTemplates(result.ok ? result.data.templates : []);
    });
    return () => {
      live = false;
    };
  }, [workspaceId]);

  return (
    <div data-new-page-menu>
      <MenuItem disabled={busy} onSelect={() => onPick()}>
        <FileText size={13} /> {t("Blank document")}
      </MenuItem>
      <div className="px-2 pb-1 pt-2 text-caption uppercase tracking-wide text-faint">
        {t("From a template")}
      </div>
      {templates === null && <div className="px-2 py-1 text-small text-faint">{t("Loading…")}</div>}
      {templates?.length === 0 && (
        <div className="px-2 py-1 text-small text-faint">{t("No page templates yet.")}</div>
      )}
      {templates?.map((template) => (
        <MenuItem key={template.id} disabled={busy} onSelect={() => onPick(template.id)}>
          <span className="flex w-5 shrink-0 justify-center text-lead">
            {template.icon || <FileText size={13} />}
          </span>
          <span className="min-w-0">
            <span className="block truncate" data-page-template-option={template.id}>
              {template.name}
            </span>
            <span className="block truncate text-caption text-faint">{template.title}</span>
          </span>
        </MenuItem>
      ))}
      <Link
        href={`/${workspaceId}/settings#page-templates`}
        onClick={onClose}
        className="mt-1 block rounded-md border-t border-border px-2 py-1.5 text-small text-muted hover:bg-elevated hover:text-text"
      >
        {t("Manage page templates")}
      </Link>
    </div>
  );
}
