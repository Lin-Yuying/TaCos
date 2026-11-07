"use client";
import { usePrimaryModifier } from "@/lib/ui/platform";

import { Modal } from "@/components/ui/modal";
import { useDraft } from "@/lib/ui/draft-store";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { createProjectAction } from "@/app/actions";
import { useUI } from "@/components/ui-context";
import { useT } from "@/components/i18n-context";

export function NewProjectDialog({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const t = useT();
  const modifier=usePrimaryModifier();
  const { projectComposerOpen, setProjectComposerOpen, projectComposerOnCreated } = useUI();
  const router = useRouter();
  const [name, setName] = useDraft("create-new-project-dialog.tsx", "name", "");
  const [description, setDescription] = useDraft("create-new-project-dialog.tsx", "description", "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!projectComposerOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the form resets each time the dialog opens
    setError(null);
    setBusy(false);
  }, [projectComposerOpen]);


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
    setName("");setDescription("");
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
    <Modal open={projectComposerOpen} onClose={() => {if(!busy)setProjectComposerOpen(false);}} title={t("New project")} className="max-w-[420px] !p-0">
        <div
          className="rounded-xl border border-border bg-overlay shadow-2xl shadow-black/15"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {
              e.preventDefault();
              void submit();
            }
          }}
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-lead font-semibold text-text">{t("New project")}</h2>
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
              className="h-[34px] rounded-lg px-2.5 w-full border border-border-strong bg-bg text-body text-text placeholder:text-faint focus:border-border-strong focus:outline-none"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder={t("Add a short summary…")}
              className="mt-2 w-full resize-none rounded-lg border border-border-strong bg-bg px-2.5 py-1.5 text-body leading-relaxed text-text placeholder:text-faint focus:border-border-strong focus:outline-none"
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
              className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[30px] rounded-lg px-2.5 text-small border border-border text-text transition-colors bg-bg hover:bg-active"
            >
              {t("Cancel")}
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!name.trim() || busy}
              className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[30px] rounded-lg px-2.5 text-small bg-accent font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
            >
              {t("Create project")}
              <span className="ml-2 text-caption opacity-75">{modifier}↵</span>
            </button>
          </div>
        </div>
    </Modal>
  );
}
