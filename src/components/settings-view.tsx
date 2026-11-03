"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check, Pencil, RefreshCw, Sparkles, Trash2, Upload } from "lucide-react";
import {
  createApiKeyAction,
  createProjectAction,
  revokeApiKeyAction,
  saveWorkspaceIconAction,
  setMembersSeeAllTasksAction,
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
import {
  saveAiSettingsAction,
  setHarnessEnabledAction,
  runHarnessInstallAction,
  checkHarnessUpdatesAction,
  testAiConnectionAction,
} from "@/app/ai-actions";
import {
  AI_PRESETS,
  type AiEngine,
  type AiProviderId,
  type AiSettingsView,
} from "@/lib/ai-constants";
import { AssigneeAvatar } from "@/components/issue-table";
import { ProjectIcon, WorkspaceMark } from "@/components/icons";
import { WorkspaceTrashList } from "@/components/workspace-trash-list";
import type { ApiKeyRecord, DeletedWorkspace, Member, Project } from "@/lib/issues";
import type { HarnessSettingsView } from "@/lib/harness/types";
import { BUILTIN_AVATARS, BUILTIN_AVATAR_LABELS, builtinAvatarId } from "@/lib/avatars";
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

function engineLabel(engine: AiEngine, model: string): string {
  if (engine === "codex") return "Codex";
  if (engine === "pi") return "Pi";
  return model || "API";
}

export function SettingsView({
  workspace,
  role,
  currentUser,
  members,
  projects,
  keys,
  joinCode,
  membersSeeAllTasks,
  ai,
  harness,
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
  membersSeeAllTasks: boolean;
  ai: AiSettingsView;
  harness: HarnessSettingsView;
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
  const [seeAll, setSeeAll] = useState(membersSeeAllTasks);
  const [aiProvider, setAiProvider] = useState<AiProviderId>(ai.provider);
  const [aiBaseUrl, setAiBaseUrl] = useState(ai.baseUrl || AI_PRESETS[0].baseUrl);
  const [aiModel, setAiModel] = useState(ai.model || AI_PRESETS[0].model);
  const [aiKey, setAiKey] = useState("");
  const [aiEngine, setAiEngine] = useState<AiEngine>(ai.engine);
  const [aiProxy, setAiProxy] = useState(ai.proxy);
  const [aiEnabled, setAiEnabled] = useState(ai.updatedAt ? ai.enabled : true);
  const [aiBusy, setAiBusy] = useState<"save" | "test" | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const [harnessRows, setHarnessRows] = useState(harness.rows);
  const [harnessBusy, setHarnessBusy] = useState<string | null>(null);
  const [harnessError, setHarnessError] = useState<string | null>(null);
  const [harnessNotice, setHarnessNotice] = useState<string | null>(null);

  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";

  async function toggleHarness(id: string, enabled: boolean) {
    if (!isAdmin) return;
    setHarnessBusy(id);
    setHarnessError(null);
    const before = harnessRows;
    setHarnessRows((rows) => rows.map((row) => (row.id === id ? { ...row, enabled } : row)));
    const result = await setHarnessEnabledAction(workspace.id, id, enabled);
    setHarnessBusy(null);
    if (!result.ok) {
      setHarnessRows(before);
      setHarnessError(result.error);
      return;
    }
    router.refresh();
  }


  async function runHarnessRecipe(id: string, mode: "install" | "upgrade") {
    if (!isAdmin) return;
    setHarnessBusy(`${id}:${mode}`);
    setHarnessError(null);
    setHarnessNotice(null);
    const result = await runHarnessInstallAction(workspace.id, id, mode);
    setHarnessBusy(null);
    if (!result.ok) {
      setHarnessError(result.error);
      return;
    }
    setHarnessRows(result.data.rows);
    setHarnessNotice(result.data.message);
  }

  async function checkHarnessUpdates() {
    if (!isAdmin) return;
    setHarnessBusy("check-updates");
    setHarnessError(null);
    setHarnessNotice(null);
    const result = await checkHarnessUpdatesAction(workspace.id);
    setHarnessBusy(null);
    if (!result.ok) {
      setHarnessError(result.error);
      return;
    }
    setHarnessRows(result.data.rows);
    const available = result.data.rows.filter((row) => row.updateAvailable).length;
    setHarnessNotice(
      available > 0
        ? `${available} harness update${available === 1 ? "" : "s"} available.`
        : "All harnesses are up to date on npm."
    );
  }

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

  function pickAiProvider(id: AiProviderId) {
    setAiProvider(id);
    const preset = AI_PRESETS.find((entry) => entry.id === id);
    if (preset && id !== "custom") {
      setAiBaseUrl(preset.baseUrl);
      setAiModel(preset.model);
    }
    setAiError(null);
    setAiNotice(null);
  }

  async function saveAi() {
    if (!isAdmin || aiBusy) return;
    setAiBusy("save");
    setAiError(null);
    setAiNotice(null);
    const result =
      aiEngine === "api"
        ? await saveAiSettingsAction(workspace.id, {
            engine: "api",
            proxy: aiProxy,
            baseUrl: aiBaseUrl,
            model: aiModel,
            ...(aiKey.trim() ? { apiKey: aiKey.trim() } : {}),
            enabled: aiEnabled,
          })
        : await saveAiSettingsAction(workspace.id, {
            engine: aiEngine,
            proxy: aiProxy,
            enabled: aiEnabled,
          });
    setAiBusy(null);
    if (!result.ok) {
      setAiError(result.error);
      return;
    }
    setAiKey("");
    setAiNotice(`Saved — ${engineLabel(result.data.engine, result.data.model)}`);
    router.refresh();
  }

  async function testAi() {
    if (!isAdmin || aiBusy) return;
    setAiBusy("test");
    setAiError(null);
    setAiNotice(null);
    const result = await testAiConnectionAction(workspace.id, {
      baseUrl: aiBaseUrl,
      model: aiModel,
      ...(aiKey.trim() ? { apiKey: aiKey.trim() } : {}),
    });
    setAiBusy(null);
    if (!result.ok) {
      setAiError(result.error);
      return;
    }
    setAiNotice(
      `Connected — ${result.data.model} replied${result.data.sample ? `: “${result.data.sample}”` : "."}`
    );
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
      setAvatar(result.data.avatar);
      router.refresh();
    } else {
      setAvatarError(result.error);
    }
  }

  async function chooseAvatar(value: string) {
    setBusy(true);
    setAvatarError(null);
    const result = await saveAvatarAction(value);
    setBusy(false);
    if (result.ok) {
      setAvatar(result.data.avatar);
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

  async function toggleSeeAll(next: boolean) {
    setSeeAll(next);
    const result = await setMembersSeeAllTasksAction(workspace.id, next);
    if (!result.ok) {
      setSeeAll(!next);
      setProjError(result.error);
      return;
    }
    router.refresh();
  }

  const curlExample = `curl -H "Authorization: Bearer tac_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Fix login redirect","project":"${projects[0]?.key ?? "CORE"}","priority":"high","labels":["Bug"]}' \\
  ${origin}/api/v1/issues`;

  const claudeCodeCmd = `claude mcp add tacos -- npx tsx /absolute/path/to/tacos/mcp/server.ts`;

  return (
    <div className="flex-1 overflow-y-auto px-10 pb-10 pt-6 lg:px-20 xl:px-32">
      <div className="space-y-10">
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
                {avatar && !builtinAvatarId(avatar) && (
                  <button
                    type="button"
                    onClick={() => void clearAvatar()}
                    className="rounded-md px-2 py-1 text-[12px] text-faint transition-colors hover:text-danger"
                  >
                    Remove image
                  </button>
                )}
              </div>
              {avatarError && <div className="mt-1 text-[12px] text-danger">{avatarError}</div>}
            </div>
          </div>
          <div className="rounded-lg border border-border p-4">
            <div className="text-[12px] font-medium text-muted">Avatar library</div>
            <div className="mt-0.5 text-[11.5px] text-faint">
              Every account starts with its own taco ingredient. Pick another one, or upload a picture above.
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {BUILTIN_AVATARS.map((id) => {
                const active = builtinAvatarId(avatar) === id;
                return (
                  <button
                    key={id}
                    type="button"
                    disabled={busy}
                    title={BUILTIN_AVATAR_LABELS[id]}
                    aria-label={BUILTIN_AVATAR_LABELS[id]}
                    aria-pressed={active}
                    onClick={() => void chooseAvatar(`builtin:${id}`)}
                    className={`rounded-full p-0.5 transition ${
                      active ? "ring-2 ring-accent" : "hover:bg-elevated"
                    } ${busy ? "opacity-50" : ""}`}
                  >
                    <AssigneeAvatar
                      displayName={BUILTIN_AVATAR_LABELS[id]}
                      avatar={`builtin:${id}`}
                      size={30}
                    />
                  </button>
                );
              })}
            </div>
          </div>
          <p className="text-[12px] leading-relaxed text-faint">
            Your picture shows as a circle next to your name in issue rows, timelines and the
            member list. Uploaded images are cropped to a square and resized to 128×128 in the
            browser before being saved.
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
          <h2 className="text-[13px] font-semibold">Task visibility</h2>
          <div className="flex items-center gap-4 rounded-lg border border-border p-4">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">
                {seeAll ? "Everyone sees all tasks" : "Members only see their projects"}
              </div>
              <p className="mt-0.5 text-[12px] leading-relaxed text-muted">
                {seeAll
                  ? "Every workspace member can open every project and its tasks."
                  : "A member only sees tasks in projects they created or joined. Owners and admins still see everything."}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={seeAll}
              aria-label="Let every member see all tasks"
              disabled={!isAdmin}
              onClick={() => void toggleSeeAll(!seeAll)}
              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
                seeAll ? "bg-accent" : "bg-border-strong"
              }`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                  seeAll ? "left-[18px]" : "left-0.5"
                }`}
              />
            </button>
          </div>
          <p className="text-[12px] leading-relaxed text-faint">
            {isAdmin
              ? "Turn this off to hand out tasks per project. Agents using API keys or MCP always see everything."
              : "Only workspace admins can change who sees tasks."}
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-[13px] font-semibold">Projects</h2>
          <div className="divide-y divide-border rounded-lg border border-border">
            {projects.map((project) => {
              const editing = renaming && renaming.id === project.id ? renaming : null;
              return (
                <div key={project.id} className="flex items-center gap-3 px-4 py-2.5">
                  <ProjectIcon color={project.color} icon={project.icon} size={15} />
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
                      {/* The project creator, or the workspace owner, may delete it. */}
                      {(project.createdBy === currentUser.id || isOwner) && (
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

        <section className="space-y-3" data-testid="harness-settings">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[13px] font-semibold">Harness</h2>
            <span className="rounded-full bg-elevated px-2 py-0.5 text-[11px] text-faint">
              {harnessRows.filter((row) => row.enabled && row.ready).length} ready
            </span>
            {isAdmin && (
              <button
                type="button"
                disabled={Boolean(harnessBusy)}
                onClick={() => void checkHarnessUpdates()}
                className="ml-auto rounded-md border border-border px-2 py-1 text-[11.5px] text-muted hover:bg-elevated disabled:opacity-40"
              >
                {harnessBusy === "check-updates" ? "Checking…" : "Check for updates"}
              </button>
            )}
          </div>
          <p className="text-[13px] leading-relaxed text-muted">
            Local CLI harnesses for the Agent tab. Turn each one on or off for this workspace.
            The list shows version, ready state, and the last detect error.
          </p>
          <div className="overflow-hidden rounded-lg border border-border">
            {harnessRows.map((row, index) => (
              <div
                key={row.id}
                className={`flex flex-wrap items-start gap-3 px-4 py-3 ${
                  index > 0 ? "border-t border-border" : ""
                }`}
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium text-text">{row.label}</span>
                    <span className="rounded-full bg-elevated px-2 py-0.5 font-mono text-[11px] text-faint">
                      {row.id}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        row.ready ? "bg-accent/10 text-accent" : "bg-elevated text-faint"
                      }`}
                    >
                      {row.ready ? "Ready" : row.installed ? "Not ready" : "Not installed"}
                    </span>
                  </div>
                  <div className="text-[12px] text-muted">
                    Version: {row.version ?? "—"}
                    {row.latestVersion ? (
                      <span className="ml-2 text-faint">Latest: {row.latestVersion}</span>
                    ) : null}
                    {row.updateAvailable ? (
                      <span className="ml-2 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
                        Update available
                      </span>
                    ) : null}
                    {row.binary ? (
                      <span className="ml-2 font-mono text-[11px] text-faint">{row.binary}</span>
                    ) : null}
                  </div>
                  {(row.error || row.hint) && (
                    <div className="text-[12px] text-muted">
                      {row.error ? <span className="text-danger">{row.error}. </span> : null}
                      {row.hint}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {isAdmin && (
                    <>
                      <button
                        type="button"
                        disabled={Boolean(harnessBusy)}
                        onClick={() => void runHarnessRecipe(row.id, "install")}
                        className="rounded-md border border-border px-2 py-1 text-[11.5px] text-muted hover:bg-elevated disabled:opacity-40"
                      >
                        {harnessBusy === `${row.id}:install` ? "Installing…" : "Install"}
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(harnessBusy) || !row.installed}
                        onClick={() => void runHarnessRecipe(row.id, "upgrade")}
                        className="rounded-md border border-border px-2 py-1 text-[11.5px] text-muted hover:bg-elevated disabled:opacity-40"
                      >
                        {harnessBusy === `${row.id}:upgrade` ? "Upgrading…" : "Upgrade"}
                      </button>
                    </>
                  )}
                  <label className="flex items-center gap-2 text-[12.5px] text-muted">
                    <input
                      type="checkbox"
                      checked={row.enabled}
                      disabled={!isAdmin || harnessBusy === `${row.id}` || Boolean(harnessBusy)}
                      onChange={(e) => void toggleHarness(row.id, e.target.checked)}
                      className="h-3.5 w-3.5 accent-[#0d0d0d]"
                    />
                    {row.enabled ? "On" : "Off"}
                  </label>
                </div>
              </div>
            ))}
          </div>
          {harnessError && <div className="text-[12px] text-danger">{harnessError}</div>}
          {harnessNotice && <div className="text-[12px] text-muted">{harnessNotice}</div>}
          {!isAdmin && (
            <p className="text-[12px] text-faint">Only a workspace admin can change harness toggles.</p>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-[13px] font-semibold">AI assistant</h2>
            {ai.configured || ai.cli.some((status) => status.installed && status.signedIn) ? (
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  ai.enabled ? "bg-accent/10 text-accent" : "bg-elevated text-faint"
                }`}
              >
                {ai.enabled ? "On" : "Off"}
              </span>
            ) : (
              <span className="rounded-full bg-elevated px-2 py-0.5 text-[11px] text-faint">
                Not configured
              </span>
            )}
          </div>
          <p className="text-[13px] leading-relaxed text-muted">
            Powers the Agent tab, drafts tasks from a sentence, and rewrites Markdown in projects
            and docs. The Agent can also drive a Codex or Pi CLI that is already signed in on this
            server, so no API key is needed. Keys are stored encrypted and never reach the browser.
          </p>

          {isAdmin ? (
            <div className="space-y-3 rounded-lg border border-border p-4">
              <div className="space-y-1 text-[12px] text-muted">
                <span>Agent engine</span>
                <div className="grid gap-2 sm:grid-cols-3">
                  {(
                    [
                      {
                        id: "api" as AiEngine,
                        label: "API key",
                        sub: ai.configured ? ai.model : "Not configured",
                        ready: ai.configured,
                      },
                      ...ai.cli.map((status) => ({
                        id: status.engine as AiEngine,
                        label: status.label,
                        sub: !status.installed
                          ? "Not installed"
                          : status.signedIn
                            ? (status.model ?? status.account ?? "Signed in")
                            : "Not signed in",
                        ready: status.installed && status.signedIn,
                      })),
                    ]
                  ).map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        setAiEngine(option.id);
                        setAiError(null);
                        setAiNotice(null);
                      }}
                      className={`rounded-md border px-3 py-2 text-left transition-colors ${
                        aiEngine === option.id
                          ? "border-border-strong bg-elevated"
                          : "border-border hover:bg-elevated/60"
                      }`}
                    >
                      <span className="flex items-center gap-1.5 text-[12.5px] font-medium">
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ background: option.ready ? "#2f7d4f" : "var(--color-border-strong)" }}
                        />
                        {option.label}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-faint">
                        {option.sub}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {aiEngine === "api" ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1 text-[12px] text-muted">
                      <span>Provider</span>
                      <select
                        value={aiProvider}
                        onChange={(e) => pickAiProvider(e.target.value as AiProviderId)}
                        className="w-full rounded-md border border-border bg-elevated/50 px-2.5 py-1.5 text-[13px] text-text focus:border-border-strong"
                      >
                        {AI_PRESETS.map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {preset.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1 text-[12px] text-muted">
                      <span>Model</span>
                      <input
                        value={aiModel}
                        onChange={(e) => setAiModel(e.target.value)}
                        placeholder="deepseek-chat"
                        className="w-full rounded-md border border-border bg-elevated/50 px-2.5 py-1.5 text-[13px] text-text placeholder:text-faint focus:border-border-strong"
                      />
                    </label>
                  </div>

                  <label className="block space-y-1 text-[12px] text-muted">
                    <span>Base URL</span>
                    <input
                      value={aiBaseUrl}
                      onChange={(e) => setAiBaseUrl(e.target.value)}
                      placeholder="https://api.deepseek.com/v1"
                      spellCheck={false}
                      className="w-full rounded-md border border-border bg-elevated/50 px-2.5 py-1.5 font-mono text-[12.5px] text-text placeholder:text-faint focus:border-border-strong"
                    />
                    <span className="block text-[11.5px] text-faint">
                      {AI_PRESETS.find((preset) => preset.id === aiProvider)?.hint ??
                        "Requests go to {baseUrl}/chat/completions."}
                    </span>
                  </label>

                  <label className="block space-y-1 text-[12px] text-muted">
                    <span>API key</span>
                    <input
                      type="password"
                      value={aiKey}
                      onChange={(e) => setAiKey(e.target.value)}
                      autoComplete="off"
                      placeholder={
                        ai.configured && ai.keyHint
                          ? `Stored ${ai.keyHint} — leave blank to keep`
                          : "sk-…"
                      }
                      className="w-full rounded-md border border-border bg-elevated/50 px-2.5 py-1.5 font-mono text-[12px] text-text placeholder:text-faint focus:border-border-strong"
                    />
                  </label>
                </>
              ) : (
                (() => {
                  const status = ai.cli.find((entry) => entry.engine === aiEngine);
                  if (!status) return null;
                  return (
                    <div className="space-y-2 rounded-md bg-elevated/60 p-3 text-[12.5px] leading-relaxed">
                      <div className="flex items-center gap-1.5 font-medium text-text">
                        {status.label} CLI
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] ${
                            status.installed && status.signedIn
                              ? "bg-accent/10 text-accent"
                              : "bg-elevated text-faint"
                          }`}
                        >
                          {!status.installed ? "Not installed" : status.signedIn ? "Signed in" : "Not signed in"}
                        </span>
                      </div>
                      {status.binary && (
                        <div className="truncate font-mono text-[11.5px] text-faint">{status.binary}</div>
                      )}
                      {status.hint && <div className="text-muted">{status.hint}</div>}
                      {status.installed && status.signedIn && (
                        <div className="text-faint">
                          Uses the login from this server&apos;s own {status.label} install — no key is
                          stored in TaCos.
                        </div>
                      )}
                    </div>
                  );
                })()
              )}

              {aiEngine !== "api" && (
                <label className="block space-y-1 text-[12px] text-muted">
                  <span>Proxy (optional)</span>
                  <input
                    value={aiProxy}
                    onChange={(e) => setAiProxy(e.target.value)}
                    placeholder="http://127.0.0.1:7890"
                    spellCheck={false}
                    className="w-full rounded-md border border-border bg-elevated/50 px-2.5 py-1.5 font-mono text-[12px] text-text placeholder:text-faint focus:border-border-strong"
                  />
                  <span className="block text-[11.5px] text-faint">
                    Codex and Pi reach their provider directly. Set a local proxy when this machine
                    needs one.
                  </span>
                </label>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-[13px] text-muted">
                  <input
                    type="checkbox"
                    checked={aiEnabled}
                    onChange={(e) => setAiEnabled(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[#0d0d0d]"
                  />
                  Enable AI assistant
                </label>
                <div className="ml-auto flex items-center gap-2">
                  {aiEngine === "api" && (
                    <button
                      type="button"
                      onClick={() => void testAi()}
                      disabled={aiBusy !== null || !aiBaseUrl.trim() || !aiModel.trim()}
                      className="rounded-md border border-border px-2.5 py-1.5 text-[12.5px] font-medium text-muted transition-colors hover:border-border-strong hover:text-text disabled:opacity-40"
                    >
                      {aiBusy === "test" ? "Testing…" : "Test connection"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void saveAi()}
                    disabled={aiBusy !== null || (aiEngine === "api" && (!aiBaseUrl.trim() || !aiModel.trim()))}
                    className="flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
                  >
                    <Sparkles size={12} />
                    {aiBusy === "save" ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
              {aiError && <div className="text-[12px] text-danger">{aiError}</div>}
              {aiNotice && <div className="text-[12px] text-[#2f7d4f]">{aiNotice}</div>}
            </div>
          ) : (
            <div className="rounded-lg border border-border p-4 text-[13px] text-muted">
              {ai.enabled && (ai.configured || ai.cli.some((status) => status.installed && status.signedIn))
                ? "The AI assistant is available in this workspace. A workspace admin manages the provider and key."
                : "AI is not available in this workspace yet. Ask a workspace admin to configure it."}
            </div>
          )}
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
