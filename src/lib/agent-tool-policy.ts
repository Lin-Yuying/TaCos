import type { AgentToolSpec } from "@/lib/agent-tools";

/**
 * H-P5-26: one approval policy for the TaCos MCP write path.
 * Every harness writes through /api/agent/tools, so this is the single gate.
 * - Read tools run.
 * - Delete tools always confirm. Full access and Allow-turn do not skip them.
 * - Other write tools confirm on Ask, unless the tool or the turn is pre-approved.
 */
export type ToolPolicyGrant = {
  approval: "ask" | "auto" | "full";
  autoApproveTurn: boolean;
  autoApproveTools: string[];
  neverAutoApproveTools: string[];
};

export function decideToolApproval(
  spec: Pick<AgentToolSpec, "name" | "write" | "delete">,
  grant: ToolPolicyGrant
): "run" | "confirm" {
  if (!spec.write) return "run";
  if (spec.delete || grant.neverAutoApproveTools.includes(spec.name)) return "confirm";
  if (grant.autoApproveTools.includes(spec.name) || grant.autoApproveTurn || grant.approval !== "ask") {
    return "run";
  }
  return "confirm";
}
