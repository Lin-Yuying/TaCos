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
    let previous:Record<string,number>|null=null;
    let stopped = false;
    let inFlight = false;
    let request: AbortController | null = null;
    async function tick() {
      if (stopped || inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      request = new AbortController();
      const timeout = window.setTimeout(() => request?.abort(), 8000);
      try {
        const res = await fetch(`/api/internal/${workspaceId}/live`, { cache: "no-store", signal: request.signal });
        if (!res.ok || stopped) {if(res.status===403&&!stopped)router.refresh();return;}
        const { pulse,revisions } = (await res.json()) as { pulse: string;revisions?:Record<string,number> };
        if (last !== null && pulse !== last) {
          const changed=revisions&&previous?Object.keys({...previous,...revisions}).filter(domain=>revisions[domain]!==previous![domain]):null;
          const url=new URL(location.href),path=url.pathname,tab=url.searchParams.get("tab")??(path.endsWith("/issues")?"issues":"overview");
          const relevant=!changed||changed.some(domain=>["permissions","projects","personal"].includes(domain)||(domain==="tasks"&&(!path.includes("/docs")&&!path.includes("/agent")))||(domain==="documents"&&(path.includes("/docs")||path.includes("/projects/")&&tab!=="issues"))||(domain==="threads"&&path.includes("/agent"))||(domain==="notifications"&&path.endsWith("/notifications"))||(domain==="automations"&&path.includes("/settings")));
          if(relevant)router.refresh();
          window.dispatchEvent(new CustomEvent(LIVE_EVENT,{detail:{domains:changed}}));
        }
        last = pulse;previous=revisions??null;
      } catch {
        // Offline or the server restarted: try again on the next tick.
      } finally {
        window.clearTimeout(timeout);
        inFlight = false;
      }
    }
    void tick();
    const timer = window.setInterval(() => void tick(), LIVE_POLL_MS);
    const onVisible = () => void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      request?.abort();
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
