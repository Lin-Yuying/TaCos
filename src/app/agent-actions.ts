"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireWorkspace } from "@/lib/auth";
import { clearSkillCache } from "@/lib/cli-agents";
import { createSkillFile, deleteSkillFile } from "@/lib/skill-files";
import type { AgentSkill } from "@/lib/ai-constants";
import {
  answerHandoff,
  cancelHandoff,
  handoffPanel,
  handTaskToAgent,
  type HandoffPanel,
} from "@/lib/agent-handoff";
import {
  deleteAgentThread,
  forkAgentThreadFromMessage,
  renameAgentThread,
  setAgentThreadApproval,
  setAgentThreadEngine,
  setAgentThreadModel,
  setAgentThreadPinned,
  setAgentThreadProject,
  setAgentThreadUnread,
  setAgentThreadVisibility,
  startAgentThread,
  type AgentApproval,
  type AgentThread,
  type AgentVisibility,
  getSourceThread,
  listThreadTasks,
  startTaskChat,
  type SourceThread,
  type TaskChatStart,
  type ThreadTask,
} from "@/lib/agent-threads";
import type { ActionResult } from "./actions";

function refresh(workspaceId: string) {
  revalidatePath(`/${workspaceId}/agent`, "page");
}

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong" };
  }
}

export async function startAgentThreadAction(
  workspaceId: string,
  input: {
    projectId: string;
    visibility: AgentVisibility;
    engine: string;
    model?: string;
    effort?: string;
    approval?: AgentApproval;
  }
): Promise<ActionResult<AgentThread>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    const thread = await startAgentThread({ ...input, workspaceId, userId: user.id });
    refresh(workspaceId);
    return thread;
  });
}

export async function renameAgentThreadAction(
  workspaceId: string,
  threadId: string,
  title: string
): Promise<ActionResult<AgentThread>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    const thread = await renameAgentThread(workspaceId, user.id, threadId, title);
    refresh(workspaceId);
    return thread;
  });
}

export async function setAgentThreadVisibilityAction(
  workspaceId: string,
  threadId: string,
  visibility: AgentVisibility
): Promise<ActionResult<AgentThread>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    const thread = await setAgentThreadVisibility(workspaceId, user.id, threadId, visibility);
    refresh(workspaceId);
    return thread;
  });
}


export async function setAgentThreadProjectAction(
  workspaceId: string,
  threadId: string,
  projectId: string
): Promise<ActionResult<AgentThread>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    const thread = await setAgentThreadProject(workspaceId, user.id, threadId, projectId);
    refresh(workspaceId);
    return thread;
  });
}


export async function setAgentThreadEngineAction(
  workspaceId: string,
  threadId: string,
  engine: string
): Promise<ActionResult<AgentThread>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    const thread = await setAgentThreadEngine(workspaceId, user.id, threadId, engine);
    refresh(workspaceId);
    return thread;
  });
}

export async function setAgentThreadModelAction(
  workspaceId: string,
  threadId: string,
  model: string,
  effort: string
): Promise<ActionResult<AgentThread>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    const thread = await setAgentThreadModel(workspaceId, user.id, threadId, model, effort);
    refresh(workspaceId);
    return thread;
  });
}

export async function setAgentThreadApprovalAction(
  workspaceId: string,
  threadId: string,
  approval: AgentApproval
): Promise<ActionResult<AgentThread>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    const thread = await setAgentThreadApproval(workspaceId, user.id, threadId, approval);
    refresh(workspaceId);
    return thread;
  });
}

export async function setAgentThreadPinnedAction(
  workspaceId: string,
  threadId: string,
  pinned: boolean
): Promise<ActionResult<AgentThread>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    const thread = await setAgentThreadPinned(workspaceId, user.id, threadId, pinned);
    refresh(workspaceId);
    return thread;
  });
}

export async function setAgentThreadUnreadAction(
  workspaceId: string,
  threadId: string,
  unread: boolean
): Promise<ActionResult<AgentThread>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    const thread = await setAgentThreadUnread(workspaceId, user.id, threadId, unread);
    refresh(workspaceId);
    return thread;
  });
}

