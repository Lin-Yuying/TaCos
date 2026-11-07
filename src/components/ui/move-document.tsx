"use client";
import { useMemo,useEffect,useRef,useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Modal } from "./modal";
import { listMoveTargetsAction,movePageAction,previewPageMoveAction } from "@/app/pages-actions";
import { useUI } from "@/components/ui-context";
import { useT } from "@/components/i18n-context";
import { documentIndex } from "@/lib/ui/document-index";
import type { PageSummary } from "@/lib/pages";
export function documentPath(id:string,pages:Pick<PageSummary,"id"|"title"|"parentId">[]):string {
 const byId=new Map(pages.map(page=>[page.id,page])),out:string[]=[],seen=new Set<string>();let current=byId.get(id);
 while(current&&!seen.has(current.id)){seen.add(current.id);out.unshift(current.title);current=current.parentId?byId.get(current.parentId):undefined;}
 return out.join(" / ");
}
export function MoveDocument({workspaceId,id,onClose}:{workspaceId:string;id:string;onClose:()=>void}) {
 const t=useT(),router=useRouter(),{confirm}=useUI();const [targets,setTargets]=useState<Awaited<ReturnType<typeof listMoveTargetsAction>>|null>(null),[query,setQuery]=useState(""),[project,setProject]=useState(""),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false);const running=useRef(false);
 const [parent,setParent]=useState<string|null>(null),[impact,setImpact]=useState<{descendantCount:number;requiresConfirmation:boolean}|null>(null);
 // What the chosen place would change, read before the Move button is pressed.
 useEffect(()=>{let live=true;void previewPageMoveAction(workspaceId,id,{parentId:parent,projectId:project||null}).then(result=>{if(live)setImpact(result.ok?result.data:null);}).catch(()=>{if(live)setImpact(null);});return()=>{live=false;};},[workspaceId,id,parent,project]);
 useEffect(()=>{let live=true;void listMoveTargetsAction(workspaceId).then(result=>{if(!live)return;setTargets(result);if(result.ok)setProject(result.data.pages.find(page=>page.id===id)?.projectId??"");});return()=>{live=false;};},[workspaceId,id]);
 async function move(parentId:string|null){if(running.current)return;running.current=true;setBusy(true);setError(null);try{const target={parentId,projectId:project||null};const result=await previewPageMoveAction(workspaceId,id,target);if(!result.ok){setError(result.error);return;}const impact=result.data;const projectName=targets?.ok?targets.data.projects.find(p=>p.id===impact.projectId)?.name:null;
 if(impact.requiresConfirmation&&!await confirm(t("Move this document and {count} children?",{count:impact.descendantCount}),{body:t("Visibility: {visibility}; permission: {level}; project: {project}.",{visibility:t(impact.shared?"Shared":"Private"),level:t(impact.level),project:projectName??t("None")}),action:t("Move"),tone:"primary"}))return;
 const moved=await movePageAction(workspaceId,id,{...target,confirmedImpact:impact.token});if(!moved.ok)setError(moved.error);else{router.refresh();onClose();}
 }catch{setError("Could not save. Retry.");}finally{running.current=false;setBusy(false);}}
 const pages=targets?.ok?targets.data.pages:[];
 const index=useMemo(()=>documentIndex(targets?.ok?targets.data.pages:[]),[targets]);
 const excluded=useMemo(()=>index.descendants(id),[index,id]);
 const row=(selectedRow:boolean)=>`block w-full truncate rounded-md px-2 py-1.5 text-left text-body ${selectedRow?"bg-elevated font-medium text-text":"text-text hover:bg-elevated/60"}`;
 const needsReview=impact!=null&&impact.requiresConfirmation;
 return <Modal open title={t("Move document")} className="max-w-[460px]" onClose={()=>{if(!busy)onClose();}}>
 <div className="flex items-center justify-between gap-2"><h2 className="text-title">{t("Move document")}</h2><button type="button" aria-label={t("Close")} title={t("Close")} disabled={busy} onClick={onClose} className="rounded p-1 text-muted hover:bg-elevated hover:text-text"><X size={14}/></button></div>
 <input autoFocus aria-label={t("Search documents")} placeholder={t("Search documents")} value={query} onChange={e=>setQuery(e.target.value)} className="h-[34px] rounded-lg px-2.5 mt-3 w-full border border-border-strong bg-bg text-body"/>
 {targets?.ok&&<label className="mt-3 flex flex-col items-start gap-1 text-small font-medium text-muted">{t("Project")}<select value={project} onChange={e=>setProject(e.target.value)} className="h-[34px] rounded-lg px-2.5 border border-border-strong bg-bg font-normal text-text text-body"><option value="">{t("None")}</option>{targets.data.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
 <div className="mt-3 max-h-[40dvh] overflow-auto rounded-lg border border-border p-1"><button type="button" disabled={busy} aria-pressed={parent===null} onClick={()=>setParent(null)} className={row(parent===null)}>{t("Top level")}</button>{pages.filter(p=>!excluded.has(p.id)&&p.canEdit&&(index.search.get(p.id)??"").includes(query.toLowerCase())).map(page=><button type="button" disabled={busy} key={page.id} aria-pressed={parent===page.id} onClick={()=>setParent(page.id)} className={row(parent===page.id)}>{index.paths.get(page.id)}</button>)}</div>
 {impact&&impact.descendantCount>0&&!needsReview&&<p className="mt-2 text-small text-muted">{t("Moves {count} subpages with it. Visibility and permissions stay the same.",{count:impact.descendantCount})}</p>}
 {needsReview&&<p className="mt-2 text-small text-muted">{t("This move changes visibility or the project. You will confirm the details next.")}</p>}
 {!targets&&<p className="mt-2 text-small text-faint">{t("Loading…")}</p>}{targets&&!targets.ok&&<p role="alert" className="mt-2 text-small text-danger">{t(targets.error)}</p>}{error&&<p role="alert" className="mt-2 text-small text-danger">{t(error)}</p>}
 <div className="mt-4 flex justify-end gap-2"><button type="button" disabled={busy} onClick={onClose} className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[30px] rounded-lg px-2.5 text-small border border-border font-medium bg-bg text-text hover:bg-active">{t("Cancel")}</button><button type="button" disabled={busy||!targets?.ok} onClick={()=>void move(parent)} className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap h-[30px] rounded-lg px-2.5 text-small bg-accent font-medium text-white hover:bg-accent-hover disabled:opacity-40">{t("Move")}</button></div>
 </Modal>;
}
