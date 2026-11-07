"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { STATUS_META } from "@/lib/constants";
import type { TaskDependency } from "@/lib/issues";
import { useT } from "@/components/i18n-context";

export function Dependencies({
  dependencies,
  blocked,
  busy,
  onAdd,
  onRemove,
}: {
  dependencies: TaskDependency[];
  blocked: boolean;
  busy: boolean;
  onAdd: (identifier: string) => Promise<boolean>;
  onRemove: (identifier: string) => Promise<boolean>;
}) {
  const t = useT();
  const [identifier, setIdentifier] = useState("");

  async function submit() {
    const next = identifier.trim();
    if (!next || busy) return;
    const ok = await onAdd(next);
    if (ok) setIdentifier("");
  }

  return (
    <div className="space-y-2" data-testid="task-dependencies">
      <div className="flex items-center gap-2 text-small font-medium text-muted">
        <span>{t("Dependencies")}</span>
        {blocked ? (
          <span data-testid="task-blocked" className="inline-flex h-[18px] items-center rounded-[5px] px-1.5 whitespace-nowrap bg-elevated text-caption text-danger">
            {t("Blocked")}
          </span>
        ) : null}
      </div>
      {dependencies.map((item) => (
        <div key={item.id} className="flex items-center gap-2 text-small">
          <span className="shrink-0 text-faint">{item.identifier}</span>
          <span className="min-w-0 flex-1 truncate text-text">{item.title}</span>
          <span className="shrink-0 text-faint">{t(STATUS_META[item.status].label)}</span>
          <button
            type="button"
            aria-label={t("no longer blocked by {task}", { task: item.identifier })}
            onClick={() => void onRemove(item.identifier)}
            className="shrink-0 rounded p-1 text-faint hover:text-text"
          >
            <X size={12} />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <input
          value={identifier}
          placeholder={t("Task identifier")}
          onChange={(event) => setIdentifier(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-body text-text placeholder:text-faint"
        />
        <button
          type="button"
          disabled={!identifier.trim() || busy}
          onClick={() => void submit()}
          className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[30px] rounded-lg px-2.5 text-small shrink-0 bg-accent font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
        >
          {t("Add a dependency")}
        </button>
      </div>
    </div>
  );
}
