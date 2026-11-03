"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// H-COLLAB-13: poll the workspace pulse. When another member changes a task, a comment,
// a claim, an agent chat or a notice, refresh the server data and tell open panels.
export const LIVE_POLL_MS = 1500;
export const LIVE_EVENT = "tacos:live";

export function LiveRefresh({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  useEffect(() => {
    let last: string | null = null;
    let stopped = false;
    let inFlight = false;
    async function tick() {
      if (stopped || inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const res = await fetch(`/api/internal/${workspaceId}/live`, { cache: "no-store" });
        if (!res.ok) return;
        const { pulse } = (await res.json()) as { pulse: string };
        if (last !== null && pulse !== last) {
          router.refresh();
          window.dispatchEvent(new CustomEvent(LIVE_EVENT));
        }
        last = pulse;
      } catch {
        // Offline or the server restarted: try again on the next tick.
      } finally {
        inFlight = false;
      }
    }
    void tick();
    const timer = window.setInterval(() => void tick(), LIVE_POLL_MS);
    const onVisible = () => void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [workspaceId, router]);
  return null;
}

// A counter that goes up on each live change. Use it as an effect dependency to reload.
export function useLiveTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    window.addEventListener(LIVE_EVENT, bump);
    return () => window.removeEventListener(LIVE_EVENT, bump);
  }, []);
  return tick;
}
