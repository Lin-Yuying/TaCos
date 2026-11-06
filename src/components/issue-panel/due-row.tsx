"use client";
import { DuePicker } from "@/components/ui/due-picker";
import { ViaBadge } from "@/components/icons";
import { fullTimestamp,shortDate } from "./format";
import type { FlatDetail,IssueUpdate } from "./types";
import { useLocale,useT } from "@/components/i18n-context";
export function DueRow({detail,onUpdate}:{detail:FlatDetail;onUpdate:IssueUpdate}) {
  const t=useT(),locale=useLocale();
  return <div className="-mx-2 -mt-2 flex flex-wrap items-center gap-2 text-small text-faint"><div className="flex items-center gap-1.5 pl-2"><ViaBadge via={detail.createdVia}/><span title={fullTimestamp(detail.createdAt,locale)}>{t("Created {date}",{date:shortDate(detail.createdAt,locale)})}</span><span>·</span><span title={fullTimestamp(detail.updatedAt,locale)}>{t("Updated {date}",{date:shortDate(detail.updatedAt,locale)})}</span></div><DuePicker value={detail.dueDate} reminder={detail.reminder} onSave={(dueDate,reminder)=>onUpdate({dueDate,reminder})}/></div>;
}
