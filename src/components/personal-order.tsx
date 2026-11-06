"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { useUI } from "@/components/ui-context";
import { useT } from "@/components/i18n-context";
import {
  PERSONAL_STATE_CHANGED,
  type EntityRef,
} from "@/lib/ui/entity-actions";
import { reorderPersonalEntitiesAction } from "@/app/entity-actions";
export function PersonalOrder({
  workspaceId,
  group,
  items,
}: {
  workspaceId: string;
  group: "pin" | "favorite";
  items: EntityRef[];
}) {
  const t = useT(),
    router = useRouter();
  const { toast } = useUI();
  const [draft, setDraft] = useState<EntityRef[] | null>(null),
    [busy, setBusy] = useState(false);
  const running = useRef(false);
  function move(at: number, step: number) {
    setDraft((old) => {
      if (!old || at + step < 0 || at + step >= old.length) return old;
      const next = [...old];
      [next[at], next[at + step]] = [next[at + step], next[at]];
      return next;
    });
  }
  async function save() {
    if (running.current || !draft) return;
    running.current = true;
    setBusy(true);
    try {
      const result = await reorderPersonalEntitiesAction(
        workspaceId,
        group,
        draft,
      );
      if (!result.ok) {
        toast(t(result.error));
        return;
      }
      window.dispatchEvent(new Event(PERSONAL_STATE_CHANGED));
      router.refresh();
      setDraft(null);
    } catch {
      toast(t("Could not save. Retry."));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className="mx-2 text-caption text-faint hover:text-text"
        onClick={() => setDraft(items)}
      >
        {t("Reorder")}
      </button>
      <Modal
        open={!!draft}
        onClose={() => {
          if (!busy) setDraft(null);
        }}
        title={t("Personal order")}
      >
        <h2 className="text-title">{t("Personal order")}</h2>
        <fieldset
          disabled={busy}
          className="my-3 max-h-[60dvh] space-y-1 overflow-auto"
        >
          {draft?.map((item, at) => (
            <div
              key={`${item.kind}:${item.id}`}
              className="flex items-center gap-3 rounded border border-border p-2 text-body"
            >
              <span className="min-w-0 flex-1 truncate">{item.title}</span>
              <button
                disabled={at === 0}
                aria-label={t("Move {name} up", { name: item.title })}
                onClick={() => move(at, -1)}
              >
                ↑
              </button>
              <button
                disabled={at === draft.length - 1}
                aria-label={t("Move {name} down", { name: item.title })}
                onClick={() => move(at, 1)}
              >
                ↓
              </button>
            </div>
          ))}
        </fieldset>
        <button
          disabled={busy}
          onClick={() => void save()}
          className="rounded border border-border px-3 py-1 text-body"
        >
          {t("Save")}
        </button>
      </Modal>
    </>
  );
}
