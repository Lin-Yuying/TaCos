"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { importMarkdownAction } from "@/app/pages-actions";
import { useUI } from "@/components/ui-context";
import { useT } from "@/components/i18n-context";
import type { AppUpdateApi } from "./desktop-app-update-button";

// Preload is the only writer of this object, so the shape lives next to its consumer
// instead of in a global declaration file.
type OpenFilePayload = { name: string; content?: string; error?: string };
type DesktopBridge = {
  takeOpenFiles?: () => Promise<OpenFilePayload[]>;
  onOpenFiles?: (handler: () => void) => () => void;
  appUpdate?: AppUpdateApi;
};

declare global {
  interface Window {
    tacosDesktop?: DesktopBridge;
  }
}

/**
 * A Markdown file opened with TaCos from Finder or Explorer. The desktop shell cannot
 * import it itself — importing needs the signed-in user and a workspace — so it parks
 * the file and this component hands it to the same import the Docs page uses, then
 * opens the resulting page. Files opened before the window reached a workspace (or
 * before login) are still queued and get picked up here on mount.
 */
export function DesktopOpenFiles({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const router = useRouter();
  const { toast } = useUI();
  const pullState = useRef({ workspaceId, active: true, busy: false });

  useEffect(() => {
    const bridge = window.tacosDesktop;
    if (!bridge?.takeOpenFiles || !bridge.onOpenFiles) return;
    const takeOpenFiles = bridge.takeOpenFiles;
    const state = pullState.current;
    state.workspaceId = workspaceId;
    state.active = true;

    async function pull() {
      if (state.busy) return;
      state.busy = true;
      try {
        const files = await takeOpenFiles();
        let lastPage: string | null = null;
        for (const file of files) {
          if (file.error) {
            toast(`${file.name}: ${file.error}`);
            continue;
          }
          const result = await importMarkdownAction(workspaceId, {
            // The page is named from the file itself, so an absolute path here would
            // turn every folder above it into a page in the docs tree.
            path: file.name,
            content: file.content ?? "",
          });
          if (!result.ok) {
            toast(`${file.name}: ${result.error}`);
            continue;
          }
          lastPage = result.data.id;
          toast(
            result.data.created
              ? t("Imported “{title}”", { title: result.data.title })
              : t("Opened “{title}” — it was already in Docs", { title: result.data.title })
          );
        }
        // A strict-mode remount tears this effect down/re-arms it in the same tick, while
        // the import is still in flight; the shared state tells the surviving mount it may
        // still navigate. A workspace switch in between invalidates the page, so check that.
        if (lastPage && state.active && state.workspaceId === workspaceId) {
          router.push(`/${workspaceId}/docs/${lastPage}`);
        }
      } finally {
        state.busy = false;
      }
    }

    const unsubscribe = bridge.onOpenFiles(() => void pull());
    void pull();
    return () => {
      state.active = false;
      unsubscribe();
    };
  }, [workspaceId, router, toast, t]);

  return null;
}
