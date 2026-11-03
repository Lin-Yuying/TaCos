import { AGENT_TOOLS, executeAgentTool } from "@/lib/agent-tools";
import {
  publishToolApproval,
  resolveAgentToolGrant,
  waitForAgentApproval,
} from "@/lib/agent-sessions";

// The Codex/Pi MCP shim calls this from a child process, not from a browser: the bearer
// token is issued per Agent turn and pins the call to one thread, project and person.
// Nothing here trusts the caller's idea of which workspace it is talking to.
// H-P4-21: write/delete tools wait for a browser card when the harness has no elicitation.

function grantFor(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  return token ? resolveAgentToolGrant(token) : null;
}

function unauthorized() {
  return Response.json({ error: "Agent tool session expired" }, { status: 401 });
}

function denied(message: string) {
  return Response.json({
    content: [{ type: "text", text: message }],
    isError: true,
  });
}

export async function GET(request: Request) {
  const grant = grantFor(request);
  if (!grant) return unauthorized();
  return Response.json({
    tools: AGENT_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  });
}

export async function POST(request: Request) {
  const grant = grantFor(request);
  if (!grant) return unauthorized();
  let body: { name?: unknown; arguments?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name : "";
  if (!name) return Response.json({ error: "Tool name is required" }, { status: 400 });
  const spec = AGENT_TOOLS.find((tool) => tool.name === name);
  if (!spec) {
    return denied(`Unknown tool "${name}"`);
  }

  // TaCos mediates approval for harnesses without native elicitation (Pi and others).
  if (spec.write) {
    const forceConfirm = Boolean(spec.delete) || grant.neverAutoApproveTools.includes(name);
    const autoOk =
      !forceConfirm &&
      (grant.autoApproveTools.includes(name) ||
        grant.autoApproveTurn ||
        grant.approval !== "ask");
    if (!autoOk) {
      const requestId = `approval-${grant.threadId}-${name}-${Date.now()}`;
      const card = {
        requestId,
        tool: `tacos.${name}`,
        message: `Allow tool "${name}"?`,
        description: spec.description,
        params: body.arguments,
      };
      publishToolApproval(grant.threadId, card);
      const decision = await waitForAgentApproval(requestId);
      if (decision !== "accept") {
        return denied(`The person denied tool "${name}".`);
      }
    }
  }

  try {
    const result = await executeAgentTool(
      {
        workspaceId: grant.workspaceId,
        projectId: grant.projectId,
        projectKey: grant.projectKey,
        userId: grant.userId,
      },
      name,
      body.arguments
    );
    return Response.json({
      content: [{ type: "text", text: result.text }],
      ...(result.isError ? { isError: true } : {}),
    });
  } catch (err) {
    // Tool failures are part of the conversation, not a crash: hand the model the
    // message so it can explain itself or try a different call.
    return Response.json({
      content: [{ type: "text", text: err instanceof Error ? err.message : "The tool failed." }],
      isError: true,
    });
  }
}
