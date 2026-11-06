"use client";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useUI } from "@/components/ui-context";
import { useT } from "@/components/i18n-context";
type Source = { ids: string[]; url: string };
const fallback = new Map<string, string>();
const event = "tacos:detail-source";
function useSource(kind: "task" | "document") {
  const { scope } = useUI(),
    key = `tacos.detail-source.${scope}.${kind}`;
  const subscribe = useCallback((listener: () => void) => {
    window.addEventListener(event, listener);
    return () => window.removeEventListener(event, listener);
  }, []);
  const read = useCallback(() => {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return fallback.get(key) ?? null;
    }
  }, [key]);
  const raw = useSyncExternalStore(subscribe, read, () => null);
  const source = useMemo(() => {
    try {
      return raw ? (JSON.parse(raw) as Source) : null;
    } catch {
      return null;
    }
  }, [raw]);
  const setSource = useCallback(
    (source: Source) => {
      const raw = JSON.stringify(source);
      fallback.set(key, raw);
      try {
        sessionStorage.setItem(key, raw);
      } catch {}
      window.dispatchEvent(new Event(event));
    },
    [key],
  );
  return [source, setSource] as const;
}
export function useDetailSource(kind: "task" | "document", ids: string[]) {
  const [, setSource] = useSource(kind),
    path = usePathname(),
    key = ids.join("|");
  useEffect(() => {
    const url = new URL(location.href);
    for (const parameter of ["issue", "doc", "comment"])
      url.searchParams.delete(parameter);
    setSource({
      ids: key ? key.split("|") : [],
      url: url.pathname + url.search,
    });
  }, [key, path, setSource]);
}
export function DetailNavigation({
  kind,
  id,
  workspaceId,
  panel,
  fallback = [],
}: {
  kind: "task" | "document";
  id: string;
  workspaceId: string;
  panel: boolean;
  fallback?: string[];
}) {
  const t = useT(),
    router = useRouter(),
    { openIssue, openPage, closeIssue, closePage } = useUI();
  const [source] = useSource(kind);
  const ids = source?.ids.includes(id) ? source.ids : fallback,
    at = ids.indexOf(id);
  function go(next: string) {
    if (panel) {
      if (kind === "task") openIssue(next);
      else openPage(next);
    } else router.push(`/${workspaceId}/docs/${next}`);
  }
  return (
    <span className="flex shrink-0 gap-1">
      <button
        disabled={at <= 0}
        aria-label={t("Previous item")}
        title={t("Previous item")}
        onClick={() => go(ids[at - 1])}
        className="rounded px-1 disabled:opacity-30"
      >
        ‹
      </button>
      <button
        disabled={at < 0 || at >= ids.length - 1}
        aria-label={t("Next item")}
        title={t("Next item")}
        onClick={() => go(ids[at + 1])}
        className="rounded px-1 disabled:opacity-30"
      >
        ›
      </button>
      {source && (
        <button
          className="rounded px-1 text-small"
          onClick={() => {
            if (panel) {
              if (kind === "task") closeIssue();
              else closePage();
            } else router.push(source.url);
          }}
        >
          {t("Back to list")}
        </button>
      )}
    </span>
  );
}
