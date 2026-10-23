"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check, Pencil, RefreshCw, Trash2, Upload } from "lucide-react";
import {
  createApiKeyAction,
  createProjectAction,
  revokeApiKeyAction,
  saveWorkspaceIconAction,
  trashProjectAction,
  updateProjectAction,
} from "@/app/actions";
import {
  removeMemberAction,
  rotateJoinCodeAction,
  saveAvatarAction,
  setMemberRoleAction,
  deleteWorkspaceAction,
} from "@/app/auth-actions";
import { AssigneeAvatar } from "@/components/issue-table";
import { ProjectIcon, WorkspaceMark } from "@/components/icons";
import { WorkspaceTrashList } from "@/components/workspace-trash-list";
import type { ApiKeyRecord, DeletedWorkspace, Member, Project } from "@/lib/issues";
import { formatDate, timeAgo } from "@/lib/format";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:text-text"
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function Snippet({ code }: { code: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-bg px-3 py-2">
      <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-[12px] leading-relaxed text-muted">
        {code}
      </pre>
      <CopyButton text={code} />
    </div>
  );
}

// Center-crop to a square and downscale in the browser so the stored data URL stays small.
function toSquareDataUrl(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read that image"));
    };
    img.onload = () => {
      try {
        const size = 128;
        const side = Math.min(img.width, img.height);
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas is unavailable");
        ctx.drawImage(
          img,
          (img.width - side) / 2,
          (img.height - side) / 2,
          side,
          side,
          0,
          0,
          size,
          size
        );
        resolve(canvas.toDataURL("image/png"));
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    img.src = objectUrl;
  });
}

