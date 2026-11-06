"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useUI } from "@/components/ui-context";
import { useStoredJson } from "@/lib/use-stored-json";
import { useT } from "@/components/i18n-context";
export function SidePanel({name,compact,children}:{name:string;compact:boolean;children:ReactNode}) {
 const {scope}=useUI(),t=useT();const [width,setWidth]=useStoredJson(`tacos.aside.${scope}.${name}`,340),root=useRef<HTMLDivElement>(null);
 const [dragWidth,setDragWidth]=useState<number|null>(null),[available,setAvailable]=useState(600);
 useEffect(()=>{const parent=root.current?.parentElement;if(!parent)return;const observer=new ResizeObserver(()=>setAvailable(Math.max(180,parent.clientWidth-160)));observer.observe(parent);return()=>observer.disconnect();},[]);
 const clamp=(value:number)=>Math.max(Math.min(260,available),Math.min(600,available,value));
 return <div ref={root} style={compact?undefined:{width:clamp(dragWidth??width)}} className={compact?"absolute inset-0 z-20 flex bg-bg":"relative flex shrink-0"}>
 {!compact&&<div role="separator" aria-label={t("Resize side panel")} aria-orientation="vertical" aria-valuenow={width} tabIndex={0} className="absolute inset-y-0 -left-1 z-30 w-2 cursor-col-resize touch-none hover:bg-accent/20" onDoubleClick={()=>setWidth(340)} onKeyDown={e=>{if(e.key==="Home")setWidth(340);if(e.key==="ArrowLeft"||e.key==="ArrowRight"){e.preventDefault();setWidth(clamp(width+(e.key==="ArrowLeft"?10:-10)));}}} onPointerDown={e=>{e.preventDefault();const target=e.currentTarget;target.setPointerCapture(e.pointerId);const start=e.clientX,initial=width;let latest=clamp(initial);const move=(event:PointerEvent)=>{latest=clamp(initial+start-event.clientX);setDragWidth(latest);};const end=()=>{setWidth(latest);setDragWidth(null);target.removeEventListener("pointermove",move);target.removeEventListener("pointerup",end);target.removeEventListener("pointercancel",end);};target.addEventListener("pointermove",move);target.addEventListener("pointerup",end);target.addEventListener("pointercancel",end);}}/>}{children}</div>;
}
