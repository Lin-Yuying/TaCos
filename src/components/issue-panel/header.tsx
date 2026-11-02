"use client";

import { Lock, Maximize2, Minimize2, Trash2 } from "lucide-react";
import { Menu, MenuItem } from "@/components/menu";
import { STATUS_META, StatusIcon } from "@/components/icons";
import { STATUS_ORDER } from "@/lib/constants";
import { issueRef } from "@/lib/format";
import type { FlatDetail, IssueUpdate } from "./types";

export function PanelHeader({
  detail,
  canChangeStatus,
  onUpdate,
  onRemove,
  onClose,
  expanded,
  onToggleExpanded,
}: {
  detail: FlatDetail;
  canChangeStatus: boolean;
  onUpdate: IssueUpdate;
  onRemove: () => void;
  onClose: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
      <span className="max-w-[240px] truncate font-mono text-[12px] text-faint">
        {issueRef(detail)}
      </span>
      {canChangeStatus ? (
        <Menu
          width={180}
          trigger={
            <>
              <StatusIcon status={detail.status} size={13} />
              {STATUS_META[detail.status].label}
            </>
          }
        >
          {(close) => (
            <>
              {STATUS_ORDER.map((status) => (
                <MenuItem
                  key={status}
                  active={status === detail.status}
                  onSelect={() => {
                    close();
                    void onUpdate({ status });
                  }}
                >
                  <StatusIcon status={status} size={13} />
                  {STATUS_META[status].label}
                </MenuItem>
              ))}
            </>
          )}
        </Menu>
      ) : (
        <span
          title="Only assignees can change a task's status"
          className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[13px] text-muted"
        >
          <StatusIcon status={detail.status} size={13} />
          {STATUS_META[detail.status].label}
          <Lock size={11} className="text-faint" />
        </span>
      )}
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={onRemove}
          aria-label="Move to Trash"
          title="Move to Trash"
          className="rounded-md p-1.5 text-muted transition-colors hover:bg-elevated hover:text-danger"
        >
          <Trash2 size={15} />
        </button>
        <button
          type="button"
          onClick={onToggleExpanded}
          title={expanded ? "Shrink panel" : "Expand panel"}
          aria-label={expanded ? "Shrink panel" : "Expand panel"}
          className="rounded-md p-1.5 text-muted transition-colors hover:bg-elevated hover:text-text"
        >
          {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-1.5 py-1 text-[16px] leading-none text-muted transition-colors hover:bg-elevated hover:text-text"
          aria-label="Close panel"
        >
          ×
        </button>
      </div>
    </div>
  );
}
