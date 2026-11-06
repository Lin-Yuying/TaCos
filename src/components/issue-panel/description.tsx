"use client";
import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/markdown";
import { MarkdownEditor, type MarkdownEditorHandle } from "@/components/markdown-editor";
import { updateIssueDetailAction } from "@/app/actions";
import { useDraft } from "@/lib/ui/draft-store";
import { useT } from "@/components/i18n-context";
import type { IssueUpdate } from "./types";

export function DescriptionSection({workspaceId,issueId,description,onUpdate}:{workspaceId:string;issueId:string;description:string;onUpdate:IssueUpdate}) {
  const t=useT();
  const [doc,setDoc]=useDraft<string|null>("description",issueId,null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(false);
  const editor=useRef<MarkdownEditorHandle>(null),box=useRef<HTMLDivElement>(null);
  const latest=useRef(doc);
  useEffect(()=>{latest.current=doc;},[doc]);
  const saving=useRef(false);
  async function save() {
    if(saving.current)return;
    const next=editor.current?.flush() ?? latest.current;
    if(next===null)return;
    if(next===description){setDoc(null);return;}
    setDoc(next);latest.current=next;saving.current=true;setBusy(true);
    try { if(await onUpdate({description:next})){ setDoc((current)=>current===next?null:current);setError(false); }else setError(true); }
    catch{setError(true);}finally{saving.current=false;setBusy(false);}
  }
  const saveRef=useRef(save);useEffect(()=>{saveRef.current=save;});
  useEffect(()=>{
    if(doc===null)return;
    const outside=(event:PointerEvent)=>{if(!box.current?.contains(event.target as Node)&&!document.querySelector('[role="menu"][data-state="open"]'))void saveRef.current();};
    document.addEventListener("pointerdown",outside,true);return()=>document.removeEventListener("pointerdown",outside,true);
  },[doc===null]);
  useEffect(()=>()=>{
    const next=latest.current;
    if(next===null||saving.current)return;
    void updateIssueDetailAction(workspaceId,issueId,{description:next}).then((result)=>{if(result.ok)setDoc((current)=>current===next?null:current);}).catch(()=>{});
  },[workspaceId,issueId,setDoc]);
  if(doc===null)return <div role="button" tabIndex={0} className="min-h-[120px] cursor-text text-body text-muted" onClick={(e)=>{if(!(e.target as HTMLElement).closest("a,button"))setDoc(description);}} onKeyDown={(e)=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();setDoc(description);}}}>
    {description.trim()?<Markdown source={description} onSourceChange={(next)=>{setDoc(next);}}/>:<p>{t("Add a description…")}</p>}
  </div>;
  return <div ref={box} className="min-h-[120px]">
    <MarkdownEditor ref={editor} value={doc} onChange={(next)=>{latest.current=next;setDoc(next);}} placeholder={t("Write a description, type / for commands…")}/>
    <div className="flex items-center gap-3 text-small"><button disabled={busy} onClick={()=>void save()}>{t(busy?"Saving…":"Save")}</button>
      {error&&<><span role="alert" className="text-danger">{t("Could not save. Your draft is kept.")}</span><button onClick={()=>void navigator.clipboard.writeText(doc)}>{t("Copy draft")}</button></>}
    </div>
  </div>;
}
