"use client";
import { useCallback, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { useT } from "@/components/i18n-context";
export function useConfirmation() {
  const t = useT();
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
  const dialog = (
    <Modal
      open={message !== null}
      title={t("Confirm")}
      onClose={() => finish(false)}
    >
      <p className="text-body">{message}</p>
      <div className="mt-4 flex justify-end gap-3 text-body">
        <button onClick={() => finish(false)}>{t("Cancel")}</button>
        <button
          className="rounded bg-danger px-3 py-1 text-white"
          onClick={() => finish(true)}
        >
          {t("Confirm")}
        </button>
      </div>
    </Modal>
  );
  return { confirm, dialog };
}
