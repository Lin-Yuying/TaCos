"use client";
import { X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { useT } from "@/components/i18n-context";
// One shape for every "are you sure": the question is the title, and Esc or the X means no.
export function ConfirmDialog({ message, onFinish }: { message: string | null; onFinish: (ok: boolean) => void }) {
  const t = useT();
  return (
    <Modal open={message !== null} title={message ?? t("Confirm")} className="max-w-[420px]" onClose={() => onFinish(false)}>
      <div className="flex items-start gap-2 px-4 pb-3 pt-3.5">
        <h2 className="min-w-0 flex-1 text-lead font-semibold text-text">{message}</h2>
        <button type="button" aria-label={t("Close")} onClick={() => onFinish(false)} className="rounded-md p-1 text-faint transition-colors hover:bg-elevated hover:text-text">
          <X size={14} />
        </button>
      </div>
      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <button type="button" autoFocus onClick={() => onFinish(false)} className="rounded-md border border-border px-3 py-1.5 text-small text-muted transition-colors hover:text-text">
          {t("Cancel")}
        </button>
        <button type="button" onClick={() => onFinish(true)} className="rounded-md bg-danger px-3 py-1.5 text-small font-medium text-white transition-opacity hover:opacity-90">
          {t("Confirm")}
        </button>
      </div>
    </Modal>
  );
}

export function useConfirmation() {
  const resolver = useRef<((value: boolean) => void) | null>(null),
    [message, setMessage] = useState<string | null>(null);
  const confirm = useCallback(
    (text: string) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(false);
        resolver.current = resolve;
        setMessage(text);
      }),
    [],
  );
  function finish(value: boolean) {
    resolver.current?.(value);
    resolver.current = null;
    setMessage(null);
  }
  const dialog = <ConfirmDialog message={message} onFinish={finish} />;
  return { confirm, dialog };
}
