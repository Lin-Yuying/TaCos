"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { LabelPill } from "@/components/icons";
import { createLabelAction, deleteLabelAction } from "@/app/actions";
import { LABEL_COLORS } from "@/lib/constants";
import type { Label } from "@/lib/issues";

type LabelWithCount = Label & { issueCount: number };

export function LabelsManager({
  workspaceId,
  initialLabels,
}: {
  workspaceId: string;
  initialLabels: LabelWithCount[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [color, setColor] = useState(LABEL_COLORS[3]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    const result = await createLabelAction(workspaceId, { name, color });
    setBusy(false);
    if (result.ok) {
      setName("");
      setError(null);
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  async function remove(label: LabelWithCount) {
    if (!window.confirm(`Delete label "${label.name}"? It will be removed from all issues.`)) return;
    await deleteLabelAction(workspaceId, label.id);
    router.refresh();
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-xl space-y-6">
        <div className="space-y-2 rounded-lg border border-border bg-surface/60 p-4">
          <div className="text-[13px] font-medium">New label</div>
          <div className="flex items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
              placeholder="Label name"
              className="w-full rounded-md border border-border bg-elevated/50 px-2.5 py-1.5 text-[13px] placeholder:text-faint focus:border-border-strong"
            />
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!name.trim() || busy}
              className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:bg-accent-hover disabled:opacity-40"
            >
              Add
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {LABEL_COLORS.map((swatch) => (
              <button
                key={swatch}
                type="button"
                aria-label={`Color ${swatch}`}
                onClick={() => setColor(swatch)}
                className={`h-5 w-5 rounded-full transition-transform hover:scale-110 ${
                  color === swatch ? "ring-2 ring-text/70 ring-offset-2 ring-offset-bg" : ""
                }`}
                style={{ backgroundColor: swatch }}
              />
            ))}
          </div>
          {error && <div className="text-[12px] text-danger">{error}</div>}
        </div>

        <div className="divide-y divide-border rounded-lg border border-border">
          {initialLabels.length === 0 && (
            <div className="p-4 text-[13px] text-faint">No labels yet.</div>
          )}
          {initialLabels.map((label) => (
            <div key={label.id} className="flex items-center gap-3 px-4 py-2.5">
              <LabelPill name={label.name} color={label.color} />
              <button
                type="button"
                onClick={() =>
                  router.push(`/${workspaceId}?label=${encodeURIComponent(label.name)}`)
                }
                className="text-[12px] text-faint hover:text-muted"
              >
                {label.issueCount} issue{label.issueCount === 1 ? "" : "s"}
              </button>
              <button
                type="button"
                onClick={() => void remove(label)}
                className="ml-auto rounded-md p-1 text-faint transition-colors hover:bg-elevated hover:text-danger"
                aria-label={`Delete ${label.name}`}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
