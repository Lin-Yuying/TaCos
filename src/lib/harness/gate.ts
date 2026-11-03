import { listHarnessDetect } from "./registry";
import type { HarnessGate, HarnessId, HarnessStatus } from "./types";

/**
 * Workspace harness gate (H-P2-14).
 * A harness counts as enabled when the settings map omits the id or sets it true.
 * Agent is allowed only when at least one harness is enabled and ready.
 * When every harness is off, agentAllowed is false.
 */
export function harnessGate(enabledById?: Partial<Record<HarnessId, boolean>>): HarnessGate {
  const statuses: HarnessStatus[] = listHarnessDetect().map((detect) => ({
    ...detect,
    enabled: enabledById?.[detect.id] ?? true,
  }));
  const enabledReady = statuses.filter((s) => s.enabled && s.ready);
  const anyEnabled = statuses.some((s) => s.enabled);
  return {
    enabledReady,
    anyReady: enabledReady.length > 0,
    // All off (or none ready while on) disables the Agent page.
    agentAllowed: anyEnabled && enabledReady.length > 0,
  };
}
