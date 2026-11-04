import { Suspense } from "react";
import { connection } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser, requireWorkspace } from "@/lib/auth";
import { getAiSettingsView, listAgentHarnessOptions } from "@/lib/ai";
import { getWorkspaceHarnessGate } from "@/lib/harness";
import { harnessesWithKeys, modelAccessFor } from "@/lib/model-keys";
import { listProjects } from "@/lib/issues";
import { ENGINE_COOKIE, type AgentHarnessId, type AgentHarnessOption } from "@/lib/ai-constants";
import { codexDefaults, listCodexSkills } from "@/lib/cli-agents";
import { listComposerModels } from "@/lib/harness/models";
import {
  getAgentThread,
  listAgentThreads,
  type AgentThreadDetail,
} from "@/lib/agent-threads";
import { AgentWorkspace } from "@/components/agent-chat";

export default function AgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<div className="p-6 text-[13px] text-muted">Loading…</div>}>
      <AgentContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function AgentContent({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const { workspaceId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { role } = await requireWorkspace(workspaceId);
  const ai = await getAiSettingsView(workspaceId);
  const gate = await getWorkspaceHarnessGate(workspaceId, await harnessesWithKeys(user.id));

  const engines: AgentHarnessOption[] = await listAgentHarnessOptions(workspaceId, user.id);
  // Agent opens only when Settings has at least one enabled+ready harness (H-P3-16).
  const ready = gate.agentAllowed;
  const usable = (id: string | undefined): AgentHarnessId | undefined =>
    engines.find((engine) => engine.id === id && engine.available)?.id;
  const saved = (await cookies()).get(ENGINE_COOKIE)?.value;
  // Agent reopens on the harness the user picked last. Default to Codex when it is ready.
  const settingsPreferred =
    ai.engine === "api" ? undefined : usable(ai.engine as AgentHarnessId);
  const defaultEngine: AgentHarnessId =
    usable(saved) ?? settingsPreferred ?? usable("codex") ?? engines[0]?.id ?? "codex";

  const sp = await searchParams;
  const threadId = typeof sp.thread === "string" ? sp.thread : "";
  const [projects, threads, skills, modelsByEngine] = await Promise.all([
    listProjects(workspaceId, user.id),
    listAgentThreads(workspaceId, user.id),
    listCodexSkills(),
    listComposerModels(
      engines.filter((engine) => engine.available).map((engine) => engine.id),
      await modelAccessFor(user.id)
    ),
  ]);
  // A thread the viewer cannot read is treated like a missing one: the Agent tab opens on
  // the start panel instead of leaking whether that id exists.
  let active: AgentThreadDetail | null = null;
  if (threadId) {
    active = await getAgentThread(workspaceId, user.id, threadId).catch(() => null);
  }

  return (
    <AgentWorkspace
      workspaceId={workspaceId}
      ready={ready}
      engines={engines}
      defaultEngine={defaultEngine}
      modelsByEngine={modelsByEngine}
      skills={skills}
      canManageSkills={role === "admin"}
      codexDefault={codexDefaults()}
      projects={projects.map((project) => ({
        id: project.id,
        name: project.name,
        key: project.key,
        color: project.color,
      }))}
      threads={threads}
      active={active}
    />
  );
}
