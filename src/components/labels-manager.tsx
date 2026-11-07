"use client";
import { safeAction } from "@/lib/ui/safe-action";

import { useUI } from "@/components/ui-context";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { LabelPill } from "@/components/icons";
import { createLabelAction, deleteLabelAction } from "@/app/actions";
import { LABEL_COLORS } from "@/lib/constants";
import type { Label } from "@/lib/issues";
import { useT } from "@/components/i18n-context";

type LabelWithCount = Label & { issueCount: number };

export function LabelsManager({
  workspaceId,
  initialLabels,
  embedded = false,
}: {
  workspaceId: string;
  initialLabels: LabelWithCount[];
  embedded?: boolean;
}) {
  const t = useT();
  const {confirm}=useUI();
  const router = useRouter();
  const [name, setName] = useState("");
  const [color, setColor] = useState(LABEL_COLORS[3]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    const result = await safeAction(async()=>createLabelAction(workspaceId, { name, color }));
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
    if (!await confirm(t('Delete label "{name}"?', { name: label.name }), { body: t("It will be removed from all issues."), action: t("Delete") })) return;
    if(busy)return;setBusy(true);try{const result=await safeAction(async()=>deleteLabelAction(workspaceId,label.id));if(!result.ok)setError(result.error);else router.refresh();}catch{setError("Could not save. Retry.");}finally{setBusy(false);}
  }

  const body = (
    <div className={embedded ? "space-y-6" : "mx-auto max-w-xl space-y-6"}>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter"&&!e.nativeEvent.isComposing) void submit();
              }}
              placeholder={t("Label name")}
              aria-label={t("Label name")}
              className="h-[34px] rounded-lg px-2.5 w-full border border-border-strong bg-bg text-body text-text placeholder:text-faint focus:border-border-strong focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!name.trim() || busy}
              className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[30px] rounded-lg px-2.5 text-small shrink-0 bg-accent font-medium text-white hover:bg-accent-hover disabled:opacity-40"
            >
              {t("Add")}
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {LABEL_COLORS.map((swatch) => (
              <button
                key={swatch}
                type="button"
                aria-label={t("Color {color}", { color: swatch })}
                onClick={() => setColor(swatch)}
                className={`h-5 w-5 rounded-full transition-transform hover:scale-110 ${
                  color === swatch ? "ring-2 ring-text/70 ring-offset-2 ring-offset-bg" : ""
                }`}
                style={{ backgroundColor: swatch }}
              />
            ))}
          </div>
          {error && <div className="text-small text-danger">{t(error)}</div>}
        </div>

        <div className="divide-y divide-border rounded-lg border border-border">
          {initialLabels.length === 0 && (
            <div className="p-4 text-body text-faint">{t("No labels yet.")}</div>
          )}
          {initialLabels.map((label) => (
            <div key={label.id} className="flex items-center gap-3 px-4 py-2.5">
              <LabelPill name={label.name} color={label.color} />
              <button
                type="button"
                onClick={() =>
                  router.push(`/${workspaceId}?label=${encodeURIComponent(label.name)}`)
                }
                className="text-small text-faint hover:text-muted"
              >
                {t(label.issueCount === 1 ? "{count} task" : "{count} tasks", { count: label.issueCount })}
              </button>
              <button
                type="button"
                onClick={() => void remove(label)}
                className="ml-auto rounded-md p-1 text-faint transition-colors hover:bg-elevated hover:text-danger"
                aria-label={t("Delete {name}", { name: label.name })}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
    </div>
  );

  if (embedded) return body;
  return (
    <div className="flex-1 overflow-y-auto p-6">
      {body}
    </div>
  );
}
