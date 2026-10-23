"use client";

import { Plus } from "lucide-react";
import { useUI } from "@/components/ui-context";
import { STATUS_META, type Status } from "@/lib/constants";

/**
 * Linear puts the create affordance on the group itself, so a status header doubles as a
 * shortcut: the draft opens pre-set to that status instead of the default Todo.
 */
export function AddIssueButton({ status }: { status: Status }) {
  const { setComposerOpen } = useUI();
  const label = STATUS_META[status].label;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setComposerOpen(true, status);
      }}
      title={`New ${label.toLowerCase()} issue`}
      aria-label={`New ${label.toLowerCase()} issue`}
      className="ml-auto shrink-0 rounded p-0.5 text-faint transition-colors hover:bg-elevated hover:text-text"
    >
      <Plus size={14} />
    </button>
  );
}
