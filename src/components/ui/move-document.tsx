"use client";
import { useMemo,useEffect,useRef,useState } from "react";
import { useRouter } from "next/navigation";
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
 useEffect(()=>{let live=true;void listMoveTargetsAction(workspaceId).then(result=>{if(live)setTargets(result);});return()=>{live=false;};},[workspaceId]);
 async function move(parentId:string|null){if(running.current)return;running.current=true;setBusy(true);setError(null);try{const target={parentId,projectId:project||null};const result=await previewPageMoveAction(workspaceId,id,target);if(!result.ok){setError(result.error);return;}const impact=result.data;const projectName=targets?.ok?targets.data.projects.find(p=>p.id===impact.projectId)?.name:null;
 if(impact.requiresConfirmation&&!await confirm(t("Move this document and {count} children? Visibility: {visibility}; permission: {level}; project: {project}.",{count:impact.descendantCount,visibility:t(impact.shared?"Shared":"Private"),level:t(impact.level),project:projectName??t("None")})))return;
 const moved=await movePageAction(workspaceId,id,{...target,confirmedImpact:impact.token});if(!moved.ok)setError(moved.error);else{router.refresh();onClose();}
 }catch{setError("Could not save. Retry.");}finally{running.current=false;setBusy(false);}}
 const pages=targets?.ok?targets.data.pages:[];
 const index=useMemo(()=>documentIndex(targets?.ok?targets.data.pages:[]),[targets]);
 const excluded=useMemo(()=>index.descendants(id),[index,id]);
 return <Modal open title={t("Move document")} onClose={()=>{if(!busy)onClose();}}><h2 className="text-title">{t("Move document")}</h2><input autoFocus aria-label={t("Search documents")} placeholder={t("Search documents")} value={query} onChange={e=>setQuery(e.target.value)} className="my-3 w-full rounded border border-border bg-bg px-2 py-1 text-body"/>{targets?.ok&&<label className="flex items-center gap-2 text-small">{t("Project")}<select value={project} onChange={e=>setProject(e.target.value)} className="rounded border border-border bg-bg p-1"><option value="">{t("None")}</option>{targets.data.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
 <div className="my-3 max-h-[50dvh] overflow-auto text-body"><button disabled={busy} onClick={()=>void move(null)} className="block w-full rounded px-2 py-2 text-left hover:bg-elevated">{t("Top level")}</button>{pages.filter(p=>!excluded.has(p.id)&&p.canEdit&&(index.search.get(p.id)??"").includes(query.toLowerCase())).map(page=><button disabled={busy} key={page.id} onClick={()=>void move(page.id)} className="block w-full rounded px-2 py-2 text-left hover:bg-elevated">{index.paths.get(page.id)}</button>)}</div>{!targets&&<p>{t("Loading…")}</p>}{targets&&!targets.ok&&<p role="alert">{t(targets.error)}</p>}{error&&<p role="alert" className="text-small text-danger">{t(error)}</p>}</Modal>;
}
