"use client";

import { useState } from "react";
import { STATUS_META } from "@/lib/constants";
import type { IssueChild } from "@/lib/issues";
import { useT } from "@/components/i18n-context";

export function Subtasks({
  tasks,
  busy,
  onAdd,
}: {
  tasks: IssueChild[];
  busy: boolean;
  onAdd: (title: string) => Promise<boolean>;
}) {
  const t = useT();
  const [title, setTitle] = useState("");

  async function submit() {
    const next = title.trim();
    if (!next || busy) return;
    const ok = await onAdd(next);
    if (ok) setTitle("");
  }

  return (
    <div className="space-y-2" data-testid="subtasks">
      <div className="text-small font-medium text-muted">{t("Subtasks")}</div>
      {tasks.map((child) => (
        <div key={child.id} className="flex items-baseline gap-2 text-small">
          <span className="shrink-0 text-faint">{child.identifier}</span>
          <span className="min-w-0 truncate text-text">{child.title}</span>
          <span className="shrink-0 text-faint">{t(STATUS_META[child.status].label)}</span>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <input
          value={title}
          placeholder={t("Subtask title")}
          onChange={(event) => setTitle(event.target.value)}
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
          disabled={!title.trim() || busy}
          onClick={() => void submit()}
          className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[30px] rounded-lg px-2.5 text-small shrink-0 bg-accent font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
        >
          {t("Add a subtask")}
        </button>
      </div>
    </div>
  );
}
