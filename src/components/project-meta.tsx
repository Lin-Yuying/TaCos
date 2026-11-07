"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronDown,
  FileText,
  Link2,
  MoreHorizontal,
  Plus,
  X,
} from "lucide-react";
import {
  addProjectDocAction,
  addProjectLinkAction,
  addProjectMemberAction,
  removeOverviewGrantAction,
  removeProjectMemberAction,
  removeProjectResourceAction,
  setOverviewGrantAction,
} from "@/app/actions";
import { createPageAction } from "@/app/pages-actions";
import { AssigneeAvatar } from "@/components/issue-table";
import { Menu, MenuItem } from "@/components/menu";
import { useUI } from "@/components/ui-context";
import type { PageSummary } from "@/lib/pages";
import type { ProjectResource } from "@/lib/resources";
import type {
  Member,
  OverviewAccess,
  OverviewGrant,
  ProjectMember,
} from "@/lib/issues";
import { useT } from "@/components/i18n-context";

type OverviewRole = "view" | "comment" | "edit";
const OVERVIEW_LEVELS = [
  { level: "view", label: "View" },
  { level: "comment", label: "Comment" },
  { level: "edit", label: "Edit" },
] as const satisfies readonly { level: OverviewRole; label: string }[];

// Which of the two header rows the reader folded away, per device. A folded row leaves
// the header entirely, so the "⋯" beside the pills is the way back to it.
const META_HIDDEN_KEY = "tacos.projectMeta.hidden";

export const META_ROWS = [
  { key: "properties", label: "Properties" },
  { key: "resources", label: "Resources" },
] as const;

export type MetaRowKey = (typeof META_ROWS)[number]["key"];

export function useMetaRows() {
  const [hidden, setHidden] = useState<MetaRowKey[]>([]);

  // Restored after mount so the server markup and the first client render agree.
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(META_HIDDEN_KEY) ?? "[]");
      if (Array.isArray(saved)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is read after hydration
        setHidden(META_ROWS.filter((row) => saved.includes(row.key)).map((row) => row.key));
      }
    } catch {
      /* unreadable storage — keep both rows open */
    }
  }, []);

  function toggle(key: MetaRowKey) {
    const next = hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key];
    setHidden(next);
    try {
      window.localStorage.setItem(META_HIDDEN_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable — the row still folds for this page view */
    }
  }

  return { hidden, toggle };
}

// The section label doubles as its fold: the twisty sits inside the label's column so
// the chips to the right never move while the row is open.
function MetaLabel({ label, onHide }: { label: string; onHide: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onHide}
      aria-label={t("Hide {section}", { section: label.toLowerCase() })}
      title={t("Hide {section}", { section: label.toLowerCase() })}
      className="flex shrink-0 items-center gap-1 rounded text-left text-small leading-[22px] text-faint transition-colors hover:text-muted"
    >
      <ChevronDown size={11} className="shrink-0" />
      {label}
    </button>
  );
}

// Rendered at the right end of the pill row once a row is folded, so putting it back
// never costs the header a line.
export function MetaRowsMenu({
  hidden,
  onToggle,
}: {
  hidden: MetaRowKey[];
  onToggle: (key: MetaRowKey) => void;
}) {
  const t = useT();
  if (hidden.length === 0) return null;
  return (
    <Menu
      width={190}
      align="right"
      triggerClassName="flex h-6 w-6 items-center justify-center rounded-md text-faint transition-colors hover:bg-elevated hover:text-text"
      trigger={
        <>
          <span className="sr-only">{t("Show project details")}</span>
          <MoreHorizontal size={14} />
        </>
      }
    >
      {() => (
        <>
          {META_ROWS.map(({ key, label }) => (
            <MenuItem key={key} active={!hidden.includes(key)} onSelect={() => onToggle(key)}>
              {t(label)}
            </MenuItem>
          ))}
        </>
      )}
    </Menu>
  );
}

