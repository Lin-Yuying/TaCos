"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FileText, Link2, X } from "lucide-react";
import { SidePanel } from "@/components/ui/side-panel";
import { listPageBacklinksAction } from "@/app/pages-actions";
import type { PageBacklink } from "@/lib/page-links";
import { useT } from "@/components/i18n-context";

/**
 * Which documents point at this one. The list is fetched when the panel opens: a link
 * written in another tab since this page loaded should show without a full reload.
 */
export function DocLinksPanel({
  workspaceId,
  pageId,
  compact,
  onOpen,
  onClose,
}: {
  workspaceId: string;
  pageId: string;
  compact: boolean;
  // A document in the side pane opens references in the pane instead of navigating.
  onOpen?: (id: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [links, setLinks] = useState<PageBacklink[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void listPageBacklinksAction(workspaceId, pageId).then((result) => {
      if (!live) return;
      if (result.ok) {
        setLinks(result.data);
        setError(null);
      } else setError(result.error);
    });
    return () => {
      live = false;
    };
  }, [workspaceId, pageId]);

  const base = `/${workspaceId}/docs/`;
  return (
    <SidePanel name="document-links" compact={compact}>
      <aside
        data-doc-links
        className={`flex min-h-0 flex-col border-l border-border bg-bg ${
          compact ? "w-full border-l-0" : "w-full shrink-0"
        }`}
      >
        <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border px-3 text-body font-medium text-text">
          <Link2 size={13} />
          {t("Linked from")}
          {links && <span className="text-small text-faint">{links.length}</span>}
          <button
            type="button"
            onClick={onClose}
            aria-label={t("Close linked from")}
            title={t("Close linked from")}
            className="ml-auto rounded p-1 text-muted hover:bg-elevated hover:text-text"
          >
            <X size={14} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {error && <div role="alert" className="px-1 pb-2 text-small text-danger">{t(error)}</div>}
          {links === null && !error && <p className="p-2 text-small text-faint">{t("Loading…")}</p>}
          {links?.length === 0 && (
            <p className="p-2 text-small text-faint">{t("No documents link here yet.")}</p>
          )}
          {links?.map((link) => {
            const body = (
              <>
                <span className="flex w-4 shrink-0 justify-center text-faint">
                  {link.icon ?? <FileText size={13} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-text">{link.title}</span>
                  {link.path && <span className="block truncate text-caption text-faint">{link.path}</span>}
                </span>
              </>
            );
            const className =
              "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-elevated/60";
            return onOpen ? (
              <button
                key={link.id}
                type="button"
                data-doc-backlink={link.id}
                onClick={() => onOpen(link.id)}
                className={className}
              >
                {body}
              </button>
            ) : (
              <Link key={link.id} data-doc-backlink={link.id} href={`${base}${link.id}`} className={className}>
                {body}
              </Link>
            );
          })}
        </div>
      </aside>
    </SidePanel>
  );
}
