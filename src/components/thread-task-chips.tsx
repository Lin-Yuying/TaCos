"use client";

import { useEffect, useState } from "react";
import { listThreadTasksAction } from "@/app/agent-actions";
import type { ThreadTask } from "@/lib/agent-threads";
import { useUI } from "@/components/ui-context";
import { StatusIcon } from "@/components/icons";
import { useT } from "@/components/i18n-context";

const MAX_CHIPS = 3;

// The chat header lists the tasks that this chat published (H-COLLAB-07). A click opens
// the task panel. The list loads again when a turn ends, because a turn can add tasks.
export function ThreadTaskChips({
  workspaceId,
  threadId,
  busy,
}: {
  workspaceId: string;
  threadId: string;
  busy: boolean;
}) {
  const t = useT();
  const { openIssue } = useUI();
  const [tasks, setTasks] = useState<ThreadTask[]>([]);

  useEffect(() => {
    if (busy) return;
    let cancelled = false;
    void listThreadTasksAction(workspaceId, threadId).then((result) => {
      if (!cancelled && result.ok) setTasks(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, threadId, busy]);

  if (tasks.length === 0) return null;
  return (
    <div className="flex items-center gap-1" data-testid="thread-task-chips" title={t("Tasks from this chat")}>
      {tasks.slice(0, MAX_CHIPS).map((task) => (
        <button
          key={task.id}
          type="button"
          onClick={() => openIssue(task.id)}
          className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[30px] rounded-lg px-2.5 text-small max-w-[160px] border border-border transition-colors bg-bg text-text hover:bg-active"
        >
          <StatusIcon status={task.status} size={11} />
          <span className="shrink-0">{task.ref}</span>
          <span className="truncate">{task.title}</span>
        </button>
      ))}
      {tasks.length > MAX_CHIPS && (
        <span className="text-caption text-faint">{t("+{count} more", { count: tasks.length - MAX_CHIPS })}</span>
      )}
    </div>
  );
}
