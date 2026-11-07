"use client";
import { safeAction } from "@/lib/ui/safe-action";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check, RefreshCw, Upload } from "lucide-react";
import {
  createApiKeyAction,
  createProjectAction,
  revokeApiKeyAction,
  rotateApiKeyAction,
  saveWorkspaceIconAction,
  setMembersSeeAllTasksAction,
  trashProjectAction,
  updateProjectAction,
} from "@/app/actions";
import {
  removeMemberAction,
  rotateJoinCodeAction,
  saveAvatarAction,
  saveDisplayNameAction,
  setMemberRoleAction,
  deleteWorkspaceAction,
  saveLocaleAction,
} from "@/app/auth-actions";
import {
  saveAgentRuntimeAction,
  setHarnessEnabledAction,
  runHarnessInstallAction,
  checkHarnessUpdatesAction,
} from "@/app/ai-actions";
import type { AiSettingsView, ModelKeysView } from "@/lib/ai-constants";
import { SettingsPanel, useSettingsPage } from "@/components/settings-shell";
import { useUI } from "@/components/ui-context";
import { SETTINGS_PAGE, SETTINGS_SCROLL } from "@/lib/page-chrome";
import { ModelKeysSection } from "@/components/model-keys-section";
import { AgentSettingsSection } from "@/components/agent-settings-section";
import { AgentUsageSection } from "@/components/agent-usage-section";
import { Switch } from "@/components/ui/switch";
import { HarnessSubscription } from "@/components/harness-subscription";
import type { AgentView } from "@/lib/workspace-agents";
import type { AgentUsageSummary } from "@/lib/agent-usage";
import { AssigneeAvatar } from "@/components/issue-table";
import { ProjectIcon, WorkspaceMark } from "@/components/icons";
import { LabelsManager } from "@/components/labels-manager";
import { PageTemplatesManager } from "@/components/page-templates-manager";
import { AutomationSettingsSection } from "@/components/automation-settings-section";
import { CycleSettingsSection } from "@/components/cycle-settings-section";
import type { AutomationSettingsView } from "@/lib/automations/store";
import type { CycleSettings, CycleSummary } from "@/lib/planning/cycles";
import type { ApiKeyRecord, ApiKeyScope, Label, Member, Project } from "@/lib/issues";
import type { HarnessSettingsView } from "@/lib/harness/types";
import type { PageTemplate } from "@/lib/page-templates";
import { BUILTIN_AVATARS, BUILTIN_AVATAR_LABELS, builtinAvatarId } from "@/lib/avatars";
import { formatDate, timeAgo } from "@/lib/format";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/lib/i18n";
import { interpolate, useLocale, useT } from "@/components/i18n-context";

const ROW_BUTTON =
  "shrink-0 rounded-md border border-border px-2 py-1 text-small text-muted transition-colors hover:bg-elevated hover:text-text disabled:opacity-40";
const ROW_BADGE = "shrink-0 rounded-full bg-elevated px-2 py-0.5 text-caption text-muted";

function CopyButton({ text, label }: { text: string; label?: string }) {
  const t = useT();
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
      className={label ? ROW_BUTTON : "inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-caption text-muted transition-colors hover:text-text"}
    >
      {!label && (copied ? <Check size={11} /> : <Copy size={11} />)}
      {copied ? t("Copied") : label ?? t("Copy")}
    </button>
  );
}

