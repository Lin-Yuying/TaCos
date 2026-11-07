"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SidePanel } from "@/components/ui/side-panel";
import { History, X } from "lucide-react";
import { AssigneeAvatar } from "@/components/issue-table";
import { useLocale, useT } from "@/components/i18n-context";
import {
  getPageVersionChangeAction,
  listPageVersionsAction,
  restorePageVersionAction,
  undoAgentEditAction,
} from "@/app/pages-actions";
import { DocDiffRendered } from "@/components/doc-diff-rendered";
import { groupDocUpdates } from "@/lib/doc-update-groups";
import { timeAgo } from "@/lib/format";
import type { DocPage, PageAuthor, PageVersion, PageVersionChange } from "@/lib/pages";

export function DiffLines({ before, after }: { before: string; after: string }) {
  return <DocDiffRendered before={before} after={after} />;
}

// Who did what, one line per version: a restore and kept text say so instead of a name.
function versionLabel(version: PageVersion, t: ReturnType<typeof useT>): string {
  const name = version.actor?.displayName || t("Someone");
  if (version.reason === "earlier") return t("Earlier version");
  if (version.reason === "unsaved") return t("Unsaved text from {name}", { name });
  if (version.reason === "undo") return `${name} · ${t("Undid version {n}", { n: version.restoredFrom ?? 0 })}`;
  if (version.reason === "restore") return `${name} · ${t("Restored version {n}", { n: version.restoredFrom ?? 0 })}`;
  if (version.reason === "template")
    return t("Created from template “{template}”", { template: version.templateName ?? t("Template") });
  return name;
}

function editorsOf(versions: PageVersion[]): PageAuthor[] {
  const seen = new Set<string>();
  const people: PageAuthor[] = [];
  for (const version of versions) {
    const actor = version.actor;
    if (!actor || seen.has(actor.id)) continue;
    seen.add(actor.id);
    people.push(actor);
  }
  return people;
}

function personName(person: PageAuthor, t: ReturnType<typeof useT>): string {
  return person.displayName || t("Someone");
}

function editorsLabel(people: PageAuthor[], t: ReturnType<typeof useT>): string {
  if (people.length === 0) return t("Someone");
  if (people.length === 1) return personName(people[0], t);
  if (people.length === 2) return t("{a} and {b}", { a: personName(people[0], t), b: personName(people[1], t) });
  return t("{name} and {count} others", { name: personName(people[0], t), count: people.length - 1 });
}

function EditorFaces({ people }: { people: PageAuthor[] }) {
  const shown = people.slice(0, 3);
  if (shown.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {shown.map((person) => (
        <AssigneeAvatar key={person.id} displayName={person.displayName} avatar={person.avatar} size={16} />
      ))}
    </span>
  );
}

