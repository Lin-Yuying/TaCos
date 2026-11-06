import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer, MCP_READ_TOOL_NAMES, MCP_WRITE_TOOL_NAMES } from "../../../../mcp/create-server";
import { assertKeyScope, errorResponse, requireApiKey } from "@/lib/api-auth";
import { ApiKeyRateLimitError, takeApiKeyToken } from "@/lib/api-key-rate-limit";
import { apiKeyHasScope, type ApiKeyRecord } from "@/lib/issues";

type JsonRpcMessage = {
  jsonrpc?: string;
  id?: unknown;
  method?: string;
  params?: { name?: string };
};

function parseMessages(raw: string): JsonRpcMessage[] | null {
  if (!raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed as JsonRpcMessage[];
    if (parsed && typeof parsed === "object") return [parsed as JsonRpcMessage];
    return null;
  } catch {
    return null;
  }
}

function toolCalls(messages: JsonRpcMessage[] | null): Array<JsonRpcMessage & { params: { name: string } }> {
  return (messages ?? []).filter(
    (message): message is JsonRpcMessage & { params: { name: string } } =>
      message.method === "tools/call" && typeof message.params?.name === "string"
  );
}

// A tool call draws from the same read/write bucket as the REST surface. initialize,
// tools/list and ping are cheap and do not consume a token.
function toolCallMode(messages: JsonRpcMessage[] | null): "read" | "write" | null {
  let mode: "read" | "write" | null = null;
  for (const call of toolCalls(messages)) {
    if ((MCP_WRITE_TOOL_NAMES as readonly string[]).includes(call.params.name)) return "write";
    if ((MCP_READ_TOOL_NAMES as readonly string[]).includes(call.params.name)) mode = "read";
  }
  return mode;
}

// A read-only key does not register write tools, so a write call would only say
// "not found". Answer a single tool call with a tool error that names the missing scope.
function readOnlyToolCallError(messages: JsonRpcMessage[] | null): Record<string, unknown> | null {
  if (!messages || messages.length !== 1) return null;
  const message = messages[0];
  if (
    message.method !== "tools/call" ||
    typeof message.params?.name !== "string" ||
    !(MCP_WRITE_TOOL_NAMES as readonly string[]).includes(message.params.name)
  ) {
    return null;
  }
  return {
    jsonrpc: "2.0",
    id: message.id ?? null,
    result: {
      content: [
        {
          type: "text",
          text: 'This API key is read-only. Create a key with the "write" scope in Settings → Agent access to change data.',
        },
      ],
      isError: true,
    },
  };
}

export async function POST(req: Request) {
  let key: ApiKeyRecord;
  try {
    // The route classifies the JSON-RPC call itself, so the generic method-based
    // read/write bucket does not apply here.
    key = await requireApiKey(req, { mode: "none" });
  } catch (err) {
    return errorResponse(err);
  }

  let messages: JsonRpcMessage[] | null = null;
  try {
    messages = parseMessages(await req.clone().text());
  } catch {
    messages = null;
  }

  const readOnly = !apiKeyHasScope(key, "write");
  try {
    if (readOnly) {
      const denied = readOnlyToolCallError(messages);
      if (denied) return Response.json(denied);
    }
    const mode = toolCallMode(messages);
    if (mode) {
      assertKeyScope(key, mode);
      const limited = takeApiKeyToken(key.id, mode);
      if (!limited.ok) throw new ApiKeyRateLimitError(limited.retryAfterSeconds);
    }
  } catch (err) {
    return errorResponse(err);
  }

  const server = createMcpServer({
    workspaceId: key.workspaceId,
    actor: { kind: "agent", label: `api:${key.name}`, via: "mcp" },
    readOnly,
    allowedProjectIds: key.projectIds,
    toolFilter: null,
  });
  // Stateless: one server and transport per POST, no session id, no server-initiated
  // notifications. Stateful sessions are explicitly a follow-up.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    return await transport.handleRequest(req);
  } catch (err) {
    return errorResponse(err);
  } finally {
    await server.close().catch(() => {});
  }
}

function methodNotAllowed() {
  return Response.json(
    {
      error: "Method not allowed",
      hint: "POST JSON-RPC messages to /api/mcp with Authorization: Bearer <key>. This endpoint is stateless and does not open a GET event stream.",
    },
    { status: 405, headers: { Allow: "POST" } }
  );
}

export async function GET() {
  return methodNotAllowed();
}

export async function DELETE() {
  return methodNotAllowed();
}