function Snippet({ code }: { code: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-bg px-3 py-2">
      <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-small leading-relaxed text-muted">
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

function shellQuote(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}

const subscribeNever = () => () => {};

export function SettingsView({
  workspace,
  role,
  currentUser,
  members,
  projects,
  labels,
  keys,
  now,
  joinCode,
  membersSeeAllTasks,
  ai,
  mcpServerPath,
  modelKeys,
  serverMode,
  harness,
  isOwner,
  nextWorkspaceHref,
  pageTemplates,
  canManagePageTemplates,
  agents,
  agentUsage,
  automations,
  cycleSettings,
  cycles,
}: {
  workspace: { id: string; name: string; key: string; icon: string | null };
  role: string;
  currentUser: { id: string; username: string; displayName: string; avatar: string | null };
  members: Member[];
  projects: Project[];
  labels: Array<Label & { issueCount: number }>;
  keys: ApiKeyRecord[];
  now: string;
  joinCode: string | null;
  membersSeeAllTasks: boolean;
  ai: AiSettingsView;
  mcpServerPath: string | null;
  modelKeys: ModelKeysView;
  serverMode: boolean;
  harness: HarnessSettingsView;
  isOwner: boolean;
  nextWorkspaceHref: string;
  pageTemplates: PageTemplate[];
  canManagePageTemplates: boolean;
  agents: AgentView[];
  agentUsage: AgentUsageSummary;
  automations: AutomationSettingsView;
  cycleSettings: CycleSettings;
  cycles: CycleSummary[];
}) {
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
  const {confirm,density,setDensity}=useUI();
  const root=useRef<HTMLDivElement>(null);
  const settingsPage=useSettingsPage();
  useEffect(()=>{root.current?.scrollTo({top:0});},[settingsPage]);
  const memberLocks=useRef(new Set<string>());
  const [memberBusy,setMemberBusy]=useState<string[]>([]),[memberErrors,setMemberErrors]=useState<Record<string,string>>({}),[visibilityError,setVisibilityError]=useState<string|null>(null),[visibilityBusy,setVisibilityBusy]=useState(false);
  async function memberChange(id:string,work:()=>Promise<{ok:boolean;error?:string}>){if(memberLocks.current.has(id))return;memberLocks.current.add(id);setMemberBusy([...memberLocks.current]);try{const result=await work();if(!result.ok)throw new Error(result.error);setMemberErrors(old=>{const next={...old};delete next[id];return next;});router.refresh();}catch(error){setMemberErrors(old=>({...old,[id]:error instanceof Error?error.message:"Could not save. Retry."}));}finally{memberLocks.current.delete(id);setMemberBusy([...memberLocks.current]);}}
  const isAdmin = role === "admin";
  const canCreatePermanentKey = isAdmin || isOwner;
  const [code, setCode] = useState(joinCode);
  const [keyFormOpen, setKeyFormOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [newKeyScopes, setNewKeyScopes] = useState({ read: true, write: true });
  const [newKeyExpiry, setNewKeyExpiry] = useState("90");
  const [newKeyProjectMode, setNewKeyProjectMode] = useState<"all" | "selected">("all");
  const [newKeyProjectIds, setNewKeyProjectIds] = useState<string[]>([]);
  const [rotatingKeyId, setRotatingKeyId] = useState<string | null>(null);
  const [projName, setProjName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [projError, setProjError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [avatar, setAvatar] = useState(currentUser.avatar);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState(currentUser.displayName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [icon, setIcon] = useState(workspace.icon);
  const [iconError, setIconError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteWord, setDeleteWord] = useState("");
  const [seeAll, setSeeAll] = useState(membersSeeAllTasks);
  const [aiProxy, setAiProxy] = useState(ai.proxy);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const [harnessRows, setHarnessRows] = useState(harness.rows);
  const [harnessGateView, setHarnessGateView] = useState(harness.gate);
  const [harnessBusy, setHarnessBusy] = useState<string | null>(null);
  const harnessUpdateSeq = useRef(0);
  const [harnessError, setHarnessError] = useState<string | null>(null);
  const [harnessNotice, setHarnessNotice] = useState<string | null>(null);

  const origin = useSyncExternalStore(subscribeNever, () => window.location.origin, () => "http://localhost:3000");

  async function toggleHarness(id: string, enabled: boolean) {
    if (!isAdmin) return;
    setHarnessBusy(id);
    setHarnessError(null);
    const before = harnessRows;
    setHarnessRows((rows) => rows.map((row) => (row.id === id ? { ...row, enabled } : row)));
    const result = await safeAction(async()=>setHarnessEnabledAction(workspace.id, id, enabled));
    setHarnessBusy(null);
    if (!result.ok) {
      setHarnessRows(before);
      setHarnessError(result.error);
      return;
    }
    const nextRows = before.map((row) => (row.id === id ? { ...row, enabled } : row));
    setHarnessRows(nextRows);
    const enabledReady = nextRows.filter((row) => row.enabled && row.ready);
    const anyEnabled = nextRows.some((row) => row.enabled);
    setHarnessGateView({
      enabledReady,
      anyReady: enabledReady.length > 0,
      agentAllowed: anyEnabled && enabledReady.length > 0,
    });
  }


  async function runHarnessRecipe(id: string, mode: "install" | "upgrade") {
    if (!isAdmin) return;
    setHarnessBusy(`${id}:${mode}`);
    setHarnessError(null);
    setHarnessNotice(null);
    const result = await safeAction(async()=>runHarnessInstallAction(workspace.id, id, mode));
    setHarnessBusy(null);
    if (!result.ok) {
      setHarnessError(result.error);
      return;
    }
    setHarnessRows(result.data.rows);
    const enabledReady = result.data.rows.filter((row) => row.enabled && row.ready);
    const anyEnabled = result.data.rows.some((row) => row.enabled);
    setHarnessGateView({
      enabledReady,
      anyReady: enabledReady.length > 0,
      agentAllowed: anyEnabled && enabledReady.length > 0,
    });
    setHarnessNotice(result.data.message);
    // The new version may already be behind, and these rows carry no update info.
    void readHarnessUpdates(false);
  }

  // Only the update fields are taken: a toggle made while this runs must not be undone,
  // and only the newest check counts, so one begun before an upgrade can't bring back its button.
  async function readHarnessUpdates(force: boolean) {
    const seq = ++harnessUpdateSeq.current;
    const result = await safeAction(async()=>checkHarnessUpdatesAction(workspace.id, force));
    if (seq !== harnessUpdateSeq.current) return null;
    if (result.ok) {
      setHarnessRows((rows) =>
        rows.map((row) => {
          const fresh = result.data.rows.find((entry) => entry.id === row.id);
          return fresh
            ? {
                ...row,
                latestVersion: fresh.latestVersion,
                updateAvailable: fresh.updateAvailable,
                updateCheckFailed: fresh.updateCheckFailed,
              }
            : row;
        })
      );
    }
    return result;
  }

  // Upgrade only shows when an update exists, so the page has to find out by itself.
  useEffect(() => {
    if (isAdmin) void readHarnessUpdates(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkHarnessUpdates() {
    if (!isAdmin) return;
    setHarnessBusy("check-updates");
    setHarnessError(null);
    setHarnessNotice(null);
    const result = await readHarnessUpdates(true);
    setHarnessBusy(null);
    if (!result) return;
    if (!result.ok) {
      setHarnessError(result.error);
      return;
    }
    const available = result.data.rows.filter((row) => row.updateAvailable).length;
    const failed = result.data.rows.filter((row) => row.updateCheckFailed).map((row) => row.label);
    // "Up to date" is only true of the harnesses npm actually answered for.
    setHarnessNotice(
      [
        available > 0
          ? t(available === 1 ? "{count} harness update available." : "{count} harness updates available.", { count: String(available) })
          : failed.length === 0
            ? t("All installed harnesses are up to date.")
            : "",
        failed.length > 0 ? t("Could not check for updates: {names}.", { names: failed.join(", ") }) : "",
      ]
        .filter(Boolean)
        .join(" ")
    );
  }

  const [localeError, setLocaleError] = useState<string | null>(null);

  async function chooseLocale(next: Locale) {
    if (next === locale) return;
    setLocaleError(null);
    const result = await safeAction(async()=>saveLocaleAction(next));
    if (!result.ok) {
      setLocaleError(result.error);
      return;
    }
    router.refresh();
  }

  async function rotateCode() {
    const result = await safeAction(async()=>rotateJoinCodeAction(workspace.id));
    if (result.ok) setCode(result.data.code);
  }

  async function createKey() {
    if (!newKeyName.trim() || busy) return;
    if (newKeyProjectMode === "selected" && newKeyProjectIds.length === 0) {
      setKeyError(t("Pick at least one project."));
      return;
    }
    const scopes: ApiKeyScope[] = [];
    if (newKeyScopes.read) scopes.push("read");
    if (newKeyScopes.write) scopes.push("write");
    if (scopes.length === 0) {
      setKeyError(t("Pick at least the read scope."));
      return;
    }
    setBusy(true);
    const result = await safeAction(async()=>createApiKeyAction(workspace.id, {
      name: newKeyName,
      scopes,
      projectIds: newKeyProjectMode === "selected" ? newKeyProjectIds : null,
      expiresInDays: newKeyExpiry === "never" ? null : Number(newKeyExpiry),
    }));
    setBusy(false);
    if (result.ok) {
      setNewKey(result.data.key);
      setNewKeyName("");
      setNewKeyProjectIds([]);
      setNewKeyProjectMode("all");
      setKeyError(null);
      router.refresh();
    } else {
      setKeyError(result.error);
    }
  }

  async function rotateKey(key: ApiKeyRecord) {
    if (rotatingKeyId) return;
    if (!await confirm(t('Rotate key "{name}"?', { name: key.name }), { body: t("The old key stops working immediately."), action: t("Rotate") })) return;
    setRotatingKeyId(key.id);
    const result = await safeAction(async()=>rotateApiKeyAction(workspace.id, key.id));
    setRotatingKeyId(null);
    if (!result.ok) {
      setKeyError(result.error);
      return;
    }
    setNewKey(result.data.key);
    setKeyError(null);
    router.refresh();
  }

  async function revokeKey(key: ApiKeyRecord) {
    if (!await confirm(t("Revoke key \"{name}\"?", { name: key.name }), { body: t("Agents using it will lose access."), action: t("Revoke") })) return;
    try{const result=await safeAction(async()=>revokeApiKeyAction(workspace.id,key.id));if(!result.ok)setKeyError(result.error);else router.refresh();}catch{setKeyError("Could not save. Retry.");}
  }

  async function saveRuntime() {
    if (!isAdmin || aiBusy) return;
    setAiBusy(true);
    setAiError(null);
    setAiNotice(null);
    const result = await safeAction(async()=>saveAgentRuntimeAction(workspace.id, { proxy: aiProxy }));
    setAiBusy(false);
    if (!result.ok) {
      setAiError(result.error);
      return;
    }
    setAiNotice(t("Saved."));
    router.refresh();
  }

  async function addProject() {
    if (!projName.trim()) return;
    setBusy(true);
    const result = await safeAction(async()=>createProjectAction(workspace.id, { name: projName }));
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
      !await confirm(
        t("Move project \"{name}\" and its issues to the Trash?", { name: project.name }),
        { body: t("You can restore it from there."), action: t("Move to Trash") }
      )
    )
      return;
    const result = await safeAction(async()=>trashProjectAction(workspace.id, project.id));
    if (!result.ok) setProjError(result.error);
    router.refresh();
  }

  async function saveRename(project: Project, name: string) {
    const trimmed = name.trim();
    if (!trimmed || trimmed === project.name) return;
    const result = await safeAction(async()=>updateProjectAction(workspace.id, project.id, { name: trimmed }));
    if (!result.ok) setProjError(result.error);
    else {setRenaming(null);setProjError(null);router.refresh();}
  }

  async function deleteWorkspaceNow() {
    if (deleteWord.trim() !== "confirmed") return;
    setBusy(true);
    setDeleteError(null);
    const result = await safeAction(async()=>deleteWorkspaceAction(workspace.id, deleteWord));
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
      const result = await safeAction(async()=>saveAvatarAction(await toSquareDataUrl(file)));
      if (result.ok) {
        setAvatar(result.data.avatar);
        router.refresh();
      } else {
        setAvatarError(result.error);
      }
    } catch (err) {
      setAvatarError(err instanceof Error ? t(err.message) : t("Upload failed"));
    } finally {
      setBusy(false);
    }
  }

  async function saveDisplayName() {
    const name = displayName.trim();
    if (name === currentUser.displayName) {
      setDisplayName(name);
      setNameError(null);
      return;
    }
    setBusy(true);
    setNameError(null);
    const result = await saveDisplayNameAction(name);
    setBusy(false);
    if (result.ok) {
      setDisplayName(name);
      router.refresh();
    } else {
      setNameError(result.error);
    }
  }

  async function clearAvatar() {
    setBusy(true);
    setAvatarError(null);
    const result = await safeAction(async()=>saveAvatarAction(null));
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
    const result = await safeAction(async()=>saveAvatarAction(value));
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
      const result = await safeAction(async()=>saveWorkspaceIconAction(workspace.id, await toSquareDataUrl(file)));
      if (result.ok) {
        setIcon(result.data);
        router.refresh();
      } else {
        setIconError(result.error);
      }
    } catch (err) {
      setIconError(err instanceof Error ? t(err.message) : t("Upload failed"));
    } finally {
      setBusy(false);
    }
  }

  async function clearIcon() {
    setBusy(true);
    setIconError(null);
    const result = await safeAction(async()=>saveWorkspaceIconAction(workspace.id, null));
    setBusy(false);
    if (result.ok) {
      setIcon(null);
      router.refresh();
    } else {
      setIconError(result.error);
    }
  }

  async function toggleSeeAll(next:boolean){if(visibilityBusy)return;setVisibilityBusy(true);setSeeAll(next);try{const result=await safeAction(async()=>setMembersSeeAllTasksAction(workspace.id,next));if(!result.ok)throw new Error(result.error);setVisibilityError(null);router.refresh();}catch(error){setSeeAll(!next);setVisibilityError(error instanceof Error?error.message:"Could not save. Retry.");}finally{setVisibilityBusy(false);}}

  const curlExample = `curl -H "Authorization: Bearer tac_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Fix login redirect","project":"${projects[0]?.key ?? "CORE"}","priority":"high","labels":["Bug"]}' \\
  ${origin}/api/v1/issues`;

  const mcpCommand = mcpServerPath
    ? `npx --prefix ${shellQuote(mcpServerPath.replace(/\/mcp\/server\.ts$/, ""))} tsx ${shellQuote(mcpServerPath)}`
    : null;

  return (
    <div ref={root} className={SETTINGS_SCROLL}>
      <div className={`max-w-[720px] ${SETTINGS_PAGE}`}>
        <SettingsPanel id="profile" title={t("Your profile")}>
        <section className="space-y-2.5">
          <h2 className="text-body font-semibold">{t("Avatar")}</h2>
          <div className="flex flex-wrap items-center gap-2.5">
            <AssigneeAvatar displayName={currentUser.displayName} avatar={avatar} size={40} />
            <label
              className={`inline-flex cursor-pointer items-center gap-1 rounded-md border border-border px-2.5 py-1 text-small text-muted transition-colors hover:text-text ${
                busy ? "pointer-events-none opacity-50" : ""
              }`}
            >
              <Upload size={12} /> {avatar ? t("Change image") : t("Upload image")}
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
                className="rounded-md px-2 py-1 text-small text-faint transition-colors hover:text-danger"
              >
                {t("Remove image")}
              </button>
            )}
          </div>
          {avatarError && <div className="text-small text-danger">{t(avatarError)}</div>}
          <p className="text-small leading-relaxed text-faint">
            {t("Your picture shows as a circle next to your name in issue rows, timelines and the member list. Uploaded images are cropped to a square and resized to 128×128 in the browser before being saved.")}
          </p>
        </section>
        <section className="space-y-2.5">
          <h2 className="text-body font-semibold">{t("Avatar library")}</h2>
          <div className="flex flex-wrap gap-1.5">
            {BUILTIN_AVATARS.map((id) => {
              const active = builtinAvatarId(avatar) === id;
              return (
                <button
                  key={id}
                  type="button"
                  disabled={busy}
                  title={t(BUILTIN_AVATAR_LABELS[id])}
                  aria-label={t(BUILTIN_AVATAR_LABELS[id])}
                  aria-pressed={active}
                  onClick={() => void chooseAvatar(`builtin:${id}`)}
                  className={`rounded-full p-0.5 transition ${
                    active ? "ring-2 ring-accent" : "hover:bg-elevated"
                  } ${busy ? "opacity-50" : ""}`}
                >
                  <AssigneeAvatar
                    displayName={t(BUILTIN_AVATAR_LABELS[id])}
                    avatar={`builtin:${id}`}
                    size={30}
                  />
                </button>
              );
            })}
          </div>
          <p className="text-small leading-relaxed text-faint">
            {t("Every account starts with its own taco ingredient. Pick another one, or upload a picture above.")}
          </p>
        </section>
        <section className="space-y-2.5">
          <h2 className="text-body font-semibold">{t("Display name")}</h2>
          <div className="flex items-center gap-2">
            <input
              value={displayName}
              maxLength={40}
              disabled={busy}
              aria-label={t("Display name")}
              onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveDisplayName();
              }}
              className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2.5 py-1.5 text-body text-text focus:border-border-strong focus:outline-none"
            />
            <button
              type="button"
              disabled={busy || displayName.trim() === currentUser.displayName}
              onClick={() => void saveDisplayName()}
              className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-body font-medium text-white hover:bg-accent-hover disabled:opacity-40"
            >
              {t("Save")}
            </button>
          </div>
          {nameError && <div className="text-small text-danger">{t(nameError)}</div>}
          <div className="text-caption text-faint">@{currentUser.username}</div>
        </section>
        <section className="space-y-3"><h2 className="text-body font-semibold">{t("Display density")}</h2><div className="flex gap-1 text-small">{(["comfortable","compact"] as const).map(value=><button key={value} aria-pressed={density===value} onClick={()=>setDensity(value)} className={`rounded-md px-3 py-1 transition-colors ${density===value?"bg-elevated font-medium text-text":"text-muted hover:bg-elevated hover:text-text"}`}>{t(value==="compact"?"Compact":"Comfortable")}</button>)}</div></section>
        <section className="space-y-3">
          <h2 className="text-body font-semibold">{t("Language")}</h2>
          <div>
            <div role="radiogroup" aria-label={t("Interface language")} className="flex gap-1">
              {LOCALES.map((code) => (
                <button
                  key={code}
                  type="button"
                  role="radio"
                  aria-checked={locale === code}
                  onClick={() => void chooseLocale(code)}
                  className={`rounded-md px-3 py-1 text-small transition-colors ${
                    locale === code
                      ? "bg-elevated font-medium text-text"
                      : "text-muted hover:bg-elevated hover:text-text"
                  }`}
                >
                  {LOCALE_LABELS[code]}
                </button>
              ))}
            </div>
          </div>
          {localeError && <div className="text-small text-danger">{t(localeError)}</div>}
          <p className="text-small leading-relaxed text-faint">
            {t("Applies to this account on every device.")} {t("Task content, documents and replies from the API or MCP server are not translated.")}
          </p>
        </section>
        </SettingsPanel>

        <SettingsPanel id="general" title={t("Basics and icon")}>
        <section className="space-y-3">
          <h2 className="text-body font-semibold">{t("Workspace icon")}</h2>
          <div className="flex items-center gap-3">
            <WorkspaceMark icon={icon} className="h-10 w-10" />
            <div className="min-w-0 flex-1">
              <div className="text-body font-medium">{workspace.name}</div>
              {isAdmin && (
                <div className="mt-1.5 flex items-center gap-2">
                  <label
                    className={`inline-flex cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-1 text-small text-muted transition-colors hover:text-text ${
                      busy ? "pointer-events-none opacity-50" : ""
                    }`}
                  >
                    <Upload size={12} /> {icon ? t("Change image") : t("Upload image")}
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
                      className="rounded-md px-2 py-1 text-small text-faint transition-colors hover:text-danger"
                    >
                      {t("Remove")}
                    </button>
                  )}
                </div>
              )}
              {iconError && <div className="mt-1 text-small text-danger">{t(iconError)}</div>}
            </div>
          </div>
          <p className="text-small leading-relaxed text-faint">
            {isAdmin
              ? t("Shown next to the workspace name in the sidebar and the switcher. Without an image, the otter is used. Cropped to a square and resized to 128×128 in the browser.")
              : t("Only workspace admins can change this icon. Without an image, the otter is used.")}
          </p>
        </section>
        </SettingsPanel>

        <SettingsPanel id="members" title={t("Members")}>
        <section className="space-y-3">
          <h2 className="text-body font-semibold">
            {t("Members ({count})", { count: members.length })}
          </h2>
          <div className="divide-y divide-border rounded-lg border border-border">
            {members.map((member) => (
              <div key={member.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                <AssigneeAvatar displayName={member.displayName} avatar={member.avatar} size={24} />
                <div className="min-w-0">
                  <div className="text-body">
                    {member.displayName}
                    {member.id === currentUser.id && (
                      <span className="ml-1 text-caption text-faint">{t("(you)")}</span>
                    )}
                  </div>
                  <div className="text-caption text-faint">@{member.username}</div>
                </div>
                {isAdmin && member.id !== currentUser.id ? (
                  <>
                    <select
                      value={member.role}
                      disabled={memberBusy.includes(member.id)}
                      onChange={(e) => {const role=e.target.value as "admin"|"member";void memberChange(member.id,()=>setMemberRoleAction(workspace.id,member.id,role));}}
                      className="ml-auto rounded-md border border-border bg-elevated px-1.5 py-1 text-small text-muted"
                    >
                      <option value="admin">{t("Admin")}</option>
                      <option value="member">{t("Member")}</option>
                    </select>
                    <button
                      type="button"
                      disabled={memberBusy.includes(member.id)}
                      onClick={async () => {
                        if (await confirm(t("Remove {name} from this workspace?", { name: member.displayName }), { action: t("Remove") })) {
                          void memberChange(member.id,()=>removeMemberAction(workspace.id,member.id));
                        }
                      }}
                      className="rounded-md border border-border px-2.5 py-1 text-small text-muted transition-colors hover:text-danger disabled:opacity-50"
                      aria-label={t("Remove {name}", { name: member.displayName })}
                    >
                      {t("Remove")}
                    </button>
                  </>
                ) : (
                  <span className="ml-auto rounded-full bg-elevated px-2 py-0.5 text-caption text-muted">
                    {member.role === "admin" ? t("Admin") : t("Member")}
                  </span>
                )}
                {memberErrors[member.id]&&<p role="alert" className="w-full text-small text-danger">{t(memberErrors[member.id])}</p>}
              </div>
            ))}
          </div>
        </section>
        <section className="space-y-2.5">
          <h2 className="text-body font-semibold">{t("Invite teammates")}</h2>
            <p className="text-small leading-relaxed text-faint">
              {interpolate(t("Share this join code — anyone can register at {url} and join with it."), {
                url: <code className="font-mono text-caption">{origin}/register</code>,
              })}
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={code ?? t("No active code")}
                aria-label={t("Invite teammates")}
                className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2.5 py-1.5 font-mono text-body text-text focus:outline-none"
              />
              {code && <CopyButton text={code} />}
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => void rotateCode()}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-small text-muted transition-colors hover:text-text"
                >
                  <RefreshCw size={12} /> {t("Rotate")}
                </button>
              )}
            </div>
        </section>
        </SettingsPanel>

        <SettingsPanel id="visibility" title={t("Task visibility")}>
        <section className="space-y-2.5">
          {visibilityError&&<p role="alert" className="text-small text-danger">{t(visibilityError)}</p>}
          <div role="radiogroup" aria-label={t("Task visibility")} className="divide-y divide-border rounded-lg border border-border">
            {([
              [true, t("Everyone sees all tasks"), t("Every workspace member can open every project and its tasks.")],
              [false, t("Members only see their projects"), t("A member only sees tasks in projects they created or joined. Owners and admins still see everything.")],
            ] as const).map(([value, title, hint]) => (
              <label key={String(value)} className="flex items-start gap-2.5 px-4 py-2.5">
                <input
                  type="radio"
                  name="task-visibility"
                  className="mt-1 accent-[var(--color-accent)]"
                  checked={seeAll === value}
                  disabled={!isAdmin || visibilityBusy}
                  onChange={() => void toggleSeeAll(value)}
                />
                <span className="min-w-0">
                  <span className="block text-body">{title}</span>
                  <span className="block text-small leading-relaxed text-faint">{hint}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="text-small leading-relaxed text-faint">
            {isAdmin
              ? t("Turn this off to hand out tasks per project. Agents using API keys or MCP always see everything.")
              : t("Only workspace admins can change who sees tasks.")}
          </p>
        </section>
        </SettingsPanel>

        <SettingsPanel id="projects" title={t("Projects")}>
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              value={projName}
              onChange={(e) => setProjName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addProject();
              }}
              placeholder={t("Project name (e.g. Mobile App)")}
              aria-label={t("Project name (e.g. Mobile App)")}
              className="w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-body text-text placeholder:text-faint focus:border-border-strong focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void addProject()}
              disabled={busy || !projName.trim()}
              className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-body font-medium text-white hover:bg-accent-hover disabled:opacity-40"
            >
              {t("Add")}
            </button>
          </div>
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
                        aria-label={t("Rename {name}", { name: project.name })}
                        className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1 text-body text-text focus:border-border-strong focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => void saveRename(project, editing.name)}
                        className="shrink-0 rounded-md bg-accent px-2.5 py-1 text-small font-medium text-white hover:bg-accent-hover"
                      >
                        {t("Save")}
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate text-body">{project.name}</span>
                      <button
                        type="button"
                        onClick={() => setRenaming({ id: project.id, name: project.name })}
                        className="shrink-0 rounded-md border border-border px-2.5 py-1 text-small text-muted transition-colors hover:text-text"
                      >
                        {t("Rename")}
                      </button>
                      {/* The project creator, or the workspace owner, may delete it. */}
                      {(project.createdBy === currentUser.id || isOwner) && (
                        <button
                          type="button"
                          onClick={() => void removeProject(project)}
                          className="shrink-0 rounded-md px-2 py-1 text-small text-muted transition-colors hover:bg-elevated hover:text-danger"
                          aria-label={t("Move {name} to trash", { name: project.name })}
                        >
                          {t("Move to trash")}
                        </button>
                      )}
                    </>
                  )}
                </div>
              );
            })}
            {projects.length === 0 && (
              <div className="p-4 text-body text-faint">{t("No projects yet.")}</div>
            )}
          </div>
          {projError && <div className="text-small text-danger">{t(projError)}</div>}
        </section>
        </SettingsPanel>

        <SettingsPanel id="page-templates" title={t("Page templates")}>
        <section id="page-templates" className="scroll-mt-6 space-y-3">
          <PageTemplatesManager
            workspaceId={workspace.id}
            initialTemplates={pageTemplates}
            canManage={canManagePageTemplates}
          />
        </section>
        </SettingsPanel>

        <SettingsPanel id="cycles" title={t("Cycle settings")}>
        <section id="cycles" className="scroll-mt-6 space-y-3">
          <CycleSettingsSection
            workspaceId={workspace.id}
            settings={cycleSettings}
            cycles={cycles}
            isAdmin={isAdmin}
          />
        </section>
        </SettingsPanel>

        <SettingsPanel id="automations" title={t("Automations")}>
        <section id="automations" className="scroll-mt-6 space-y-3" data-testid="automation-settings">
          <AutomationSettingsSection
            workspaceId={workspace.id}
            currentUserId={currentUser.id}
            canManage={automations.canManage}
            rules={automations.rules}
            runs={automations.runs}
            audit={automations.audit}
            members={members}
            projects={projects}
            labels={labels}
            agents={agents}
          />
        </section>
        </SettingsPanel>

        <SettingsPanel id="labels" title={t("Labels")}>
        <section id="labels" className="scroll-mt-6 space-y-3">
          <p className="text-small leading-relaxed text-faint">
            {t("Create and delete labels for tasks in this workspace.")}
          </p>
          <LabelsManager workspaceId={workspace.id} initialLabels={labels} embedded />
        </section>
        </SettingsPanel>

        <SettingsPanel id="agent" title={t("Agent")}>
        <section className="space-y-3" data-testid="harness-settings">
          <h2 className="text-body font-semibold">
            {t("Harness")} · {t("{count} ready", { count: String(harnessRows.filter((row) => row.enabled && row.ready).length) })}
          </h2>
          <div className="flex items-start gap-3">
            <p className="min-w-0 flex-1 text-small leading-relaxed text-faint">
              {t("Local CLI harnesses for the Agent tab. Turn each one on or off for this workspace. The list shows version, ready state, and the last detect error.")}
            </p>
            {isAdmin && harnessRows.some((row) => row.installed) && (
              <button
                type="button"
                disabled={Boolean(harnessBusy)}
                onClick={() => void checkHarnessUpdates()}
                className={ROW_BUTTON}
              >
                {harnessBusy === "check-updates" ? t("Checking…") : t("Check for updates")}
              </button>
            )}
          </div>
          {!harnessGateView.agentAllowed && (
            <div className="rounded-md border border-border bg-elevated px-3 py-2 text-small text-muted" data-testid="harness-agent-disabled">
              {t("The Agent tab is disabled. Enable at least one ready harness to use Agent.")}
            </div>
          )}
          <div className="overflow-hidden rounded-lg border border-border">
            {harnessRows.map((row, index) => (
              <div
                key={row.id}
                className={`flex flex-wrap items-center gap-3 px-4 py-3 ${
                  index > 0 ? "border-t border-border" : ""
                }`}
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="text-body font-medium text-text">{row.label}</div>
                  <div className="flex flex-wrap items-center gap-x-1.5 text-small text-faint" title={row.binary ?? undefined}>
                    <span>{t("Version:")}{row.version ?? "—"}</span>
                    {row.updateAvailable ? (
                      <span>
                        · {t("Update available")}
                        {row.latestVersion ? ` (${t("Latest:")}${row.latestVersion})` : ""}
                      </span>
                    ) : null}
                    {row.updateCheckFailed ? <span>· {t("Could not check for updates")}</span> : null}
                    <span aria-hidden="true">·</span>
                    <HarnessSubscription workspaceId={workspace.id} harnessId={row.id} />
                  </div>
                  {(row.error || row.hint) && (
                    <div className="text-small text-faint">
                      {row.error ? <span className="text-danger">{t(row.error)}. </span> : null}
                      {row.hint ? t(row.hint) : null}
                    </div>
                  )}
                </div>
                <span className={row.ready ? "shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-caption font-medium text-accent" : ROW_BADGE}>
                  {row.ready ? t("Ready") : row.installed ? t("Not ready") : t("Not installed")}
                </span>
                {isAdmin && !serverMode && !row.installed && (
                  <button
                    type="button"
                    disabled={Boolean(harnessBusy)}
                    onClick={() => void runHarnessRecipe(row.id, "install")}
                    className={ROW_BUTTON}
                  >
                    {harnessBusy === `${row.id}:install` ? t("Installing…") : t("Install")}
                  </button>
                )}
                {isAdmin && !serverMode && row.installed && row.updateAvailable && (
                  <button
                    type="button"
                    disabled={Boolean(harnessBusy)}
                    onClick={() => void runHarnessRecipe(row.id, "upgrade")}
                    className={ROW_BUTTON}
                  >
                    {harnessBusy === `${row.id}:upgrade` ? t("Upgrading…") : t("Upgrade")}
                  </button>
                )}
                <Switch
                  checked={row.enabled}
                  disabled={!isAdmin || harnessBusy === `${row.id}` || Boolean(harnessBusy)}
                  onChange={(enabled) => void toggleHarness(row.id, enabled)}
                  label={t("Turn on {name}", { name: row.label })}
                />
              </div>
            ))}
          </div>
          {harnessError && <div className="text-small text-danger">{t(harnessError)}</div>}
          {harnessNotice && <div className="text-small text-muted">{t(harnessNotice)}</div>}
          {!isAdmin && (
            <p className="text-small text-faint">{t("Only a workspace admin can change harness toggles.")}</p>
          )}
        </section>
        <ModelKeysSection workspaceId={workspace.id} view={modelKeys} serverMode={serverMode} />
        <AgentSettingsSection
          workspaceId={workspace.id}
          agents={agents}
          projects={projects}
          isAdmin={isAdmin}
        />
        <section className="space-y-3">
          <h2 className="text-body font-semibold">{t("Advanced")}</h2>
          <p className="text-small leading-relaxed text-faint">
            {t("Proxy, REST API keys and the MCP server. Only needed to connect other tools or when your network needs a proxy.")}
          </p>
          <a href="#access" className={`inline-block ${ROW_BUTTON}`}>{t("Open advanced settings")}</a>
        </section>
        </SettingsPanel>

        <SettingsPanel id="usage" title={t("Agent usage")}>
        <AgentUsageSection usage={agentUsage} />
        </SettingsPanel>

        <SettingsPanel id="access" title={t("Agent access: REST and MCP")}>
          <p className="text-small leading-relaxed text-faint">{t("Only needed to connect other tools to TaCos or to get through a filtered network.")}</p>
              {isAdmin && (
                <section className="space-y-3">
                  <h2 className="text-body font-semibold">{t("Proxy (optional)")}</h2>
                  <div className="flex items-center gap-2">
                    <input
                      value={aiProxy}
                      onChange={(e) => setAiProxy(e.target.value)}
                      placeholder="http://127.0.0.1:7890"
                      spellCheck={false}
                      aria-label={t("Proxy (optional)")}
                      className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2.5 py-1.5 font-mono text-small text-text placeholder:text-faint"
                    />
                    <button
                      type="button"
                      onClick={() => void saveRuntime()}
                      disabled={aiBusy}
                      className={ROW_BUTTON}
                    >
                      {aiBusy ? t("Saving…") : t("Save")}
                    </button>
                  </div>
                  <p className="text-small text-faint">
                    {t("Set a local proxy when this machine needs one to reach model providers. All harnesses use it.")}
                  </p>
                  {aiError && <div className="text-small text-danger">{t(aiError)}</div>}
                  {aiNotice && <div className="text-small text-muted">{aiNotice}</div>}
                </section>
              )}
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="min-w-0 flex-1 text-body font-semibold">{t("REST API keys")}</h2>
                <button
                  type="button"
                  onClick={() => setKeyFormOpen((open) => !open)}
                  aria-expanded={keyFormOpen}
                  className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-small font-medium text-white transition-colors hover:bg-accent-hover"
                >
                  {t("New key")}
                </button>
              </div>

              {keyFormOpen && (
              <div className="space-y-3 rounded-lg border border-border p-3">
                <div className="flex items-center gap-2">
                  <input
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void createKey();
                    }}
                    placeholder={t("Key name (e.g. claude-code, triage-bot)")}
                    aria-label={t("Key name")}
                    className="w-full rounded-md border border-border bg-elevated/50 px-2.5 py-1.5 text-body placeholder:text-faint focus:border-border-strong"
                  />
                  <button
                    type="button"
                    onClick={() => void createKey()}
                    disabled={!newKeyName.trim() || busy}
                    className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-body font-medium text-white hover:bg-accent-hover disabled:opacity-40"
                  >
                    {busy ? t("Creating…") : t("Generate")}
                  </button>
                </div>

                <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
                  <fieldset className="space-y-1">
                    <legend className="text-small text-muted">{t("Scope")}</legend>
                    <label className="flex items-center gap-1.5 text-small text-text">
                      <input
                        type="checkbox"
                        checked={newKeyScopes.read}
                        onChange={(e) =>
                          setNewKeyScopes((old) =>
                            e.target.checked ? { ...old, read: true } : { read: false, write: false }
                          )
                        }
                      />
                      {t("Read")}
                    </label>
                    <label className="flex items-center gap-1.5 text-small text-text">
                      <input
                        type="checkbox"
                        checked={newKeyScopes.write}
                        onChange={(e) =>
                          setNewKeyScopes((old) =>
                            e.target.checked ? { read: true, write: true } : { ...old, write: false }
                          )
                        }
                      />
                      {t("Read and write")}
                    </label>
                    <p className="max-w-[22rem] text-caption leading-relaxed text-faint">
                      {t("Read includes every GET. Write adds create, update, delete and comments.")}
                    </p>
                  </fieldset>

                  <label className="space-y-1 text-small text-muted">
                    <span className="block">{t("Expiry")}</span>
                    <select
                      value={newKeyExpiry}
                      onChange={(e) => setNewKeyExpiry(e.target.value)}
                      className="rounded-md border border-border bg-elevated/50 px-2 py-1 text-small text-text focus:border-border-strong"
                    >
                      <option value="30">{t("30 days")}</option>
                      <option value="90">{t("90 days")}</option>
                      <option value="365">{t("365 days")}</option>
                      {canCreatePermanentKey && <option value="never">{t("Never expires")}</option>}
                    </select>
                  </label>
                </div>

                <fieldset className="space-y-1">
                  <legend className="text-small text-muted">{t("Projects")}</legend>
                  <label className="flex items-center gap-1.5 text-small text-text">
                    <input
                      type="radio"
                      name="new-key-projects"
                      checked={newKeyProjectMode === "all"}
                      onChange={() => setNewKeyProjectMode("all")}
                    />
                    {t("All projects")}
                  </label>
                  <label className="flex items-center gap-1.5 text-small text-text">
                    <input
                      type="radio"
                      name="new-key-projects"
                      checked={newKeyProjectMode === "selected"}
                      onChange={() => setNewKeyProjectMode("selected")}
                    />
                    {t("Selected projects")}
                  </label>
                  {newKeyProjectMode === "selected" && (
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 rounded-md border border-border bg-bg p-2">
                      {projects.length === 0 && (
                        <span className="text-small text-faint">{t("No projects yet.")}</span>
                      )}
                      {projects.map((project) => (
                        <label key={project.id} className="flex items-center gap-1.5 text-small text-text">
                          <input
                            type="checkbox"
                            checked={newKeyProjectIds.includes(project.id)}
                            onChange={(e) =>
                              setNewKeyProjectIds((old) =>
                                e.target.checked
                                  ? [...old, project.id]
                                  : old.filter((id) => id !== project.id)
                              )
                            }
                          />
                          <ProjectIcon color={project.color} icon={project.icon} size={12} />
                          {project.name}
                        </label>
                      ))}
                    </div>
                  )}
                </fieldset>
              </div>
              )}
              {keyError && <div className="text-small text-danger">{t(keyError)}</div>}

              {newKey && (
                <div className="space-y-2 rounded-lg border border-accent/50 bg-accent/10 p-3">
                  <div className="text-small font-medium text-text">
                    {t("Copy this key now — it is shown only once.")}
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-bg px-2 py-1.5 font-mono text-small text-text">
                      {newKey}
                    </code>
                    <CopyButton text={newKey} />
                  </div>
                </div>
              )}

              <div className="divide-y divide-border rounded-lg border border-border">
                {keys.length === 0 && (
                  <div className="p-4 text-body text-faint">{t("No keys yet.")}</div>
                )}
                {keys.map((key) => {
                  const expired = key.expiresAt !== null && key.expiresAt <= now;
                  const scopeLabel =
                    key.scopes === null
                      ? t("Full access (legacy)")
                      : key.scopes.includes("write")
                        ? t("Read and write")
                        : t("Read only");
                  return (
                    <div
                      key={key.id}
                      className="flex flex-wrap items-center gap-3 px-4 py-3"
                      title={`${key.keyPrefix && key.last4 ? `${key.keyPrefix}…${key.last4}` : "tac_…"} · ${t("created {date}", { date: formatDate(key.createdAt, locale) })}${key.lastUsedIp ? ` · ${t("Last used from {ip}", { ip: key.lastUsedIp })}` : ""}`}
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="text-body font-medium text-text">{key.name}</div>
                        <div className="text-small text-faint" suppressHydrationWarning>
                          {scopeLabel}
                          {" · "}
                          {key.projectIds === null
                            ? t("All projects")
                            : key.projectIds.length === 1
                              ? t("1 project")
                              : t("{count} projects", { count: key.projectIds.length })}
                          {" · "}
                          {key.expiresAt === null
                            ? t("Never expires")
                            : expired
                              ? t("Expired {date}", { date: formatDate(key.expiresAt, locale) })
                              : t("Expires {date}", { date: formatDate(key.expiresAt, locale) })}
                          {" · "}
                          {key.lastUsedAt
                            ? t("last used {time}", { time: timeAgo(key.lastUsedAt, locale) })
                            : t("never used")}
                        </div>
                      </div>
                      {key.revokedAt ? (
                        <span className={ROW_BADGE}>{t("Revoked")}</span>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => void rotateKey(key)}
                            disabled={rotatingKeyId !== null}
                            aria-label={t("Rotate {name}", { name: key.name })}
                            className={ROW_BUTTON}
                          >
                            {rotatingKeyId === key.id ? t("Rotating…") : t("Rotate")}
                          </button>
                          <button
                            type="button"
                            onClick={() => void revokeKey(key)}
                            aria-label={t("Revoke {name}", { name: key.name })}
                            className={ROW_BUTTON}
                          >
                            {t("Revoke")}
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              <details className="text-small text-muted">
                <summary className="cursor-pointer select-none text-faint hover:text-text">{t("Setup details")}</summary>
                <div className="mt-2 space-y-3">
              <p className="text-body leading-relaxed text-muted">
                {interpolate(
                  t(
                    "AI agents and scripts read and write issues at {path} with a Bearer token scoped to this workspace ({key}). Agent activity is attributed in every issue timeline."
                  ),
                  {
                    path: (
                      <code className="rounded bg-elevated px-1 font-mono text-small text-text">
                        /api/v1/*
                      </code>
                    ),
                    key: workspace.key,
                  }
                )}
              </p>
              <Snippet code={curlExample} />
                </div>
              </details>
            </section>

            <section className="space-y-3">
              <h2 className="text-body font-semibold">{t("MCP server")}</h2>
              <div className="flex items-center gap-3 rounded-lg border border-border px-4 py-3">
                <span className="min-w-0 flex-1 text-body text-text">{t("Connect TaCos to tools that support MCP")}</span>
                <CopyButton
                  label={t("Copy config")}
                  text={JSON.stringify(
                    { mcpServers: { tacos: { type: "http", url: `${origin}/api/mcp`, headers: { Authorization: "Bearer tac_YOUR_KEY" } } } },
                    null,
                    2
                  )}
                />
              </div>
              <details className="text-small text-muted">
                <summary className="cursor-pointer select-none text-faint hover:text-text">{t("Setup details")}</summary>
                <div className="mt-2 space-y-3">
              <p className="text-body leading-relaxed text-muted">
                {interpolate(
                  t(
                    "Use the local MCP server beside the database, or the remote endpoint at {path} from any machine that can reach this workspace. Both expose {tools} and use the same API keys; a read-only key only gets the read tools."
                  ),
                  {
                    path: (
                      <code className="rounded bg-elevated px-1 font-mono text-small text-text">
                        /api/mcp
                      </code>
                    ),
                    tools: (
                      <code className="font-mono text-small text-text">
                        list/get/create/update/delete issue, add_comment, list/create label, list projects and members
                      </code>
                    ),
                  }
                )}
              </p>
              {mcpCommand ? (
                <>
                  <div className="text-small font-medium text-muted">{t("Local server (stdio)")}</div>
                  <Snippet code={`claude mcp add tacos -- ${mcpCommand}`} />
                  <p className="text-small text-faint">
                    {interpolate(
                      t("For Claude Desktop, add an equivalent {entry} entry with {command} in {file}. See README for details."),
                      {
                        entry: <code className="font-mono">mcpServers.tacos</code>,
                        command: <code className="font-mono">{mcpCommand}</code>,
                        file: <code className="font-mono">claude_desktop_config.json</code>,
                      }
                    )}
                  </p>
                  <p className="text-small text-faint">
                    {interpolate(
                      t("Set {readOnly} to hide write tools, or {tools} to register only the named tools. Both work on the stdio server."),
                      {
                        readOnly: <code className="font-mono">TACOS_MCP_READ_ONLY=1</code>,
                        tools: <code className="font-mono">TACOS_MCP_TOOLS=list_issues,get_issue</code>,
                      }
                    )}
                  </p>
                </>
              ) : (
                <p className="text-small text-faint">{t("This install does not include the local MCP server. See README to run it from the source code; the remote endpoint at /api/mcp still works.")}</p>
              )}
              <div className="text-small font-medium text-muted">{t("Remote server (Streamable HTTP)")}</div>
              <Snippet code={`claude mcp add --transport http tacos ${origin}/api/mcp --header "Authorization: Bearer tac_YOUR_KEY"`} />
              <p className="text-small text-faint">
                {t("The remote endpoint is stateless: every request carries the Bearer key, and the key's scopes and project allowlist apply to every tool call.")}
              </p>
                </div>
              </details>
            </section>
        </SettingsPanel>

        <SettingsPanel id="danger" title={t("Danger zone")}>
          {isOwner && (
          <section className="space-y-3">
            <div className="flex items-center gap-3 rounded-lg border border-border px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-body font-medium">{t("Delete this workspace")}</div>
                <p className="mt-0.5 text-small leading-relaxed text-muted">
                  {t(
                    "{name} moves to your recycle bin and every member is notified. You can restore it for 30 days; after that its projects, issues, members and API keys are gone for good.",
                    { name: workspace.name }
                  )}
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
                className="shrink-0 rounded-md border border-danger px-3 py-1.5 text-body font-medium text-danger transition-colors hover:bg-danger hover:text-white disabled:opacity-40"
              >
                {t("Delete workspace")}
              </button>
            </div>
          </section>
          )}
        </SettingsPanel>
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
              <h2 id="delete-workspace-title" className="text-lead font-semibold">
                {t("Delete “{name}”?", { name: workspace.name })}
              </h2>
              <p className="mt-2 text-body leading-relaxed text-muted">
                {interpolate(
                  t("It goes to your recycle bin for 30 days and every member is notified. Type {word} to move it there."),
                  {
                    word: (
                      <code className="rounded bg-elevated px-1 py-0.5 font-mono text-small text-text">
                        confirmed
                      </code>
                    ),
                  }
                )}
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
                aria-label={t('Type "confirmed" to delete this workspace')}
                className="mt-3 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-body outline-none focus:border-danger"
              />
              {deleteError && <div className="mt-2 text-small text-danger">{t(deleteError)}</div>}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeDeleteDialog}
                  disabled={busy}
                  className="rounded-md border border-border px-3 py-1.5 text-body text-muted transition-colors hover:text-text disabled:opacity-40"
                >
                  {t("Cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => void deleteWorkspaceNow()}
                  disabled={busy || deleteWord.trim() !== "confirmed"}
                  className="rounded-md border border-danger px-3 py-1.5 text-body font-medium text-danger transition-colors hover:bg-danger hover:text-white disabled:opacity-40"
                >
                  {busy ? t("Deleting…") : t("Delete workspace")}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
