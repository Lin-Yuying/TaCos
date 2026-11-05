import { listHarnessDetect } from "./registry";
import type { DetectResult, HarnessGate, HarnessId, HarnessStatus } from "./types";

// No subscription of their own: a person's API is the only thing these can spend.
const API_ONLY: HarnessId[] = ["pi", "dsh"];

/**
 * Whether a harness is ready is per viewer. It needs something to spend: its own subscription, or
 * the viewer's API. A login on this machine does not count for an API-only harness.
 */
export function readyWithKeys<T extends DetectResult>(detect: T, keyed: HarnessId[]): T {
  if (!detect.installed) return detect;
  if (keyed.includes(detect.id)) return { ...detect, ready: true, error: null, hint: null };
  if (!API_ONLY.includes(detect.id)) return detect;
  const hint =
    detect.id === "dsh"
      ? "Add a DeepSeek API in Settings → Model API."
      : "Add your own API in Settings → Model API.";
  return { ...detect, ready: false, error: "no_api", hint };
}

/** Harnesses that run without the viewer's API: a subscription here, or OpenCode's free models. */
export function signedInHarnesses(): HarnessId[] {
  return listHarnessDetect()
    .filter((detect) => detect.ready && !API_ONLY.includes(detect.id))
    .map((detect) => detect.id);
}

/**
 * Workspace harness gate (H-P2-14).
 * A harness counts as enabled when the settings map omits the id or sets it true.
 * Agent is allowed only when at least one harness is enabled and ready.
 * When every harness is off, agentAllowed is false.
 */
export function harnessGate(
  enabledById?: Partial<Record<HarnessId, boolean>>,
  keyed: HarnessId[] = [],
  detects: DetectResult[] = listHarnessDetect()
): HarnessGate {
  const statuses: HarnessStatus[] = detects.map((detect) => ({
    ...readyWithKeys(detect, keyed),
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