// The project's properties and resources live in the header, to the right of the
// Overview/Tasks/Documents pills, so they stay in view on every tab instead of
// scrolling away with the Overview document.
export function ProjectMeta({
  workspaceId,
  projectId,
  createdBy,
  members,
  workspaceMembers,
  documents,
  resources: initialResources,
  access,
  grants,
  rows,
}: {
  workspaceId: string;
  projectId: string;
  createdBy: string | null;
  members: ProjectMember[];
  workspaceMembers: Member[];
  documents: PageSummary[];
  resources: ProjectResource[];
  access: OverviewAccess;
  grants: OverviewGrant[];
  rows: ReturnType<typeof useMetaRows>;
}) {
  const t = useT();
  const router = useRouter();
  const { openPage } = useUI();
  // Resources are read with the page, then kept locally so adding one lands in the row
  // without waiting for a full refresh.
  const [resources, setResources] = useState(initialResources);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [resourceBusy, setResourceBusy] = useState(false);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [personQuery, setPersonQuery] = useState("");

  const showProperties = !rows.hidden.includes("properties");
  const showResources = !rows.hidden.includes("resources");

  const attachableDocs = useMemo(
    () => documents.filter((page) => !resources.some((resource) => resource.pageId === page.id)),
    [documents, resources]
  );

  async function attachDocument(pageId: string) {
    setResourceError(null);
    const result = await addProjectDocAction(workspaceId, projectId, pageId);
    if (!result.ok) {
      setResourceError(result.error);
      return;
    }
    setResources((prev) => [...prev, result.data]);
  }

  async function createDocument() {
    setResourceError(null);
    const page = await createPageAction(workspaceId, { projectId });
    if (!page.ok) {
      setResourceError(page.error);
      return;
    }
    const attached = await addProjectDocAction(workspaceId, projectId, page.data.id);
    if (!attached.ok) {
      setResourceError(attached.error);
      return;
    }
    router.push(`/${workspaceId}/docs/${page.data.id}`);
  }

  async function addLink(event: FormEvent) {
    event.preventDefault();
    if (!linkUrl.trim() || resourceBusy) return;
    setResourceBusy(true);
    setResourceError(null);
    const result = await addProjectLinkAction(workspaceId, projectId, {
      url: linkUrl,
      title: linkTitle,
    });
    setResourceBusy(false);
    if (!result.ok) {
      setResourceError(result.error);
      return;
    }
    setResources((prev) => [...prev, result.data]);
    setLinkUrl("");
    setLinkTitle("");
    setLinkOpen(false);
  }

  async function removeResource(id: string) {
    setResourceError(null);
    const result = await removeProjectResourceAction(workspaceId, projectId, id);
    if (!result.ok) {
      setResourceError(result.error);
      return;
    }
    setResources((prev) => prev.filter((resource) => resource.id !== id));
  }

  const lead = members.find((member) => member.role === "lead") ?? null;
  const grantRoleByUser = new Map(grants.map((grant) => [grant.userId, grant.role]));
  // One chip per person: project members, plus people who only hold overview access.
  const roster = [
    ...members.filter((member) => member.role !== "lead"),
    ...grants
      .filter((grant) => !members.some((m) => m.id === grant.userId))
      .map((grant) => ({
        id: grant.userId,
        displayName: grant.displayName,
        avatar: grant.avatar,
      })),
  ];
  const candidates = workspaceMembers.filter(
    (member) =>
      member.id !== createdBy && !roster.some((entry) => entry.id === member.id)
  );

  // Joining the team and getting overview access is one gesture: the add menu offers
  // the access level right there, and both facts are written together.
  async function addPerson(userId: string, role: OverviewRole) {
    setError(null);
    const member = await addProjectMemberAction(workspaceId, projectId, userId);
    if (!member.ok) {
      setError(member.error);
      return;
    }
    const grant = await setOverviewGrantAction(workspaceId, projectId, userId, role);
    if (!grant.ok) {
      setError(grant.error);
      return;
    }
    router.refresh();
  }

  async function removePerson(userId: string) {
    setError(null);
    const isMember = members.some((member) => member.id === userId);
    const hasGrant = grants.some((grant) => grant.userId === userId);
    const results = await Promise.all([
      ...(isMember ? [removeProjectMemberAction(workspaceId, projectId, userId)] : []),
      ...(hasGrant ? [removeOverviewGrantAction(workspaceId, projectId, userId)] : []),
    ]);
    for (const result of results) {
      if (!result.ok) {
        setError(result.error);
        return;
      }
    }
    router.refresh();
  }

  async function changeGrant(userId: string, role: OverviewRole | null) {
    setError(null);
    const result = role
      ? await setOverviewGrantAction(workspaceId, projectId, userId, role)
      : await removeOverviewGrantAction(workspaceId, projectId, userId);
    if (!result.ok) setError(result.error);
    else router.refresh();
  }

  const linkResources = resources.filter((resource) => resource.kind === "link");
  const docResources = resources.filter((resource) => resource.kind === "doc");

  // A document's name and icon belong to the page, not to the attachment: deriving them
  // keeps the row in step with a rename made in the pane.
  function documentOf(resource: ProjectResource) {
    return resource.kind === "doc" && resource.pageId
      ? documents.find((document) => document.id === resource.pageId)
      : undefined;
  }

  // Nothing left to show: the header gives the space back to the document.
  if (!showProperties && !showResources) return null;

  return (
    <div className="flex min-w-0 flex-col gap-5 text-body">
      {showProperties && (
        <section className="flex flex-col gap-3">
          <MetaLabel label={t("Properties")} onHide={() => rows.toggle("properties")} />
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="shrink-0 text-small text-faint">{t("Project lead")}</span>
            {lead ? (
              <span className="flex min-w-0 items-center gap-1.5 text-small text-text" title={t("Project lead")}>
                <AssigneeAvatar displayName={lead.displayName} avatar={lead.avatar} size={18} />
                <span className="max-w-[168px] truncate">{lead.displayName}</span>
              </span>
            ) : (
              <span className="text-small text-faint">—</span>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-small text-faint">{t("Overview access")}</span>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
              {roster.map((entry) => {
                const role = grantRoleByUser.get(entry.id) ?? null;
                const isMember = members.some((member) => member.id === entry.id);
                const name = (
                  <>
                    <AssigneeAvatar displayName={entry.displayName} avatar={entry.avatar} size={18} />
                    <span className="max-w-[160px] truncate">{entry.displayName}</span>
                  </>
                );
                // Readers see the same pill without the disclosure or the access level.
                if (!access.manage) {
                  return (
                    <span
                      key={entry.id}
                      className="flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-border py-0.5 pl-0.5 pr-2 text-small text-muted"
                    >
                      {name}
                    </span>
                  );
                }
                return (
                  <Menu
                    key={entry.id}
                    width={200}
                    triggerClassName="group flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-border py-0.5 pl-0.5 pr-2 text-small text-muted transition-colors hover:border-border-strong hover:text-text"
                    trigger={
                      <>
                        {name}
                        <ChevronDown size={11} className="shrink-0 text-faint" />
                      </>
                    }
                  >
                    {(close) => (
                      <>
                        {OVERVIEW_LEVELS.map(({ level, label }) => (
                          <MenuItem
                            key={level}
                            active={role === level}
                            onSelect={() => {
                              close();
                              void changeGrant(entry.id, level);
                            }}
                          >
                            {t(label)}
                          </MenuItem>
                        ))}
                        {(isMember || role) && (
                          <>
                            <div className="my-1 h-px bg-border" />
                            <MenuItem
                              danger
                              onSelect={() => {
                                close();
                                void removePerson(entry.id);
                              }}
                            >
                              {t("Remove")}
                            </MenuItem>
                          </>
                        )}
                      </>
                    )}
                  </Menu>
                );
              })}
              {grants.length === 0 && (
                <span className="text-small text-muted">{t("Owner only")}</span>
              )}
              {access.manage && (
                <Menu
                  width={280}
                  // Last item in the row: a left-anchored panel would run past the card's
                  // right edge and be clipped, so it opens inward instead.
                  align="right"
                  triggerClassName="ml-auto flex size-[22px] shrink-0 items-center justify-center rounded-lg text-faint transition-colors hover:bg-elevated hover:text-text"
                  trigger={
                    <>
                      <span className="sr-only">{t("Add person")}</span>
                      <Plus size={13} />
                    </>
                  }
                >
                  {(close) => (
                    <>
                      <div className="px-2 pb-1 pt-1 text-caption text-faint">{t("Add person")}</div>
                      <div className="px-1 pb-1">
                        <input
                          autoFocus
                          value={personQuery}
                          onChange={(event) => setPersonQuery(event.target.value)}
                          aria-label={t("Search members")}
                          placeholder={t("Search members")}
                          className="h-[34px] rounded-lg px-2.5 w-full border border-border-strong bg-transparent outline-none placeholder:text-faint focus:border-border-strong text-body"
                        />
                      </div>
                      {candidates.filter((member) => member.displayName.toLowerCase().includes(personQuery.trim().toLowerCase())).map((member) => (
                        <div
                          key={member.id}
                          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-body hover:bg-elevated"
                        >
                          <AssigneeAvatar
                            displayName={member.displayName}
                            avatar={member.avatar}
                            size={18}
                          />
                          <span className="min-w-0 flex-1 truncate">{member.displayName}</span>
                          {OVERVIEW_LEVELS.map(({ level, label }) => (
                            <button
                              key={level}
                              type="button"
                              onClick={() => {
                                close();
                                void addPerson(member.id, level);
                              }}
                              className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[30px] rounded-lg px-2.5 text-small border border-border bg-bg text-text hover:bg-active"
                            >
                              {t(label)}
                            </button>
                          ))}
                        </div>
                      ))}
                      {candidates.length === 0 && (
                        <div className="px-2 py-1.5 text-small text-faint">
                          {t("Everyone in the workspace is already here.")}
                        </div>
                      )}
                    </>
                  )}
                </Menu>
              )}
            </div>
          </div>
        </section>
      )}
      {showResources && (
        <section className="flex flex-col gap-1">
          <MetaLabel label={t("Resources")} onHide={() => rows.toggle("resources")} />
          {linkResources.map((resource) => {
            const title = resource.title;
            return (
              <span
                key={resource.id}
                className="group -mx-1 flex min-w-0 items-center gap-1.5 rounded-md px-1 py-1 text-body text-text transition-colors hover:bg-elevated/60"
              >
                <a
                  href={resource.url ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-w-0 flex-1 items-center gap-2"
                >
                  <Link2 size={13} className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate">{title}</span>
                </a>
                {access.canEdit && (
                  <button
                    type="button"
                    aria-label={t("Remove {name}", { name: title })}
                    title={t("Remove")}
                    onClick={() => void removeResource(resource.id)}
                    className="shrink-0 rounded-lg p-0.5 text-faint opacity-0 transition-opacity hover:bg-elevated hover:text-danger group-hover:opacity-100"
                  >
                    <X size={11} />
                  </button>
                )}
              </span>
            );
          })}
          {linkResources.length === 0 && !access.canEdit && (
            <span className="text-small text-faint">{t("None yet")}</span>
          )}
          {access.canEdit && (
            <Menu
              width={260}
              align="right"
              triggerClassName="-mx-1 flex items-center gap-1.5 rounded-md px-1 py-1 text-left text-small text-faint transition-colors hover:bg-elevated/60 hover:text-text"
              trigger={
                <>
                  <span className="sr-only">{t("Add resource")}</span>
                  <Plus size={13} className="shrink-0" />
                  {t("Add resource")}
                </>
              }
            >
              {(close) => (
                <>
                  <MenuItem
                    onSelect={() => {
                      close();
                      setResourceError(null);
                      setLinkOpen(true);
                    }}
                  >
                    <Link2 size={13} className="text-muted" />
                    {t("Link")}
                  </MenuItem>
                  <MenuItem
                    onSelect={() => {
                      close();
                      void createDocument();
                    }}
                  >
                    <FileText size={13} className="text-muted" />
                    {t("New document")}
                  </MenuItem>
                  {attachableDocs.length > 0 && (
                    <>
                      <div className="my-1 border-t border-border" />
                      <div className="px-2 py-1 text-caption font-medium text-faint">
                        {t("Project documents")}
                      </div>
                      {attachableDocs.map((page) => (
                        <MenuItem
                          key={page.id}
                          onSelect={() => {
                            close();
                            void attachDocument(page.id);
                          }}
                        >
                          {page.icon ? (
                            <span className="text-body leading-none">{page.icon}</span>
                          ) : (
                            <FileText size={13} className="text-muted" />
                          )}
                          <span className="min-w-0 flex-1 truncate">
                            {page.title || t("Untitled")}
                          </span>
                        </MenuItem>
                      ))}
                    </>
                  )}
                </>
              )}
            </Menu>
          )}
          {resourceError && (
            <span className="text-small text-danger">{t(resourceError)}</span>
          )}
          {linkOpen && access.canEdit && (
            <form
              onSubmit={addLink}
              className="mt-1 flex w-full flex-col gap-2 rounded-lg border border-border bg-overlay p-2.5 shadow-sm"
            >
              <input
                autoFocus
                value={linkUrl}
                onChange={(event) => setLinkUrl(event.target.value)}
                placeholder={t("Paste a link")}
                className="h-[34px] rounded-lg px-2.5 w-full border border-border-strong bg-bg text-body text-text placeholder:text-faint focus:border-border-strong focus:outline-none"
              />
              <input
                value={linkTitle}
                onChange={(event) => setLinkTitle(event.target.value)}
                placeholder={t("Title (optional)")}
                className="h-[34px] rounded-lg px-2.5 w-full border border-border-strong bg-bg text-body text-text placeholder:text-faint focus:border-border-strong focus:outline-none"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setLinkOpen(false);
                    setLinkUrl("");
                    setLinkTitle("");
                    setResourceError(null);
                  }}
                  className="rounded-md px-2 py-1 text-small text-muted transition-colors hover:bg-elevated hover:text-text"
                >
                  {t("Cancel")}
                </button>
                <button
                  type="submit"
                  disabled={!linkUrl.trim() || resourceBusy}
                  className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[30px] rounded-lg px-2.5 text-small bg-accent font-medium text-white disabled:opacity-40 hover:bg-accent-hover"
                >
                  {resourceBusy ? t("Adding…") : t("Add link")}
                </button>
              </div>
            </form>
          )}
        </section>
      )}
      {(docResources.length > 0 || access.canEdit) && (
        <section className="flex flex-col gap-1">
          <span className="text-small leading-[22px] text-faint">
            {t("Project documents")}
          </span>
          {docResources.map((resource) => {
            const page = documentOf(resource);
            const title = page?.title ?? resource.title;
            const icon = page?.icon ? (
              <span className="text-small leading-none">{page.icon}</span>
            ) : (
              <FileText size={13} className="shrink-0 text-muted" />
            );
            return (
              <span
                key={resource.id}
                className="group -mx-1 flex min-w-0 items-center gap-1.5 rounded-md px-1 py-1 text-body text-text transition-colors hover:bg-elevated/60"
              >
                {page ? (
                  <Link
                    href={`/${workspaceId}/docs/${page.id}`}
                    onClick={(event) => {
                      event.preventDefault();
                      openPage(page.id);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2"
                  >
                    {icon}
                    <span className="min-w-0 flex-1 truncate">{title}</span>
                  </Link>
                ) : (
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    {icon}
                    <span className="min-w-0 flex-1 truncate">{title}</span>
                  </span>
                )}
                {access.canEdit && (
                  <button
                    type="button"
                    aria-label={t("Remove {name}", { name: title })}
                    title={t("Remove")}
                    onClick={() => void removeResource(resource.id)}
                    className="shrink-0 rounded-lg p-0.5 text-faint opacity-0 transition-opacity hover:bg-elevated hover:text-danger group-hover:opacity-100"
                  >
                    <X size={11} />
                  </button>
                )}
              </span>
            );
          })}
          {access.canEdit && (
            <button
              type="button"
              onClick={() => void createDocument()}
              className="-mx-1 flex items-center gap-1.5 rounded-md px-1 py-1 text-left text-small text-faint transition-colors hover:bg-elevated/60 hover:text-text"
            >
              <Plus size={13} className="shrink-0" />
              {t("New document")}
            </button>
          )}
        </section>
      )}
      {error && <span className="text-small text-danger">{t(error)}</span>}
    </div>
  );
}
