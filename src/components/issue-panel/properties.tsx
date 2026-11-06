"use client";

import { Users } from "lucide-react";
import { Menu, MenuItem } from "@/components/menu";
import { LabelPill, PRIORITY_META, PriorityIcon } from "@/components/icons";
import { AssigneeAvatar, AssigneeStack } from "@/components/issue-table";
import type { Priority } from "@/lib/constants";
import type { Label, Member } from "@/lib/issues";
import type { FlatDetail, IssueUpdate } from "./types";
import { useT } from "@/components/i18n-context";

export function PropertiesRow({
  detail,
  members,
  allLabels,
  onUpdate,
  onCollection,
}: {
  detail: FlatDetail;
  members: Member[];
  allLabels: Label[];
  onUpdate: IssueUpdate;
  onCollection: (change: {kind: "assignee" | "label"; value: string; selected: boolean}) => void;
}) {
  const t = useT();
  const currentLabelNames = detail.labels.map((l) => l.name);
  const allAssigned = members.every((member) =>
    detail.assignees.some((assignee) => assignee.id === member.id)
  );

  return (
    <div className="-mx-2 -mt-1.5 flex flex-wrap items-center gap-2">
      <Menu
        width={180}
        triggerClassName="flex items-center gap-1.5 rounded-md px-2 py-1 text-body text-muted transition-colors hover:bg-elevated hover:text-text"
        trigger={
          <>
            <PriorityIcon priority={detail.priority} size={13} />
            {t(PRIORITY_META[detail.priority].label)}
          </>
        }
      >
        {(close) => (
          <>
            {([4, 3, 2, 1, 0] as Priority[]).map((priority) => (
              <MenuItem
                key={priority}
                active={priority === detail.priority}
                onSelect={() => {
                  close();
                  void onUpdate({ priority });
                }}
              >
                <PriorityIcon priority={priority} size={13} />
                {t(PRIORITY_META[priority].label)}
              </MenuItem>
            ))}
          </>
        )}
      </Menu>

      <Menu
        width={220}
        triggerClassName="flex items-center gap-1.5 rounded-md px-2 py-1 text-body text-muted transition-colors hover:bg-elevated hover:text-text"
        trigger={
          <>
            {detail.assignees.length === 0 ? (
              t("Assignee…")
            ) : (
              <>
                {/* Names are spelled out (no "N assignees") and every avatar is shown,
                    so the row reads like a plain property list once the borders go. */}
                <AssigneeStack
                  assignees={detail.assignees}
                  size={16}
                  max={detail.assignees.length}
                />
                <span>{detail.assignees.map((a) => a.displayName).join(", ")}</span>
              </>
            )}
          </>
        }
      >
        {(close) => (
          <>
            <MenuItem
              active={detail.assignees.length === 0}
              onSelect={() => {
                close();
                for(const assignee of detail.assignees)onCollection({kind:"assignee",value:assignee.id,selected:false});
              }}
            >
              <span className="text-faint">—</span> {t("Unassigned")}
            </MenuItem>
            <MenuItem
              active={members.length > 0 && allAssigned}
              onSelect={() => {
                close();
                for(const member of members)if(!detail.assignees.some(a=>a.id===member.id))onCollection({kind:"assignee",value:member.id,selected:true});
              }}
            >
              <Users size={14} className="text-muted" /> {t("Everyone")}
            </MenuItem>
            <div className="my-1 border-t border-border" />
            {members.map((member) => {
              const on = detail.assignees.some((assignee) => assignee.id === member.id);
              return (
                <MenuItem
                  key={member.id}
                  active={on}
                  onSelect={() => {
                    onCollection({kind:"assignee", value:member.id, selected:!on});
                  }}
                >
                  <AssigneeAvatar
                    displayName={member.displayName}
                    avatar={member.avatar}
                    size={16}
                  />
                  {member.displayName}
                </MenuItem>
              );
            })}
          </>
        )}
      </Menu>

      {/* Labels are optional: once set they show as the labels themselves, and an
          empty issue keeps a quiet "+ Labels" affordance so adding one stays possible. */}
      <Menu
        width={220}
        triggerClassName="flex items-center gap-1.5 rounded-md px-2 py-1 text-body text-muted transition-colors hover:bg-elevated hover:text-text"
        trigger={
          detail.labels.length === 0 ? (
            <span className="text-faint">+ {t("Labels")}</span>
          ) : (
            <>
              {detail.labels.slice(0, 2).map((label) => (
                <LabelPill key={label.id} name={label.name} color={label.color} small />
              ))}
              {detail.labels.length > 2 && (
                <span className="text-faint">+{detail.labels.length - 2}</span>
              )}
            </>
          )
        }
      >
        {() => (
          <>
            {allLabels.map((label) => {
              const on = currentLabelNames.includes(label.name);
              return (
                <MenuItem
                  key={label.id}
                  active={on}
                  onSelect={() => {
                    onCollection({kind:"label", value:label.name, selected:!on});
                  }}
                >
                  <LabelPill name={label.name} color={label.color} small />
                </MenuItem>
              );
            })}
            {allLabels.length === 0 && (
              <div className="px-2 py-1.5 text-small text-faint">
                {t("No labels yet — create some on the Labels page.")}
              </div>
            )}
          </>
        )}
      </Menu>
    </div>
  );
}
