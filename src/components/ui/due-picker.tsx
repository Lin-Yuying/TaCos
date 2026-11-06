"use client";
import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { Menu } from "@/components/menu";
import { useT } from "@/components/i18n-context";
import { REMINDER_PRESETS, REMINDER_META, type ReminderPreset } from "@/lib/constants";

export function DuePicker({value,reminder,onSave}:{value:string|null;reminder:ReminderPreset|null;onSave:(date:string|null,reminder:ReminderPreset|null)=>Promise<boolean>}) {
  const t=useT();
  const [date,setDate]=useState(value??""),[draftReminder,setReminder]=useState<ReminderPreset|null>(reminder),[busy,setBusy]=useState(false),[error,setError]=useState(false);
  function preset(days:number){const next=new Date();next.setDate(next.getDate()+days);setDate(`${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,"0")}-${String(next.getDate()).padStart(2,"0")}`);}
  return <Menu width={300} onOpenChange={open=>{if(open){setDate(value??"");setReminder(reminder);setError(false);}}} trigger={<><CalendarDays size={13}/>{value??t("Due date")}{reminder?" · "+t(REMINDER_META[reminder].label):""}</>}>
    {close=><form className="space-y-3 p-2 text-small" onSubmit={async event=>{event.preventDefault();if(busy)return;setBusy(true);try{if(await onSave(date||null,date?draftReminder:null))close();else setError(true);}catch{setError(true);}finally{setBusy(false);}}}>
      <label className="block">{t("Due date")}<input required={false} aria-label={t("Due date")} type="date" value={date} onChange={event=>setDate(event.target.value)} className="mt-1 w-full rounded border border-border bg-bg px-2 py-1"/></label>
      <div className="flex gap-2">{[["Today",0],["Tomorrow",1],["Next week",7]].map(([label,days])=><button type="button" key={label} onClick={()=>preset(Number(days))} className="rounded border border-border px-2 py-1">{t(String(label))}</button>)}<button type="button" onClick={()=>{setDate("");setReminder(null);}}>{t("Clear")}</button></div>
      <label className="block">{t("Remind me")}<select aria-label={t("Remind me")} disabled={!date} value={draftReminder??""} onChange={e=>setReminder((e.target.value||null) as ReminderPreset|null)} className="mt-1 w-full rounded border border-border bg-bg px-2 py-1"><option value="">{t("No reminder")}</option>{REMINDER_PRESETS.map(preset=><option key={preset} value={preset}>{t(REMINDER_META[preset].label)}</option>)}</select></label>
      {error&&<p role="alert" className="text-danger">{t("Could not save. Retry.")}</p>}
      <div className="flex justify-end gap-3"><button type="button" disabled={busy} onClick={close}>{t("Cancel")}</button><button disabled={busy} type="submit">{t(busy?"Saving…":"Save")}</button></div>
    </form>}
  </Menu>;
}
