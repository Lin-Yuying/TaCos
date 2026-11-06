import { Suspense } from "react";
import { connection } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser, requireWorkspace } from "@/lib/auth";
import { getAiSettingsView, listAgentHarnessOptions } from "@/lib/ai";
import { getWorkspaceHarnessGate } from "@/lib/harness";
import { harnessViewFor, modelAccessFor } from "@/lib/model-keys";
import { agentApiModels } from "@/lib/agent-api-config";
import { runnerViewFor } from "@/lib/runner/hub";
import { isServerMode } from "@/lib/server-mode";
import { listProjects } from "@/lib/issues";
import {
  AGENT_HARNESS_IDS,
  ENGINE_COOKIE,
  type AgentEngineId,
  type AgentHarnessOption,
  type CodexModel,
} from "@/lib/ai-constants";
import { codexDefaults, listCodexSkills } from "@/lib/cli-agents";
import { listComposerModels } from "@/lib/harness/models";
import {
  getAgentThreadPage,
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
    <Suspense fallback={<div className="p-6 text-body text-muted">Loading…</div>}>
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
  const gate = await getWorkspaceHarnessGate(workspaceId, ...(await harnessViewFor(user.id)));

  const engines: AgentHarnessOption[] = await listAgentHarnessOptions(workspaceId, user.id);
  const usable = (id: string | undefined): AgentEngineId | undefined =>
    engines.find((engine) => engine.id === id && engine.available)?.id;
  const saved = (await cookies()).get(ENGINE_COOKIE)?.value;
  // Agent reopens on the harness the user picked last. Default to Codex when it is ready.
  const settingsPreferred = ai.engine === "api" ? undefined : usable(ai.engine);
  const defaultEngine: AgentEngineId =
    usable(saved) ?? settingsPreferred ?? usable("codex") ?? engines[0]?.id ?? "codex";

  // On a server these belong to this person's computer, which reported them.
  const computer = isServerMode() ? (await runnerViewFor(user.id)).capabilities : undefined;
  const sp = await searchParams;
  const threadId = typeof sp.thread === "string" ? sp.thread : "";
  const [projects, threads, skills, harnessModels, apiModels] = await Promise.all([
    listProjects(workspaceId, user.id),
    listAgentThreads(workspaceId, user.id),
    isServerMode() ? (computer?.skills ?? []) : listCodexSkills(),
    isServerMode()
      ? (computer?.models ?? {})
      : listComposerModels(
          engines
            .filter((engine) => engine.available && engine.id !== "api")
            .map((engine) => engine.id as (typeof AGENT_HARNESS_IDS)[number]),
          await modelAccessFor(user.id)
        ),
    agentApiModels(user.id),
  ]);
  const modelsByEngine: Partial<Record<AgentEngineId, CodexModel[]>> = { ...harnessModels };
  if (engines.some((engine) => engine.id === "api")) {
    modelsByEngine.api = apiModels.map((model, index) => ({
      slug: model.id,
      label: model.label,
      description: model.description,
      defaultEffort: "",
      efforts: [],
      priority: index,
      fast: false,
    }));
  }
  // Agent opens when Settings has at least one enabled+ready harness (H-P3-16), when the
  // viewer has a model API for the built-in agent (#79), or when there is a chat to read.
  const ready = gate.agentAllowed || engines.some((engine) => engine.id === "api") || threads.length > 0;
  // A thread the viewer cannot read is treated like a missing one: the Agent tab opens on
  // the start panel instead of leaking whether that id exists.
  let active: AgentThreadDetail | null = null;
  if (threadId) {
    active = await getAgentThreadPage(workspaceId, user.id, threadId).catch(() => null);
  }

  return (
    <AgentWorkspace
      workspaceId={workspaceId}
      viewerId={user.id}
      ready={ready}
      engines={engines}
      defaultEngine={defaultEngine}
      modelsByEngine={modelsByEngine}
      skills={skills}
      canManageSkills={role === "admin" && !isServerMode()}
      codexDefault={isServerMode() ? (computer?.codexDefaults ?? { model: "", effort: "" }) : codexDefaults()}
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