export async function forkAgentThreadFromMessageAction(
  workspaceId: string,
  threadId: string,
  messageId: string
): Promise<ActionResult<AgentThread>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    const thread = await forkAgentThreadFromMessage(workspaceId, user.id, threadId, messageId);
    refresh(workspaceId);
    return thread;
  });
}

export async function deleteAgentThreadAction(
  workspaceId: string,
  threadId: string
): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await deleteAgentThread(workspaceId, user.id, threadId);
    refresh(workspaceId);
    return { id: threadId };
  });
}

// Skills live on the machine that runs the server, so changing them is a settings-level
// operation: workspace admins only, and only for the folders TaCos itself owns.
export async function createAgentSkillAction(
  workspaceId: string,
  input: { name: string; description: string; instructions: string }
): Promise<ActionResult<AgentSkill>> {
  return run(async () => {
    await requireAdmin(workspaceId);
    const created = createSkillFile(input);
    clearSkillCache();
    refresh(workspaceId);
    const skill: AgentSkill = {
      name: created.name,
      path: created.path,
      description: created.description,
      scope: "user",
      managed: true,
    };
    return skill;
  });
}

export async function deleteAgentSkillAction(
  workspaceId: string,
  skillPath: string
): Promise<ActionResult<{ name: string }>> {
  return run(async () => {
    await requireAdmin(workspaceId);
    const removed = deleteSkillFile(skillPath);
    clearSkillCache();
    refresh(workspaceId);
    return removed;
  });
}

// H-COLLAB-07: the task panel names its source chat; the chat lists the tasks it published.
export async function getSourceThreadAction(
  workspaceId: string,
  threadId: string
): Promise<ActionResult<SourceThread | null>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    return getSourceThread(workspaceId, threadId, user.id);
  });
}

export async function listThreadTasksAction(
  workspaceId: string,
  threadId: string
): Promise<ActionResult<ThreadTask[]>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    return listThreadTasks(workspaceId, threadId, user.id);
  });
}

// H-COLLAB-08: "用 Agent 推进" from the task panel.
export async function startTaskChatAction(
  workspaceId: string,
  issueId: string
): Promise<ActionResult<TaskChatStart>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    const started = await startTaskChat(workspaceId, issueId, user.id);
    refresh(workspaceId);
    return started;
  });
}

// Hands a task to this person's own Agent, which runs on their computer whenever it is on.
export async function getHandoffAction(workspaceId: string, issueId: string): Promise<ActionResult<HandoffPanel>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    return handoffPanel(workspaceId, issueId, user.id);
  });
}

export async function handTaskToAgentAction(
  workspaceId: string,
  issueId: string,
  input: { harness: string; approval: string; note: string }
): Promise<ActionResult<HandoffPanel>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await handTaskToAgent(workspaceId, issueId, user.id, input);
    refresh(workspaceId);
    return handoffPanel(workspaceId, issueId, user.id);
  });
}

export async function answerHandoffAction(
  workspaceId: string,
  issueId: string,
  runId: string,
  requestId: string,
  allow: boolean
): Promise<ActionResult<HandoffPanel>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await answerHandoff(runId, requestId, user.id, allow);
    return handoffPanel(workspaceId, issueId, user.id);
  });
}

export async function cancelHandoffAction(
  workspaceId: string,
  issueId: string,
  runId: string
): Promise<ActionResult<HandoffPanel>> {
  return run(async () => {
    const { user } = await requireWorkspace(workspaceId);
    await cancelHandoff(runId, user.id);
    return handoffPanel(workspaceId, issueId, user.id);
  });
}

export async function searchAgentThreadsAction(ws:string,query:string,offset=0){return run(async()=>{const {user}=await requireWorkspace(ws);const {searchAgentThreads}=await import("@/lib/agent-threads");return searchAgentThreads(ws,user.id,query,offset);});}

export async function loadAgentHistoryAction(ws:string,threadId:string,before:{createdAt:string;id:string}){return run(async()=>{const {user}=await requireWorkspace(ws);const {getAgentThreadPage}=await import("@/lib/agent-threads");return getAgentThreadPage(ws,user.id,threadId,before);});}
export async function loadAgentStepDetailAction(ws:string,threadId:string,id:string){return run(async()=>{const {user}=await requireWorkspace(ws);const {getAgentStepDetail}=await import("@/lib/agent-threads");return getAgentStepDetail(ws,user.id,threadId,id);});}
