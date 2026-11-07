"use client";

import { Link2, Lock, Maximize2, MessageSquare, Minimize2, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { Menu, MenuItem } from "@/components/menu";
import { STATUS_META, StatusIcon } from "@/components/icons";
import { STATUS_ORDER } from "@/lib/constants";
import { issueRef } from "@/lib/format";
import type { FlatDetail, IssueUpdate } from "./types";
import { useUI } from "@/components/ui-context";
import { useParams } from "next/navigation";
import { entityHref } from "@/lib/ui/entity-actions";
import { useT } from "@/components/i18n-context";

export function PanelHeader({
  detail,
  canChangeStatus,
  onUpdate,
  onRemove,
  onClose,
  expanded,
  onToggleExpanded,
  onWriteComment,
  navigation,
  watch,
}: {
  detail: FlatDetail;
  canChangeStatus: boolean;
  onUpdate: IssueUpdate;
  onRemove: () => void;
  onClose: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  onWriteComment: () => void;
  navigation: ReactNode;
  watch: ReactNode;
}) {
  const t = useT();
  const {workspaceId}=useParams<{workspaceId:string}>();
  const {toast}=useUI();
  return (
    <div className="flex min-h-[52px] shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-4 py-1.5">
      <span className="min-w-0 max-w-[240px] truncate font-mono text-small text-faint">
        {issueRef(detail)}
      </span>
      {canChangeStatus ? (
        <Menu
          width={180}
          trigger={
            <>
              <StatusIcon status={detail.status} size={13} />
              {t(STATUS_META[detail.status].label)}
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
                  {t(STATUS_META[status].label)}
                </MenuItem>
              ))}
            </>
          )}
        </Menu>
      ) : (
        <span
          title={t("Only assignees can change a task's status")}
          className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border px-2 py-1 text-body text-muted"
        >
          <StatusIcon status={detail.status} size={13} />
          {t(STATUS_META[detail.status].label)}
          <Lock size={11} className="text-faint" />
        </span>
      )}
      <span className="contents max-[600px]:hidden">{navigation}</span>
      <div className="ml-auto flex items-center gap-1">
        {watch}
        <button type="button" onClick={onWriteComment} aria-label={t("Write a comment")} title={t("Write a comment")} className="rounded-md p-1.5 text-muted transition-colors max-[600px]:hidden hover:bg-elevated hover:text-text">
          <MessageSquare size={15} />
        </button>
        <button type="button" aria-label={t("Copy link")} title={t("Copy link")} className="rounded p-1.5 text-muted" onClick={()=>{void navigator.clipboard.writeText(new URL(entityHref(workspaceId,{kind:"task",id:detail.id}),location.origin).href).then(()=>toast(t("Copied"))).catch(()=>toast(t("Could not copy. Retry.")));}}><Link2 size={15}/></button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={t("Move to Trash")}
          title={t("Move to Trash")}
          className="rounded-md p-1.5 text-muted transition-colors hover:bg-elevated hover:text-danger"
        >
          <Trash2 size={15} />
        </button>
        <button
          type="button"
          onClick={onToggleExpanded}
          title={expanded ? t("Shrink panel") : t("Expand panel")}
          aria-label={expanded ? t("Shrink panel") : t("Expand panel")}
          className="rounded-md p-1.5 text-muted transition-colors hover:bg-elevated hover:text-text max-[600px]:hidden"
        >
          {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-1.5 py-1 text-lead leading-none text-muted transition-colors hover:bg-elevated hover:text-text"
          aria-label={t("Close panel")}
        >
          ×
        </button>
      </div>
    </div>
  );
}
