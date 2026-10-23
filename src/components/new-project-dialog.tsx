"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { createProjectAction } from "@/app/actions";
import { useUI } from "@/components/ui-context";

export function NewProjectDialog({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName: string;
}) {
  const { projectComposerOpen, setProjectComposerOpen } = useUI();
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!projectComposerOpen) return;
    setName("");
    setDescription("");
    setError(null);
    setBusy(false);
  }, [projectComposerOpen]);

  useEffect(() => {
    if (!projectComposerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setProjectComposerOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [projectComposerOpen, setProjectComposerOpen]);

  if (!projectComposerOpen) return null;

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    const result = await createProjectAction(workspaceId, {
      name: trimmed,
      description,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setProjectComposerOpen(false);
    router.push(`/${workspaceId}/projects/${result.data.id}`);
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setProjectComposerOpen(false)} />
      <div className="fixed inset-x-0 top-[14vh] z-50 mx-auto w-[560px] max-w-[94vw]">
        <div
          className="rounded-xl border border-border bg-overlay shadow-2xl shadow-black/15"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-2 text-[12px] text-faint">
            <span>
              {workspaceName} <span className="mx-1">›</span>
              <span className="text-muted">New project</span>
            </span>
            <button
              type="button"
              onClick={() => setProjectComposerOpen(false)}
              aria-label="Close"
              className="rounded p-1 transition-colors hover:bg-elevated hover:text-text"
            >
              <X size={13} />
            </button>
          </div>

          <div className="px-4 py-3">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Project name"
              className="w-full bg-transparent text-[18px] font-semibold placeholder:text-faint focus:outline-none"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Add a short summary…"
              className="mt-1 w-full resize-none bg-transparent text-[13px] leading-relaxed text-muted placeholder:text-faint focus:outline-none"
            />
            <p className="mt-2 text-[12px] text-faint">
              An icon colour is chosen for you — change it later from the project overview.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2.5">
            {error && <span className="mr-auto text-[12px] text-danger">{error}</span>}
            <button
              type="button"
              onClick={() => setProjectComposerOpen(false)}
              className="rounded-md px-2.5 py-1.5 text-[13px] text-muted transition-colors hover:text-text"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!name.trim() || busy}
              className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
            >
              Create project
              <span className="ml-2 text-[11px] opacity-75">⌘↵</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
