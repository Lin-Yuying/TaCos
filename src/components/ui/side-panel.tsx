"use client";
import { useRef, type ReactNode } from "react";
import { useUI } from "@/components/ui-context";
import { useStoredJson } from "@/lib/use-stored-json";
import { useT } from "@/components/i18n-context";
export function SidePanel({name,compact,children}:{name:string;compact:boolean;children:ReactNode}) {
 const {scope}=useUI(),t=useT();const [width,setWidth]=useStoredJson(`tacos.aside.${scope}.${name}`,340),root=useRef<HTMLDivElement>(null);
 const clamp=(value:number)=>Math.max(260,Math.min(600,value));
 return <div ref={root} style={compact?undefined:{width:clamp(width)}} className={compact?"absolute inset-0 z-20 flex bg-bg":"relative flex shrink-0"}>
 {!compact&&<div role="separator" aria-label={t("Resize side panel")} aria-orientation="vertical" aria-valuenow={width} tabIndex={0} className="absolute inset-y-0 -left-1 z-30 w-2 cursor-col-resize touch-none hover:bg-accent/20" onDoubleClick={()=>setWidth(340)} onKeyDown={e=>{if(e.key==="Home")setWidth(340);if(e.key==="ArrowLeft"||e.key==="ArrowRight"){e.preventDefault();setWidth(clamp(width+(e.key==="ArrowLeft"?10:-10)));}}} onPointerDown={e=>{e.preventDefault();const target=e.currentTarget;target.setPointerCapture(e.pointerId);const start=e.clientX,initial=width;const move=(event:PointerEvent)=>setWidth(clamp(initial+start-event.clientX));const end=()=>{target.removeEventListener("pointermove",move);target.removeEventListener("pointerup",end);target.removeEventListener("pointercancel",end);};target.addEventListener("pointermove",move);target.addEventListener("pointerup",end);target.addEventListener("pointercancel",end);}}/>}{children}</div>;
}
