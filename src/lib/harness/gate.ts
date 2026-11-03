import { listHarnessDetect } from "./registry";
import type { HarnessGate, HarnessId, HarnessStatus } from "./types";

/**
 * Foundation gate. Enabled flags come from caller settings (later H-P2).
 * When `enabled` is omitted for an id, the harness counts as enabled.
 */
export function harnessGate(enabledById?: Partial<Record<HarnessId, boolean>>): HarnessGate {
  const statuses: HarnessStatus[] = listHarnessDetect().map((detect) => ({
    ...detect,
    enabled: enabledById?.[detect.id] ?? true,
  }));
  const enabledReady = statuses.filter((s) => s.enabled && s.ready);
  return {
    enabledReady,
    anyReady: enabledReady.length > 0,
    agentAllowed: enabledReady.length > 0,
  };
}
