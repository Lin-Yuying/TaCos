"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { createProjectAction } from "@/app/actions";
import { useUI } from "@/components/ui-context";
import { useT } from "@/components/i18n-context";

export function NewProjectDialog({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName: string;
}) {
  const t = useT();
  const { projectComposerOpen, setProjectComposerOpen, projectComposerOnCreated } = useUI();
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
      setError(t(result.error));
      return;
    }
    setProjectComposerOpen(false);
    // Opened from the Agent composer: hand the project back so the draft stays put
    // instead of jumping to the new project's overview.
    if (projectComposerOnCreated) {
      projectComposerOnCreated(result.data);
      router.refresh();
      return;
    }
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
          <div className="flex items-center justify-between border-b border-border px-4 py-2 text-small text-faint">
            <span>
              {workspaceName} <span className="mx-1">›</span>
              <span className="text-muted">{t("New project")}</span>
            </span>
            <button
              type="button"
              onClick={() => setProjectComposerOpen(false)}
              aria-label={t("Close")}
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
              placeholder={t("Project name")}
              className="w-full bg-transparent text-title font-semibold placeholder:text-faint focus:outline-none"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder={t("Add a short summary…")}
              className="mt-1 w-full resize-none bg-transparent text-body leading-relaxed text-muted placeholder:text-faint focus:outline-none"
            />
            <p className="mt-2 text-small text-faint">
              {t("An icon colour is chosen for you — change it later from the project overview.")}
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2.5">
            {error && <span className="mr-auto text-small text-danger">{t(error)}</span>}
            <button
              type="button"
              onClick={() => setProjectComposerOpen(false)}
              className="rounded-md px-2.5 py-1.5 text-body text-muted transition-colors hover:text-text"
            >
              {t("Cancel")}
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!name.trim() || busy}
              className="rounded-md bg-accent px-3 py-1.5 text-body font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
            >
              {t("Create project")}
              <span className="ml-2 text-caption opacity-75">⌘↵</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
