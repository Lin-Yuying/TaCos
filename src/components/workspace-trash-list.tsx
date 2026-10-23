"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { restoreWorkspaceAction } from "@/app/auth-actions";
import { WorkspaceMark } from "@/components/icons";
import { timeAgo } from "@/lib/format";
import type { DeletedWorkspace } from "@/lib/issues";

// Shown in Settings under the Danger zone and on the onboarding screen when the
// owner has no active workspace left — the same bin either way.
export function WorkspaceTrashList({ items }: { items: DeletedWorkspace[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (items.length === 0) return null;

  async function restore(id: string) {
    if (busyId) return;
    setBusyId(id);
    setError(null);
    const result = await restoreWorkspaceAction(id);
    if (!result.ok) {
      setBusyId(null);
      setError(result.error);
      return;
    }
    router.push(`/${id}`);
    router.refresh();
  }

  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[13px] font-semibold">Deleted workspaces</h2>
        <span className="text-[11px] text-faint">Restorable for 30 days</span>
      </div>
      <div className="divide-y divide-border rounded-lg border border-border">
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-3 px-4 py-3">
            <WorkspaceMark icon={item.icon} className="h-6 w-6 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">{item.name}</div>
              <div className="text-[11px] text-faint">
                {item.daysLeft === 0
                  ? "Expires today"
                  : item.daysLeft === 1
                    ? "1 day left"
                    : `${item.daysLeft} days left`}{" "}
                · deleted {timeAgo(item.deletedAt)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void restore(item.id)}
              disabled={busyId !== null}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] font-medium text-text transition-colors hover:bg-elevated disabled:opacity-40"
            >
              <RotateCcw size={12} />
              {busyId === item.id ? "Restoring…" : "Restore"}
            </button>
          </div>
        ))}
      </div>
      {error && <div className="text-[12px] text-danger">{error}</div>}
    </section>
  );
}