export function SettingsView({
  workspace,
  role,
  currentUser,
  members,
  projects,
  keys,
  joinCode,
  isOwner,
  nextWorkspaceHref,
  deletedWorkspaces,
}: {
  workspace: { id: string; name: string; key: string; icon: string | null };
  role: string;
  currentUser: { id: string; username: string; displayName: string; avatar: string | null };
  members: Member[];
  projects: Project[];
  keys: ApiKeyRecord[];
  joinCode: string | null;
  isOwner: boolean;
  nextWorkspaceHref: string;
  deletedWorkspaces: DeletedWorkspace[];
}) {
  const router = useRouter();
  const isAdmin = role === "admin";
  const [code, setCode] = useState(joinCode);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [projName, setProjName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [projError, setProjError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [avatar, setAvatar] = useState(currentUser.avatar);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [icon, setIcon] = useState(workspace.icon);
  const [iconError, setIconError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteWord, setDeleteWord] = useState("");

  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";

  async function rotateCode() {
    const result = await rotateJoinCodeAction(workspace.id);
    if (result.ok) setCode(result.data.code);
  }

  async function createKey() {
    if (!newKeyName.trim()) return;
    setBusy(true);
    const result = await createApiKeyAction(workspace.id, newKeyName);
    setBusy(false);
    if (result.ok) {
      setNewKey(result.data.key);
      setNewKeyName("");
      setKeyError(null);
      router.refresh();
    } else {
      setKeyError(result.error);
    }
  }

  async function revokeKey(key: ApiKeyRecord) {
    if (!window.confirm(`Revoke key "${key.name}"? Agents using it will lose access.`)) return;
    await revokeApiKeyAction(workspace.id, key.id);
    router.refresh();
  }

  async function addProject() {
    if (!projName.trim()) return;
    setBusy(true);
    const result = await createProjectAction(workspace.id, { name: projName });
    setBusy(false);
    if (result.ok) {
      setProjName("");
      setProjError(null);
      router.refresh();
    } else {
      setProjError(result.error);
    }
  }

  async function removeProject(project: Project) {
    if (
      !window.confirm(
        `Move project "${project.name}" and its issues to the Trash? You can restore it from there.`
      )
    )
      return;
    const result = await trashProjectAction(workspace.id, project.id);
    if (!result.ok) setProjError(result.error);
    router.refresh();
  }

  async function saveRename(project: Project, name: string) {
    setRenaming(null);
    const trimmed = name.trim();
    if (!trimmed || trimmed === project.name) return;
    const result = await updateProjectAction(workspace.id, project.id, { name: trimmed });
    if (!result.ok) setProjError(result.error);
    router.refresh();
  }

  async function deleteWorkspaceNow() {
    if (deleteWord.trim() !== "confirmed") return;
    setBusy(true);
    setDeleteError(null);
    const result = await deleteWorkspaceAction(workspace.id, deleteWord);
    setBusy(false);
    if (!result.ok) {
      setDeleteError(result.error);
      return;
    }
    // The page itself disappears with the workspace, so leave the way the switcher does.
    window.location.href = nextWorkspaceHref;
  }

  function closeDeleteDialog() {
    if (busy) return;
    setDeleteOpen(false);
    setDeleteWord("");
    setDeleteError(null);
  }

  async function uploadAvatar(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setAvatarError(null);
    try {
      const result = await saveAvatarAction(await toSquareDataUrl(file));
      if (result.ok) {
        setAvatar(result.data.avatar);
        router.refresh();
      } else {
        setAvatarError(result.error);
      }
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function clearAvatar() {
    setBusy(true);
    setAvatarError(null);
    const result = await saveAvatarAction(null);
    setBusy(false);
    if (result.ok) {
      setAvatar(null);
      router.refresh();
    } else {
      setAvatarError(result.error);
    }
  }

  async function uploadIcon(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setIconError(null);
    try {
      const result = await saveWorkspaceIconAction(workspace.id, await toSquareDataUrl(file));
      if (result.ok) {
        setIcon(result.data);
        router.refresh();
      } else {
        setIconError(result.error);
      }
    } catch (err) {
      setIconError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function clearIcon() {
    setBusy(true);
    setIconError(null);
    const result = await saveWorkspaceIconAction(workspace.id, null);
    setBusy(false);
    if (result.ok) {
      setIcon(null);
      router.refresh();
    } else {
      setIconError(result.error);
    }
  }

  const curlExample = `curl -H "Authorization: Bearer tac_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Fix login redirect","project":"${projects[0]?.key ?? "CORE"}","priority":"high","labels":["Bug"]}' \\
  ${origin}/api/v1/issues`;

  const claudeCodeCmd = `claude mcp add tacos -- npx tsx /absolute/path/to/tacos/mcp/server.ts`;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-2xl space-y-10">
        <header className="flex items-center gap-3">
          <h1 className="text-[16px] font-semibold">Workspace settings</h1>
          <span className="rounded-full bg-elevated px-2 py-0.5 text-[11px] text-muted">
            {workspace.name}
          </span>
        </header>

        <section className="space-y-3">
          <h2 className="text-[13px] font-semibold">Workspace icon</h2>
          <div className="flex items-center gap-4 rounded-lg border border-border p-4">
            <WorkspaceMark icon={icon} className="h-14 w-14" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">{workspace.name}</div>
              {isAdmin && (
                <div className="mt-2 flex items-center gap-2">
                  <label
                    className={`inline-flex cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-1 text-[12px] text-muted transition-colors hover:text-text ${
                      busy ? "pointer-events-none opacity-50" : ""
                    }`}
                  >
                    <Upload size={12} /> {icon ? "Change image" : "Upload image"}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        void uploadIcon(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {icon && (
                    <button
                      type="button"
                      onClick={() => void clearIcon()}
                      className="rounded-md px-2 py-1 text-[12px] text-faint transition-colors hover:text-danger"
                    >
                      Remove
                    </button>
                  )}
                </div>
              )}
              {iconError && <div className="mt-1 text-[12px] text-danger">{iconError}</div>}
            </div>
          </div>
          <p className="text-[12px] leading-relaxed text-faint">
            {isAdmin
              ? "Shown next to the workspace name in the sidebar and the switcher. Without an image, the otter is used. Cropped to a square and resized to 128×128 in the browser."
              : "Only workspace admins can change this icon. Without an image, the otter is used."}
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-[13px] font-semibold">Your profile</h2>
          <div className="flex items-center gap-4 rounded-lg border border-border p-4">
            <AssigneeAvatar displayName={currentUser.displayName} avatar={avatar} size={56} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">{currentUser.displayName}</div>
              <div className="text-[11px] text-faint">@{currentUser.username}</div>
              <div className="mt-2 flex items-center gap-2">
                <label
                  className={`inline-flex cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-1 text-[12px] text-muted transition-colors hover:text-text ${
                    busy ? "pointer-events-none opacity-50" : ""
                  }`}
                >
                  <Upload size={12} /> {avatar ? "Change image" : "Upload image"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      void uploadAvatar(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
                {avatar && (
                  <button
                    type="button"
                    onClick={() => void clearAvatar()}
                    className="rounded-md px-2 py-1 text-[12px] text-faint transition-colors hover:text-danger"
                  >
                    Remove
                  </button>
                )}
              </div>
              {avatarError && <div className="mt-1 text-[12px] text-danger">{avatarError}</div>}
            </div>
          </div>
          <p className="text-[12px] leading-relaxed text-faint">
            Your picture shows as a circle next to your name in issue rows, timelines and the
            member list. It is cropped to a square and resized to 128×128 in the browser before
            being saved.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-[13px] font-semibold">Members ({members.length})</h2>
          <div className="divide-y divide-border rounded-lg border border-border">
            {members.map((member) => (
              <div key={member.id} className="flex items-center gap-3 px-4 py-2.5">
                <AssigneeAvatar displayName={member.displayName} avatar={member.avatar} size={24} />
                <div className="min-w-0">
                  <div className="text-[13px]">
                    {member.displayName}
                    {member.id === currentUser.id && (
                      <span className="ml-1 text-[11px] text-faint">(you)</span>
                    )}
                  </div>
                  <div className="text-[11px] text-faint">@{member.username}</div>
                </div>
                {isAdmin && member.id !== currentUser.id ? (
                  <>
                    <select
                      value={member.role}
                      onChange={(e) => {
                        void setMemberRoleAction(
                          workspace.id,
                          member.id,
                          e.target.value as "admin" | "member"
                        ).then(() => router.refresh());
                      }}
                      className="ml-auto rounded-md border border-border bg-elevated px-1.5 py-1 text-[12px] text-muted"
                    >
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Remove ${member.displayName} from this workspace?`)) {
                          void removeMemberAction(workspace.id, member.id).then(() => router.refresh());
                        }
                      }}
                      className="rounded-md p-1 text-faint transition-colors hover:bg-elevated hover:text-danger"
                      aria-label={`Remove ${member.displayName}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                ) : (
                  <span className="ml-auto rounded-full bg-elevated px-2 py-0.5 text-[11px] text-muted">
                    {member.role}
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="space-y-2 rounded-lg border border-border bg-surface/60 p-4">
            <div className="text-[13px] font-medium">Invite teammates</div>
            <p className="text-[12px] leading-relaxed text-muted">
              Share this join code — anyone can register at{" "}
              <code className="font-mono text-[11px]">{origin}/register</code> and join with it.
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-bg px-2 py-1.5 font-mono text-[13px] text-text">
                {code ?? "No active code"}
              </code>
              {code && <CopyButton text={code} />}
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => void rotateCode()}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[12px] text-muted transition-colors hover:text-text"
                >
                  <RefreshCw size={12} /> Rotate
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-[13px] font-semibold">Projects</h2>
          <div className="divide-y divide-border rounded-lg border border-border">
            {projects.map((project) => {
              const editing = renaming && renaming.id === project.id ? renaming : null;
              return (
                <div key={project.id} className="flex items-center gap-3 px-4 py-2.5">
                  <ProjectIcon color={project.color} size={15} />
                  {editing ? (
                    <>
                      <input
                        autoFocus
                        value={editing.name}
                        onChange={(e) => setRenaming({ id: project.id, name: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveRename(project, editing.name);
                          if (e.key === "Escape") setRenaming(null);
                        }}
                        aria-label={`Rename ${project.name}`}
                        className="min-w-0 flex-1 rounded-md border border-border bg-elevated/50 px-2 py-1 text-[13px] focus:border-border-strong"
                      />
                      <button
                        type="button"
                        onClick={() => void saveRename(project, editing.name)}
                        className="shrink-0 rounded-md bg-accent px-2.5 py-1 text-[12px] font-medium text-white hover:bg-accent-hover"
                      >
                        Save
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setRenaming({ id: project.id, name: project.name })}
                        title="Rename project"
                        className="group flex min-w-0 items-center gap-1.5 text-[13px] hover:text-accent"
                      >
                        <span className="truncate">{project.name}</span>
                        <Pencil
                          size={11}
                          className="shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100"
                        />
                      </button>
                      {/* Only the person who created the project gets to delete it. */}
                      {project.createdBy === currentUser.id && (
                        <button
                          type="button"
                          onClick={() => void removeProject(project)}
                          className="ml-auto rounded-md p-1 text-faint transition-colors hover:bg-elevated hover:text-danger"
                          aria-label={`Move ${project.name} to trash`}
                          title="Move to trash"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              );
            })}
            {projects.length === 0 && (
              <div className="p-4 text-[13px] text-faint">No projects yet.</div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              value={projName}
              onChange={(e) => setProjName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addProject();
              }}
              placeholder="Project name (e.g. Mobile App)"
              className="w-full rounded-md border border-border bg-elevated/50 px-2.5 py-1.5 text-[13px] placeholder:text-faint focus:border-border-strong"
            />
            <button
              type="button"
              onClick={() => void addProject()}
              disabled={busy || !projName.trim()}
              className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:bg-accent-hover disabled:opacity-40"
            >
              Add
            </button>
          </div>
          {projError && <div className="text-[12px] text-danger">{projError}</div>}
        </section>

        <section className="space-y-3">
          <h2 className="text-[13px] font-semibold">Agent access — REST API keys</h2>
          <p className="text-[13px] leading-relaxed text-muted">
            AI agents and scripts read and write issues at{" "}
            <code className="rounded bg-elevated px-1 font-mono text-[12px] text-text">
              /api/v1/*
            </code>{" "}
            with a Bearer token scoped to this workspace ({workspace.key}). Agent activity is
            attributed in every issue timeline.
          </p>

          <div className="flex items-center gap-2">
            <input
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void createKey();
              }}
              placeholder="Key name (e.g. claude-code, triage-bot)"
              className="w-full rounded-md border border-border bg-elevated/50 px-2.5 py-1.5 text-[13px] placeholder:text-faint focus:border-border-strong"
            />
            <button
              type="button"
              onClick={() => void createKey()}
              disabled={!newKeyName.trim() || busy}
              className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:bg-accent-hover disabled:opacity-40"
            >
              Generate
            </button>
          </div>
          {keyError && <div className="text-[12px] text-danger">{keyError}</div>}

          {newKey && (
            <div className="space-y-2 rounded-lg border border-accent/50 bg-accent/10 p-3">
              <div className="text-[12px] font-medium text-text">
                Copy this key now — it is shown only once.
              </div>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-bg px-2 py-1.5 font-mono text-[12px] text-text">
                  {newKey}
                </code>
                <CopyButton text={newKey} />
              </div>
            </div>
          )}

          <div className="divide-y divide-border rounded-lg border border-border">
            {keys.length === 0 && (
              <div className="p-4 text-[13px] text-faint">No keys yet.</div>
            )}
            {keys.map((key) => (
              <div key={key.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                <span className="font-mono text-[12px] text-text">tac_…</span>
                <span>{key.name}</span>
                <span className="text-[12px] text-faint">created {formatDate(key.createdAt)}</span>
                <span suppressHydrationWarning className="text-[12px] text-faint">
                  {key.lastUsedAt ? `last used ${timeAgo(key.lastUsedAt)} ago` : "never used"}
                </span>
                {key.revokedAt ? (
                  <span className="ml-auto rounded-full bg-elevated px-2 py-0.5 text-[11px] text-faint">
                    Revoked
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void revokeKey(key)}
                    className="ml-auto rounded-md border border-border px-2 py-0.5 text-[12px] text-muted transition-colors hover:border-danger hover:text-danger"
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>

          <Snippet code={curlExample} />
        </section>

        <section className="space-y-3">
          <h2 className="text-[13px] font-semibold">Agent access — MCP server</h2>
          <p className="text-[13px] leading-relaxed text-muted">
            For Claude Code / Claude Desktop. The MCP server reads and writes this same database
            directly, so it works even when the web app is closed. It exposes{" "}
            <code className="font-mono text-[12px] text-text">
              list/get/create/update/delete issue, add_comment, list/create label
            </code>{" "}
            with project and assignee support.
          </p>
          <div className="text-[12px] font-medium text-muted">Claude Code</div>
          <Snippet code={claudeCodeCmd} />
          <p className="text-[12px] text-faint">
            For Claude Desktop, add an equivalent{" "}
            <code className="font-mono">mcpServers.tacos</code> entry with{" "}
            <code className="font-mono">npx tsx /path/to/mcp/server.ts</code> in{" "}
            <code className="font-mono">claude_desktop_config.json</code>. See README for details.
          </p>
        </section>

        {isOwner && (
          <section className="space-y-3">
            <h2 className="text-[13px] font-semibold text-danger">Danger zone</h2>
            <div className="flex items-center gap-3 rounded-lg border border-danger/40 bg-danger/5 p-4">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">Delete this workspace</div>
                <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
                  {workspace.name} moves to your recycle bin and every member is notified. You can
                  restore it for 30 days; after that its projects, issues, members and API keys are
                  gone for good.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDeleteError(null);
                  setDeleteWord("");
                  setDeleteOpen(true);
                }}
                disabled={busy}
                className="shrink-0 rounded-md border border-danger px-3 py-1.5 text-[13px] font-medium text-danger transition-colors hover:bg-danger hover:text-white disabled:opacity-40"
              >
                Delete workspace
              </button>
            </div>
          </section>
        )}

        {/* Scoped to workspaces this user owns, so it can render even in someone
            else's settings page. */}
        <WorkspaceTrashList items={deletedWorkspaces} />
      </div>

      {deleteOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={closeDeleteDialog} />
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-workspace-title"
              className="w-[420px] max-w-[94vw] rounded-xl border border-border bg-overlay p-5 shadow-2xl shadow-black/15"
            >
              <h2 id="delete-workspace-title" className="text-[15px] font-semibold">
                Delete “{workspace.name}”?
              </h2>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">
                It goes to your recycle bin for 30 days and every member is notified. Type{" "}
                <code className="rounded bg-elevated px-1 py-0.5 font-mono text-[12px] text-text">
                  confirmed
                </code>{" "}
                to move it there.
              </p>
              <input
                autoFocus
                value={deleteWord}
                onChange={(e) => setDeleteWord(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") closeDeleteDialog();
                  if (e.key === "Enter") void deleteWorkspaceNow();
                }}
                placeholder="confirmed"
                aria-label='Type "confirmed" to delete this workspace'
                className="mt-3 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] outline-none focus:border-danger"
              />
              {deleteError && <div className="mt-2 text-[12px] text-danger">{deleteError}</div>}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeDeleteDialog}
                  disabled={busy}
                  className="rounded-md border border-border px-3 py-1.5 text-[13px] text-muted transition-colors hover:text-text disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void deleteWorkspaceNow()}
                  disabled={busy || deleteWord.trim() !== "confirmed"}
                  className="rounded-md border border-danger px-3 py-1.5 text-[13px] font-medium text-danger transition-colors hover:bg-danger hover:text-white disabled:opacity-40"
                >
                  {busy ? "Deleting…" : "Delete workspace"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
