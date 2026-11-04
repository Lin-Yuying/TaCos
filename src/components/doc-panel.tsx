"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useUI } from "@/components/ui-context";
import { DocPageView } from "@/components/doc-page";
import type { PageContext, PageRefEntry } from "@/components/markdown";
import type { DocPage, PageAuthor, PageSummary } from "@/lib/pages";
import type { PageLevel } from "@/lib/page-level";
import { useT } from "@/components/i18n-context";

type PageDetail = {
  page: DocPage;
  author: PageAuthor | null;
  level: PageLevel;
  isOwner: boolean;
  viewerId: string;
  subpages: PageSummary[];
  refs: PageRefEntry[];
  ctx: PageContext;
};

// A document opened from the page you are reading (a project Overview, or another
// document already in this pane) reads beside it, the way a task opens: same card, same
// width, same close button — instead of taking over the tab and losing your place.
export function DocPanelHost({ workspaceId }: { workspaceId: string }) {
  const { openPageId, closePage, panelExpanded, setPanelExpanded } = useUI();
  if (!openPageId) return null;
  return (
    <aside
      className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-bg shadow-[0_1px_2px_rgba(0,0,0,0.05)] ${
        panelExpanded
          ? "min-w-0 flex-1"
          : "w-[min(50%,460px)] min-w-[280px] shrink-0 @max-[600px]:absolute @max-[600px]:inset-0 @max-[600px]:z-20 @max-[600px]:w-auto @max-[600px]:min-w-0"
      }`}
    >
      <DocPanel
        key={openPageId}
        workspaceId={workspaceId}
        id={openPageId}
        onClose={closePage}
        expanded={panelExpanded}
        onToggleExpanded={() => setPanelExpanded(!panelExpanded)}
      />
    </aside>
  );
}

function DocPanel({
  workspaceId,
  id,
  onClose,
  expanded,
  onToggleExpanded,
}: {
  workspaceId: string;
  id: string;
  onClose: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const { openPage, toast } = useUI();
  const [detail, setDetail] = useState<PageDetail | null>(null);
  const [missing, setMissing] = useState(false);

  // Remounted per page id, so the loading state starts clean without resets here.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/internal/${workspaceId}/pages/${encodeURIComponent(id)}`)
      .then(async (res) => {
        if (res.status === 404) {
          if (!cancelled) setMissing(true);
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (!cancelled && data) setDetail(data as PageDetail);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id, workspaceId]);

  // Deleted here or on another device: there is nothing left to read, so the pane goes
  // away instead of holding a dead page.
  useEffect(() => {
    if (!missing) return;
    toast(t("Document deleted"));
    onClose();
  }, [missing, toast, onClose, t]);

  if (missing || !detail) {
    return <div className="flex-1 p-5 text-[13px] text-muted">{t("Loading…")}</div>;
  }

  return (
    <DocPageView
      workspaceId={workspaceId}
      page={detail.page}
      author={detail.author}
      level={detail.level}
      isOwner={detail.isOwner}
      viewerId={detail.viewerId}
      subpages={detail.subpages}
      ctx={detail.ctx}
      refs={detail.refs}
      onClose={onClose}
      onOpenPage={openPage}
      expanded={expanded}
      onToggleExpanded={onToggleExpanded}
      onDeleted={() => {
        // Closing the pane must not navigate the tab: the refreshed shell drops the
        // dead page from the library and from any tab still pointing at it.
        onClose();
        router.refresh();
      }}
    />
  );
}
