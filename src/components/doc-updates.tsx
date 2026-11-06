"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { History, X } from "lucide-react";
import { AssigneeAvatar } from "@/components/issue-table";
import { useLocale, useT } from "@/components/i18n-context";
import {
  getPageVersionChangeAction,
  listPageVersionsAction,
  restorePageVersionAction,
  undoAgentEditAction,
} from "@/app/pages-actions";
import { docDiffRows } from "@/lib/doc-diff";
import { timeAgo } from "@/lib/format";
import type { DocPage, PageVersion, PageVersionChange } from "@/lib/pages";

export function DiffLines({ before, after }: { before: string; after: string }) {
  const t = useT();
  const rows = useMemo(() => docDiffRows(before, after), [before, after]);
  if (before === after) return <p className="text-small text-faint">{t("No text changed.")}</p>;
  return (
    <div data-doc-diff className="space-y-px font-mono text-small leading-[1.55]">
      {rows.map((row, index) =>
        row.kind === "gap" ? (
          <div key={index} className="px-1 py-0.5 text-faint">
            {t("{count} unchanged lines", { count: row.count })}
          </div>
        ) : (
          <div
            key={index}
            data-diff={row.kind}
            className={`whitespace-pre-wrap break-words px-1 ${
              row.kind === "add"
                ? "bg-code-string/10 text-text"
                : row.kind === "del"
                  ? "bg-danger/10 text-muted line-through"
                  : "text-muted"
            }`}
          >
            {row.text || " "}
          </div>
        )
      )}
    </div>
  );
}

// Who did what, one line per version: a restore and kept text say so instead of a name.
function versionLabel(version: PageVersion, t: ReturnType<typeof useT>): string {
  const name = version.actor?.displayName || t("Someone");
  if (version.reason === "earlier") return t("Earlier version");
  if (version.reason === "unsaved") return t("Unsaved text from {name}", { name });
  if (version.reason === "undo") return `${name} · ${t("Undid version {n}", { n: version.restoredFrom ?? 0 })}`;
  if (version.reason === "restore") return `${name} · ${t("Restored version {n}", { n: version.restoredFrom ?? 0 })}`;
  return name;
}

export function DocUpdatesPanel({
  workspaceId,
  pageId,
  canEdit,
  compact,
  beforeRestore,
  onRestored,
  onClose,
}: {
  workspaceId: string;
  pageId: string;
  canEdit: boolean;
  // In a narrow pane the panel covers the document instead of standing beside it.
  compact: boolean;
  beforeRestore: () => Promise<void>;
  onRestored: (page: DocPage) => void;
  onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [versions, setVersions] = useState<PageVersion[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [change, setChange] = useState<PageVersionChange | null>(null);
  const selectedRef = useRef<string | null>(null);
  const restoring = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const result = await listPageVersionsAction(workspaceId, pageId);
    if (result.ok) setVersions(result.data);
    else setError(result.error);
  }

  useEffect(() => {
    let live = true;
    void listPageVersionsAction(workspaceId, pageId).then((result) => {
      if (!live) return;
      if (result.ok) setVersions(result.data);
      else setError(result.error);
    });
    return () => {
      live = false;
    };
  }, [workspaceId, pageId]);

  async function open(id: string) {
    selectedRef.current = id;
    setSelected(id);
    setChange(null);
    const result = await getPageVersionChangeAction(workspaceId, pageId, id);
    if (selectedRef.current !== id) return;
    if (result.ok) setChange(result.data);
    else setError(result.error);
  }

  async function restore(id: string, action = restorePageVersionAction) {
    if (restoring.current || selectedRef.current !== id) return;
    restoring.current = true; setBusy(true); setError(null);
    try {
      await beforeRestore();
      const result = await action(workspaceId,pageId,id);
      if(!result.ok){setError(result.error);return;}
      onRestored(result.data);setSelected(null);selectedRef.current=null;setChange(null);await load();
    } catch(err) {setError(err instanceof Error ? err.message : "Something went wrong");}
    finally {restoring.current=false;setBusy(false);}
  }

  const current = versions?.find((version) => version.reason !== "unsaved")?.id;

  return (
    <aside
      data-doc-updates
      className={`flex min-h-0 flex-col border-l border-border bg-bg ${
        compact ? "absolute inset-0 z-10 border-l-0" : "w-[340px] shrink-0"
      }`}
    >
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border px-3 text-body font-medium text-text">
        <History size={13} />
        {t("Updates")}
        <button
          type="button"
          onClick={onClose}
          aria-label={t("Close updates")}
          title={t("Close updates")}
          className="ml-auto rounded p-1 text-muted hover:bg-elevated hover:text-text"
        >
          <X size={14} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {error && <div className="px-1 pb-2 text-small text-danger">{t(error)}</div>}
        {versions === null && !error && <p className="p-2 text-small text-faint">{t("Loading…")}</p>}
        {versions?.length === 0 && <p className="px-1 py-2 text-body text-faint">{t("No updates yet.")}</p>}
        {versions?.map((version) => (
          <div key={version.id} className="rounded-md">
            <button
              type="button"
              onClick={() => void (selected === version.id ? setSelected(null) : open(version.id))}
              aria-expanded={selected === version.id}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-small transition-colors hover:bg-elevated/60 ${
                selected === version.id ? "bg-elevated/60" : ""
              }`}
            >
              {version.actor && (
                <AssigneeAvatar displayName={version.actor.displayName} avatar={version.actor.avatar} size={16} />
              )}
              <span className="min-w-0 flex-1 truncate text-text">{versionLabel(version, t)}</span>
              {version.via === "mcp" && (
                <span className="shrink-0 rounded border border-border px-1 text-caption text-muted">Agent</span>
              )}
              <span className="shrink-0 text-caption text-faint">{timeAgo(version.updatedAt, locale)}</span>
            </button>
            {selected === version.id && change && (
              <div className="px-2 pb-3 pt-1">
                {change.beforeTitle !== change.title && (
                  <p className="pb-1 text-small text-muted">
                    {t("Title: {before} → {after}", { before: change.beforeTitle, after: change.title })}
                  </p>
                )}
                <DiffLines before={change.beforeDoc} after={change.doc} />
                <div className="mt-2 flex items-center gap-2 text-small text-faint">
                  {t("Version {n}", { n: version.seq })}
                  {version.id === current && <span>· {t("Current")}</span>}
                  {canEdit && version.id === current && version.via === "mcp" && version.reason === "edit" && (
                    <button
                      type="button"
                      data-doc-undo-agent
                      disabled={busy}
                      onClick={() => void restore(version.id, undoAgentEditAction)}
                      className="ml-auto rounded-md border border-border px-2 py-1 text-small font-medium text-muted hover:border-border-strong hover:text-text"
                    >
                      {t("Undo this Agent edit")}
                    </button>
                  )}
                  {canEdit && version.id !== current && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void restore(version.id)}
                      className="ml-auto rounded-md border border-border px-2 py-1 text-small font-medium text-muted hover:border-border-strong hover:text-text"
                    >
                      {t("Restore this version")}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
