"use client";

import { useEffect } from "react";
import type { ModelKeysView } from "@/lib/ai-constants";

export type DesktopRunner = {
  status: () => Promise<{ running: boolean; userId: string | null }>;
  ensure: (input: { token: string; userId: string }) => Promise<void>;
  stop: () => Promise<void>;
  keys: {
    list: () => Promise<DesktopResult<ModelKeysView>>;
    save: (input: { id?: string; label: string; baseUrl: string; key: string; models: string }) => Promise<
      DesktopResult<{ view: ModelKeysView; verified: boolean }>
    >;
    remove: (id: string) => Promise<DesktopResult<ModelKeysView>>;
    setEditModel: (id: string, model: string) => Promise<DesktopResult<ModelKeysView>>;
  };
};

export type DesktopResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function desktopRunner(): DesktopRunner | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { tacosDesktop?: { runner?: DesktopRunner } }).tacosDesktop?.runner;
}

const CHECK_MS = 5 * 60_000;

// Connected to a server, the desktop app is what runs this person's Agent. A browser has nothing
// to start, so it stays quiet here and Agent shows the computer as away.
export function RunnerBridge({ userId }: { userId: string }) {
  useEffect(() => {
    const runner = desktopRunner();
    if (!runner) return;
    const check = async () => {
      const status = await runner.status();
      if (status.running && status.userId === userId) return;
      const response = await fetch("/api/runner/token", { method: "POST" });
      if (!response.ok) return;
      const { token } = (await response.json()) as { token?: string };
      if (token) await runner.ensure({ token, userId });
    };
    void check().catch(() => {});
    const timer = setInterval(() => void check().catch(() => {}), CHECK_MS);
    return () => clearInterval(timer);
  }, [userId]);
  return null;
}
