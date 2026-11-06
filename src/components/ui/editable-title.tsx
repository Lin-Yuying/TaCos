"use client";
import { useState } from "react";
import { useDraft } from "@/lib/ui/draft-store";
import { useT } from "@/components/i18n-context";
export function EditableTitle({id,value,onSave,max=500}:{id:string;value:string;onSave:(next:string)=>Promise<boolean>;max?:number}) {
  const t=useT(),[draft,setDraft]=useDraft<string|null>("title",id,null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  async function save(){if(busy||draft===null)return;const next=draft.trim();if(!next||next.length>max){setError(t("Enter a name between 1 and {max} characters",{max}));return;}if(next===value){setDraft(null);return;}setBusy(true);try{if(await onSave(next)){setDraft(null);setError(null);}else setError(t("Could not save. Your draft is kept."));}catch{setError(t("Could not save. Your draft is kept."));}finally{setBusy(false);}}
  return <div><input aria-label={t("Name")} value={draft??value} disabled={busy} onChange={(e)=>setDraft(e.target.value)} onBlur={()=>void save()} onKeyDown={(e)=>{if(e.nativeEvent.isComposing||e.nativeEvent.keyCode===229)return;if(e.key==="Enter"){e.preventDefault();e.currentTarget.blur();}if(e.key==="Escape"){e.stopPropagation();setDraft(null);setError(null);}}} className="w-full bg-transparent text-title font-semibold text-text"/>{busy&&<span className="text-small text-faint">{t("Saving…")}</span>}{error&&<div role="alert" className="text-small text-danger">{error}<button onClick={()=>void save()} className="ml-2 underline">{t("Retry")}</button></div>}</div>;
}
