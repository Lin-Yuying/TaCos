"use client";
import { autoUpdate,computePosition,flip,shift,size,offset } from "@floating-ui/dom";
import { useEffect,useRef,type ReactNode,type CSSProperties } from "react";

export function FloatingPanel({rect,context,children,testId,role,className,style}:{rect:()=>DOMRect|null;context?:Element|(()=>Element|null);children:ReactNode;testId?:string;role?:"listbox";className?:string;style?:CSSProperties}){
 const root=useRef<HTMLDivElement>(null);
 useEffect(()=>{const floating=root.current;if(!floating)return;let stopped=false;
  const reference={getBoundingClientRect:()=>rect()??new DOMRect(),contextElement:typeof context==="function"?context()??undefined:context};
  const update=()=>void computePosition(reference,floating,{strategy:"fixed",placement:"bottom-start",middleware:[offset(4),flip(),shift({padding:8}),size({padding:8,apply({availableWidth,availableHeight,elements}){Object.assign(elements.floating.style,{maxWidth:`${Math.max(0,availableWidth)}px`,maxHeight:`${Math.max(0,Math.min(560,availableHeight))}px`});}})]}).then(({x,y})=>{if(!stopped)Object.assign(floating.style,{left:`${x}px`,top:`${y}px`,visibility:"visible"});});
  const cleanup=autoUpdate(reference,floating,update);visualViewport?.addEventListener("resize",update);visualViewport?.addEventListener("scroll",update);
  return()=>{stopped=true;cleanup();visualViewport?.removeEventListener("resize",update);visualViewport?.removeEventListener("scroll",update);};
 },[rect,context]);
 return <div ref={root} role={role} data-overview-pop data-testid={testId} style={{position:"fixed",visibility:"hidden",...style}} className={className??"z-50 w-64 overflow-y-auto rounded-md border border-border bg-overlay p-1 shadow-md"}>{children}</div>;
}

export function SuggestionMenu(props:{rect:()=>DOMRect|null;context?:Element|(()=>Element|null);children:ReactNode;testId?:string}){return <FloatingPanel {...props} role="listbox"/>;}
