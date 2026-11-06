import { spawn } from "node:child_process";
import { findHarnessBinary } from "../detect-bin";
import type { SubscriptionInfo, SubscriptionWindow } from "../types";

// #79: Codex is the only harness here that publishes plan usage. The app-server's
// account/rateLimits/read is the source; when it cannot answer, say "not reported" and
// point at the CLI's own /status instead of guessing. Cached briefly: Settings, the
// composer and the run snapshot can all ask in one minute.

const CACHE_MS = 60_000;
const PROBE_MS = 4_000;

type Cache = { at: number; value: SubscriptionInfo };
const globalCache = globalThis as unknown as { __tacosCodexSubscription?: Cache };

function isoReset(value: unknown): string | null {
  if (typeof value === "string" && value) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber) && asNumber > 0) {
      return new Date(asNumber > 1e12 ? asNumber : asNumber * 1000).toISOString();
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(value > 1e12 ? value : value * 1000).toISOString();
  }
  return null;
}

function percent(value: unknown): number | null {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, number));
}

function windowFrom(
  id: string,
  label: string,
  raw: Record<string, unknown>,
  fallbackMinutes: number | null
): SubscriptionWindow | null {
  const used = percent(raw.usedPercent ?? raw.used_percent ?? raw.used);
  if (used === null) return null;
  const minutes = Number(raw.windowDurationMins ?? raw.window_minutes ?? raw.windowMinutes);
  return {
    id,
    label,
    usedPercent: used,
    remainingPercent: Math.max(0, 100 - used),
    resetsAt: isoReset(raw.resetsAt ?? raw.resets_at ?? raw.reset_at ?? raw.resetAt),
    windowMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : fallbackMinutes,
  };
}

function windowsOf(raw: unknown): SubscriptionWindow[] {
  if (!raw || typeof raw !== "object") return [];
  const value = raw as Record<string, unknown>;
  const windows: SubscriptionWindow[] = [];
  const primary = value.primary ?? value.five_hour ?? value.fiveHour;
  const secondary = value.secondary ?? value.seven_day ?? value.sevenDay;
  if (primary && typeof primary === "object") {
    const window = windowFrom("primary", "5-hour", primary as Record<string, unknown>, 300);
    if (window) windows.push(window);
  }
  if (secondary && typeof secondary === "object") {
    const window = windowFrom("secondary", "weekly", secondary as Record<string, unknown>, 10_080);
    if (window) windows.push(window);
  }
  if (Array.isArray(value.windows)) {
    value.windows.forEach((entry, index) => {
      if (!entry || typeof entry !== "object") return;
      const record = entry as Record<string, unknown>;
      const window = windowFrom(
        String(record.id ?? `window-${index + 1}`),
        String(record.label ?? record.name ?? `Window ${index + 1}`),
        record,
        null
      );
      if (window && !windows.some((known) => known.id === window.id)) windows.push(window);
    });
  }
  return windows;
}

function fromEnv(): SubscriptionInfo | null {
  const raw = process.env.TACOS_CODEX_SUBSCRIPTION_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      plan?: string;
      windows?: unknown;
      primary?: unknown;
      secondary?: unknown;
    };
    return {
      source: "app-server",
      plan: typeof parsed.plan === "string" ? parsed.plan : null,
      windows: windowsOf(parsed),
      hint: null,
      checkedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function none(reason: string | null = null): SubscriptionInfo {
  return {
    source: "none",
    plan: null,
    windows: [],
    hint:
      reason ??
      "Codex does not report plan usage to TaCos right now. Run `codex`, then type `/status` to see it.",
    checkedAt: new Date().toISOString(),
  };
}

function probe(binary: string): Promise<SubscriptionInfo> {
  return new Promise((resolve) => {
    let settled = false;
    let buffer = "";
    let child: ReturnType<typeof spawn> | null = null;
    const finish = (value: SubscriptionInfo) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child?.kill();
      } catch {
        /* already gone */
      }
      resolve(value);
    };
    const timer = setTimeout(() => finish(none()), PROBE_MS);
    try {
      child = spawn(binary, ["app-server", "-c", "notify=[]", "-c", "plugins={}"], {
        stdio: ["pipe", "pipe", "ignore"],
        env: { ...process.env },
      });
    } catch {
      finish(none());
      return;
    }
    const send = (message: unknown) => {
      try {
        child?.stdin?.write(`${JSON.stringify(message)}\n`);
      } catch {
        /* exited */
      }
    };
    child.on("error", () => finish(none()));
    child.on("exit", () => finish(none()));
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      buffer += chunk;
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf("\n");
        if (!line) continue;
        let message: {
          id?: number | string | null;
          method?: string;
          result?: Record<string, unknown>;
          params?: Record<string, unknown>;
        };
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id === 1) {
          send({ jsonrpc: "2.0", method: "initialized" });
          send({ jsonrpc: "2.0", id: 2, method: "account/rateLimits/read", params: {} });
          continue;
        }
        if (message.method === "account/rateLimits/updated") {
          const limits = (message.params?.rateLimits ?? message.params) as Record<string, unknown>;
          const windows = windowsOf(limits);
          if (windows.length) {
            finish({
              source: "app-server",
              plan: typeof limits.plan === "string" ? limits.plan : null,
              windows,
              hint: null,
              checkedAt: new Date().toISOString(),
            });
          }
          continue;
        }
        if (message.id === 2) {
          const result = message.result ?? {};
          const limits = (result.rateLimits ?? result) as Record<string, unknown>;
          const windows = windowsOf(limits);
          if (windows.length) {
            finish({
              source: "app-server",
              plan: typeof result.plan === "string" ? result.plan : typeof limits.plan === "string" ? limits.plan : null,
              windows,
              hint: null,
              checkedAt: new Date().toISOString(),
            });
            return;
          }
          finish(none());
        }
      }
    });
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "tacos", title: "TaCos", version: "0.1.0" } },
    });
  });
}

export async function codexSubscription(force = false): Promise<SubscriptionInfo> {
  const cached = globalCache.__tacosCodexSubscription;
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const env = fromEnv();
  if (env) {
    globalCache.__tacosCodexSubscription = { at: Date.now(), value: env };
    return env;
  }
  const binary = findHarnessBinary("codex");
  if (!binary) {
    const value = none("Codex is not installed here, so there is no plan usage to report.");
    globalCache.__tacosCodexSubscription = { at: Date.now(), value };
    return value;
  }
  const value = await probe(binary);
  globalCache.__tacosCodexSubscription = { at: Date.now(), value };
  return value;
}

export function clearCodexSubscriptionCache(): void {
  globalCache.__tacosCodexSubscription = undefined;
}
