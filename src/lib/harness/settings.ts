import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { aiSettings } from "@/db/schema";
import { clearHarnessDetectCache } from "./detect-bin";
import { FIRST_CLASS_HARNESS_IDS, listHarnessDetect } from "./registry";
import type { DetectResult, HarnessGate, HarnessId, HarnessSettingsView, HarnessStatus } from "./types";
export type { HarnessSettingsView } from "./types";
import { harnessGate, readyWithKeys } from "./gate";

function parseEnabledMap(raw: string | null | undefined): Partial<Record<HarnessId, boolean>> {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Partial<Record<HarnessId, boolean>> = {};
    for (const id of FIRST_CLASS_HARNESS_IDS) {
      const value = (parsed as Record<string, unknown>)[id];
      if (typeof value === "boolean") out[id] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export async function loadHarnessEnabledMap(
  workspaceId: string
): Promise<Partial<Record<HarnessId, boolean>>> {
  const db = getDb();
  const [row] = await db
    .select({ harnessEnabled: aiSettings.harnessEnabled })
    .from(aiSettings)
    .where(eq(aiSettings.workspaceId, workspaceId))
    .limit(1);
  return parseEnabledMap(row?.harnessEnabled);
}

export async function getHarnessSettingsView(
  workspaceId: string,
  keyed: HarnessId[] = [],
  detects: DetectResult[] = listHarnessDetect()
): Promise<HarnessSettingsView> {
  const enabledById = await loadHarnessEnabledMap(workspaceId);
  const rows: HarnessStatus[] = detects.map((detect) => ({
    ...readyWithKeys(detect, keyed),
    enabled: enabledById[detect.id] ?? true,
  }));
  return { rows, gate: harnessGate(enabledById, keyed, detects) };
}

export async function setHarnessEnabled(
  workspaceId: string,
  id: HarnessId,
  enabled: boolean
): Promise<HarnessSettingsView> {
  if (!FIRST_CLASS_HARNESS_IDS.includes(id)) {
    throw new Error(`Unknown harness id: ${id}`);
  }
  const db = getDb();
  const now = new Date().toISOString();
  const current = await loadHarnessEnabledMap(workspaceId);
  const next = { ...current, [id]: enabled };
  const payload = JSON.stringify(next);

  const [row] = await db
    .select({ workspaceId: aiSettings.workspaceId })
    .from(aiSettings)
    .where(eq(aiSettings.workspaceId, workspaceId))
    .limit(1);

  if (row) {
    await db
      .update(aiSettings)
      .set({ harnessEnabled: payload, updatedAt: now })
      .where(eq(aiSettings.workspaceId, workspaceId));
  } else {
    // Create a minimal AI settings row so harness prefs persist.
    await db.insert(aiSettings).values({
      workspaceId,
      baseUrl: "",
      model: "",
      apiKey: "",
      enabled: 1,
      updatedAt: now,
      engine: "api",
      proxy: "",
      harnessEnabled: payload,
    });
  }
  return getHarnessSettingsView(workspaceId);
}

/** Clear detect caches and rebuild the settings view (hot refresh after install). */
export async function refreshHarnessSettingsView(
  workspaceId: string,
  keyed: HarnessId[] = [],
  detects?: DetectResult[]
): Promise<HarnessSettingsView> {
  clearHarnessDetectCache();
  return getHarnessSettingsView(workspaceId, keyed, detects);
}

/** Load persisted toggles and return the workspace harness gate. */
export async function getWorkspaceHarnessGate(
  workspaceId: string,
  keyed: HarnessId[] = [],
  detects?: DetectResult[]
): Promise<HarnessGate> {
  const enabledById = await loadHarnessEnabledMap(workspaceId);
  return harnessGate(enabledById, keyed, detects);
}