export function DocUpdatesPanel({
  workspaceId,
  pageId,
  canEdit,
  compact,
  beforeRestore,
  onRestored,
  onPreview,
  onClose,
}: {
  workspaceId: string;
  pageId: string;
  canEdit: boolean;
  // In a narrow pane the panel covers the document instead of standing beside it.
  compact: boolean;
  beforeRestore: () => Promise<void>;
  onRestored: (page: DocPage) => void;
  // Beside a document the chosen version's changes show in the document's place.
  onPreview?: (change: PageVersionChange | null) => void;
  onClose: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [versions, setVersions] = useState<PageVersion[] | null>(null);
  const [query,setQuery]=useState(""),[limit,setLimit]=useState(30);
  const [selected, setSelected] = useState<string | null>(null);
  const [change, setChange] = useState<PageVersionChange | null>(null);
  const selectedRef = useRef<string | null>(null);
  const restoring = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const groups = useMemo(() => (versions ? groupDocUpdates(versions) : null), [versions]);
  useEffect(() => { onPreview?.(compact ? null : change); }, [change, compact, onPreview]);
  useEffect(() => () => onPreview?.(null), [onPreview]);

  async function load() {
    const result = await listPageVersionsAction(workspaceId, pageId);
    if (result.ok) setVersions(result.data);
    else setError(result.error);
  }

  useEffect(() => {
    let live = true;
    void listPageVersionsAction(workspaceId, pageId).then((result) => {
      if (!live) return;
      if (result.ok) {
        setVersions(result.data);
        const first = groupDocUpdates(result.data)[0];
        const newest = first?.versions[0];
        if (!compact && first && newest) void open(newest.id, (first.versions[first.versions.length - 1] ?? newest).id);
      } else setError(result.error);
    });
    return () => {
      live = false;
    };
  }, [workspaceId, pageId]);

  async function open(newestId: string, oldestId: string) {
    selectedRef.current = newestId;
    setSelected(newestId);
    setChange(null);
    const result = await getPageVersionChangeAction(workspaceId, pageId, newestId, oldestId);
    if (selectedRef.current !== newestId) return;
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
    <SidePanel name="document-discussion" compact={compact}><aside
      data-doc-updates
      className={`flex min-h-0 flex-col border-l border-border bg-bg ${
        compact ? "w-full border-l-0" : "w-full shrink-0"
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
      <div className="shrink-0 px-3 py-2">
        <input aria-label={t("Search versions")} placeholder={t("Search versions")} value={query} onChange={e=>{setQuery(e.target.value);setLimit(30);}} className="w-full rounded-md border border-border bg-bg px-2 py-1 text-small text-text placeholder:text-faint"/>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && <div className="px-3 pb-2 text-small text-danger">{t(error)} <button onClick={()=>void load()} className="underline">{t("Retry")}</button></div>}
        {versions === null && !error && <p className="px-3 py-2 text-small text-faint">{t("Loading…")}</p>}
        {groups?.length === 0 && <p className="px-3 py-2 text-body text-faint">{t("No updates yet.")}</p>}
        {groups?.filter(group=>group.versions.some(version=>`${versionLabel(version,t)} ${version.seq} ${version.updatedAt} ${version.title}`.toLowerCase().includes(query.toLowerCase()))).slice(0,limit).map((group) => {
          const newest = group.versions[0];
          if (!newest) return null;
          const oldest = group.versions[group.versions.length - 1] ?? newest;
          const multiple = group.versions.length > 1;
          const people = editorsOf(group.versions);
          const isCurrent = group.versions.some((version) => version.id === current);
          const byAgent = !multiple && newest.via === "mcp" && newest.reason === "edit";
          const who = multiple
            ? editorsLabel(people, t)
            : byAgent
              ? t("{name}'s Agent", { name: newest.actor?.displayName || t("Someone") })
              : versionLabel(newest, t);
          return (
            <div key={group.id} className="border-b border-border">
              <div className={`flex items-center gap-2 px-3 py-2 transition-colors ${selected === group.id ? "bg-elevated" : "hover:bg-elevated/60"}`}>
                <button
                  type="button"
                  onClick={() => void (selected === group.id ? (selectedRef.current=null,setSelected(null),setChange(null)) : open(newest.id, oldest.id))}
                  aria-expanded={selected === group.id}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  {multiple ? (
                    <EditorFaces people={people} />
                  ) : (
                    newest.actor && (
                      <AssigneeAvatar displayName={newest.actor.displayName} avatar={newest.actor.avatar} size={16} />
                    )
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-body text-text">
                      <span className="tabular-nums">
                        {multiple
                          ? t("Versions {from} to {to}", { from: oldest.seq, to: newest.seq })
                          : t("Version {n}", { n: newest.seq })}
                      </span>
                      {isCurrent && <span className="shrink-0 rounded bg-surface px-1 text-caption text-muted">{t("Current")}</span>}
                    </span>
                    <span className="block truncate text-small text-muted">
                      {who} · <span suppressHydrationWarning>{timeAgo(group.updatedAt, locale)}</span>
                    </span>
                  </span>
                </button>
                {canEdit && byAgent && isCurrent && (
                  <button
                    type="button"
                    data-doc-undo-agent
                    disabled={busy}
                    onClick={() => {selectedRef.current=newest.id;void restore(newest.id, undoAgentEditAction);}}
                    className="shrink-0 rounded-md border border-border px-2 py-1 text-small font-medium text-muted hover:border-border-strong hover:text-text"
                  >
                    {t("Undo this Agent edit")}
                  </button>
                )}
                {canEdit && !isCurrent && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {selectedRef.current=newest.id;void restore(newest.id);}}
                    className="shrink-0 rounded-md border border-border px-2 py-1 text-small font-medium text-muted hover:border-border-strong hover:text-text"
                  >
                    {t("Restore this version")}
                  </button>
                )}
              </div>
              {selected === group.id && (compact || multiple) && (
                <div className="px-3 pb-3 pt-1">
                  {compact && change && (
                    <>
                      {change.beforeTitle !== change.title && (
                        <p className="pb-1 text-small text-muted">
                          {t("Title: {before} → {after}", { before: change.beforeTitle, after: change.title })}
                        </p>
                      )}
                      <DiffLines before={change.beforeDoc} after={change.doc} />
                    </>
                  )}
                  {multiple && (
                    <ul className="mt-2 flex flex-col gap-1">
                      {group.versions.map((version) => (
                        <li key={version.id} className="flex items-center gap-2 text-small text-muted">
                          {version.actor && (
                            <AssigneeAvatar
                              displayName={version.actor.displayName}
                              avatar={version.actor.avatar}
                              size={16}
                            />
                          )}
                          <span className="min-w-0 flex-1 truncate text-text">
                            {version.actor?.displayName || t("Someone")}
                          </span>
                          <span className="shrink-0 text-caption text-faint tabular-nums">{t("Version {n}", { n: version.seq })}</span>
                          {canEdit && version.id !== current && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {selectedRef.current=version.id;void restore(version.id);}}
                              className="shrink-0 rounded-md border border-border px-2 py-1 text-small font-medium text-muted hover:border-border-strong hover:text-text"
                            >
                              {t("Restore this version")}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {groups&&groups.length>limit&&<div className="flex justify-center p-2"><button type="button" onClick={()=>setLimit(n=>n+30)} className="rounded-md border border-border px-3 py-1 text-small font-medium text-muted hover:border-border-strong hover:text-text">{t("Load more")}</button></div>}
      </div>
    </aside></SidePanel>
  );
}
