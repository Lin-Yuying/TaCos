"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useUI } from "@/components/ui-context";
import { DocPageView } from "@/components/doc-page";
import type { PageContext, PageRefEntry } from "@/components/markdown";
import type { DocPage, PageAuthor, PageRef, PageSummary } from "@/lib/pages";
import type { PageLevel } from "@/lib/page-level";
import { useT } from "@/components/i18n-context";

type PageDetail = {
  page: DocPage;
  author: PageAuthor | null;
  level: PageLevel;
  ancestors: PageRef[];
  favorite: boolean;
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
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-bg"
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
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // Remounted per page id, so the loading state starts clean without resets here.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/internal/${workspaceId}/pages/${encodeURIComponent(id)}`)
      .then(async (res) => {
        if (res.status === 404) {
          if (!cancelled) setMissing(true);
          return null;
        }
        // Anything else is an error payload, not a page: handing it to the view would
        // read a missing `page` and crash the pane.
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        const data = await res.json();
        if (!data?.page || typeof data.page.id !== "string" || !Array.isArray(data.refs)) throw new Error("Invalid response");
        return data;
      })
      .then((data) => {
        if (!cancelled && data) setDetail(data as PageDetail);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id, workspaceId, attempt]);

  // A failed fetch has no header of its own to close it, so the error state carries the
  // two ways out: try again, or give the space back.
  if (failed || missing) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-body text-muted">{t(missing ? "This item is unavailable or you do not have access" : "Couldn’t load this document.")}</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setFailed(false); setMissing(false);
              setAttempt((n) => n + 1);
            }}
            className="rounded-md border border-border px-2.5 py-1 text-small text-muted transition-colors hover:border-border-strong hover:text-text"
          >
            {t("Retry")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2.5 py-1 text-small text-faint transition-colors hover:text-text"
          >
            {t("Close")}
          </button>
        </div>
      </div>
    );
  }

  if (missing || !detail) {
    return <div className="flex-1 p-5 text-body text-muted">{t("Loading…")}</div>;
  }

  return (
    <DocPageView
      workspaceId={workspaceId}
      page={detail.page}
      author={detail.author}
      level={detail.level}
      ancestors={detail.ancestors}
      favorite={detail.favorite}
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
