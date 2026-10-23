"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { useUI } from "@/components/ui-context";
import { StatusIcon, STATUS_META } from "@/components/icons";
import { updateIssueAction } from "@/app/actions";
import { STATUS_ORDER } from "@/lib/constants";
import type { IssueWithLabels } from "@/lib/issues";
import { issueRef, timeAgo } from "@/lib/format";

export function CommandPalette({ workspaceId }: { workspaceId: string }) {
  const { paletteOpen, setPaletteOpen, openIssue, focused, setComposerOpen } = useUI();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<IssueWithLabels[]>([]);

  useEffect(() => {
    if (!paletteOpen) return;
    setQuery("");
    setResults([]);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, setPaletteOpen]);

  useEffect(() => {
    if (!paletteOpen) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      fetch(
        `/api/internal/${workspaceId}/search?q=${encodeURIComponent(trimmed)}`
      )
        .then((res) => res.json())
        .then((data) => setResults(data as IssueWithLabels[]))
        .catch(() => setResults([]));
    }, 150);
    return () => clearTimeout(timer);
  }, [query, paletteOpen, workspaceId]);

  if (!paletteOpen) return null;

  const close = () => setPaletteOpen(false);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={close} />
      <div className="fixed inset-x-0 top-[14vh] z-50 mx-auto w-[560px] max-w-[92vw]">
        <Command
          loop
          className="cmdk-palette overflow-hidden rounded-xl border border-border bg-overlay shadow-2xl shadow-black/15"
        >
          <div className="border-b border-border">
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder="Search issues or run a command…"
            />
          </div>
          <Command.List className="max-h-[380px] overflow-y-auto p-1 pb-2">
            <Command.Empty>
              <div className="px-3 py-6 text-center text-[13px] text-faint">
                No results for “{query}”
              </div>
            </Command.Empty>

            {query.trim() && results.length > 0 && (
              <Command.Group heading="Issues">
                {results.map((issue) => (
                  <Command.Item
                    key={issue.id}
                    value={`${issueRef(issue)} ${issue.identifier} ${issue.title}`}
                    onSelect={() => {
                      openIssue(issue.id);
                      close();
                    }}
                  >
                    <StatusIcon status={issue.status} size={13} />
                    <span
                      title={issueRef(issue)}
                      className="w-[124px] shrink-0 truncate font-mono text-[12px] text-faint"
                    >
                      {issueRef(issue)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{issue.title}</span>
                    <span suppressHydrationWarning className="text-[11px] text-faint">
                      {timeAgo(issue.updatedAt)}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            <Command.Group heading="Actions">
              <Command.Item
                value="new issue create"
                onSelect={() => {
                  setComposerOpen(true);
                  close();
                }}
              >
                <span className="text-accent">+</span> New issue
              </Command.Item>
              {focused &&
                STATUS_ORDER.map((status) => (
                  <Command.Item
                    key={status}
                    value={`move ${focused.ref} ${STATUS_META[status].label}`}
                    onSelect={() => {
                      void updateIssueAction(workspaceId, focused.identifier, { status });
                      close();
                    }}
                  >
                    <StatusIcon status={status} size={13} />
                    Move {focused.ref} to {STATUS_META[status].label}
                  </Command.Item>
                ))}
              {focused && (
                <Command.Item
                  value="copy identifier"
                  onSelect={() => {
                    void navigator.clipboard.writeText(focused.ref);
                    close();
                  }}
                >
                  <span className="text-muted">⧉</span> Copy identifier ({focused.ref})
                </Command.Item>
              )}
            </Command.Group>

            <Command.Group heading="Navigation">
              <Command.Item
                value="all issues"
                onSelect={() => {
                  router.push(`/${workspaceId}`);
                  close();
                }}
              >
                Go to All Issues
              </Command.Item>
              <Command.Item
                value="my issues"
                onSelect={() => {
                  router.push(`/${workspaceId}?assignee=me`);
                  close();
                }}
              >
                Go to My Issues
              </Command.Item>
              <Command.Item
                value="notifications inbox"
                onSelect={() => {
                  router.push(`/${workspaceId}/notifications`);
                  close();
                }}
              >
                Go to Inbox
              </Command.Item>
              <Command.Item
                value="labels"
                onSelect={() => {
                  router.push(`/${workspaceId}/labels`);
                  close();
                }}
              >
                Go to Labels
              </Command.Item>
              <Command.Item
                value="settings api keys agent members projects"
                onSelect={() => {
                  router.push(`/${workspaceId}/settings`);
                  close();
                }}
              >
                Go to Settings
              </Command.Item>
            </Command.Group>
          </Command.List>
          <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-[11px] text-faint">
            <span>
              <kbd className="rounded border border-border bg-elevated px-1 font-mono">↑↓</kbd>{" "}
              navigate
            </span>
            <span>
              <kbd className="rounded border border-border bg-elevated px-1 font-mono">↵</kbd>{" "}
              select
            </span>
            <span>
              <kbd className="rounded border border-border bg-elevated px-1 font-mono">esc</kbd>{" "}
              close
            </span>
          </div>
        </Command>
      </div>
    </>
  );
}
