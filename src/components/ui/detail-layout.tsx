"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { useUI } from "@/components/ui-context";
import { useStoredJson } from "@/lib/use-stored-json";
import { useT } from "@/components/i18n-context";

export function DetailLayout({ children, detail }: { children: ReactNode; detail: ReactNode }) {
  const { scope, openIssueId, openPageId, panelExpanded } = useUI();
  const t = useT();
  const root = useRef<HTMLDivElement>(null);
  const panel = usePanelRef();
  const active = !!(openIssueId || openPageId);
  const [rootWidth, setRootWidth] = useState(1280);
  // Below this the panel floats over the list; on a phone it fills the screen.
  const narrow = rootWidth < 760, phone = rootWidth <= 600;
  const [width, remember] = useStoredJson(`tacos.panel.width.v2.${scope}.${openIssueId ? "task" : "document"}`, 520);
  const widthRef = useRef(width); useEffect(()=>{widthRef.current=width;},[width]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setRootWidth(entry.contentRect.width));
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!active || narrow) panel.current?.collapse();
    else panel.current?.resize(panelExpanded ? "100%" : Math.max(320, Math.min(800, widthRef.current)));
  }, [active, panelExpanded, narrow, panel, openIssueId ? "task" : "document"]);
  function reset() { remember(520); panel.current?.resize(520); }
  return <div ref={root} className="relative flex min-h-0 min-w-0 flex-1">
    <Group orientation="horizontal" className="min-h-0 flex-1" onLayoutChanged={() => {
      const size = panel.current?.getSize().inPixels;
      if (active && !narrow && !panelExpanded && size && size >= 320) remember(Math.round(size));
    }}>
      <Panel id="workspace-list" minSize={active && !narrow && !panelExpanded ? 360 : 0} collapsible defaultSize="100%">
        <div inert={active && (phone || panelExpanded)} className="@container flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border max-[600px]:rounded-none max-[600px]:border-0 bg-bg">{children}</div>
      </Panel>
      <Separator disabled={!active || narrow || panelExpanded} onDoubleClick={reset} onKeyDown={(e) => { if (e.key === "Home") reset(); }} aria-label={t("Resize detail panel")} className={active && !narrow && !panelExpanded ? "w-2 shrink-0 rounded hover:bg-accent/20 focus-visible:bg-accent/20" : "w-0"} />
      <Panel id="workspace-detail" panelRef={panel} defaultSize={0} minSize={active && !narrow ? 320 : 0} maxSize={panelExpanded ? "100%" : 800} collapsible>
        {!narrow && <div className="flex h-full min-h-0 flex-col">{detail}</div>}
      </Panel>
    </Group>
    {narrow && active && <div className={`absolute inset-y-0 right-0 z-30 flex min-h-0 flex-col shadow-[-8px_0_24px_rgba(0,0,0,0.1)] ${panelExpanded || phone ? "w-full" : "w-[min(420px,90%)]"}`}>{detail}</div>}
    {active && !narrow && !panelExpanded && <button type="button" onClick={reset} aria-label={t("Reset panel width")} title={t("Reset panel width")} className="absolute bottom-1 right-2 rounded bg-bg px-1 text-small text-faint">↔</button>}
  </div>;
}
