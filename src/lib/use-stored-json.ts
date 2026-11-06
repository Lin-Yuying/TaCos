"use client";

import { readDraft, writeDraft, removeDraft } from "./ui/draft-journal";
import { useCallback, useMemo, useEffect, useRef, useSyncExternalStore, type SetStateAction } from "react";

// Per-browser state that the server never renders. Falls back to memory when storage is blocked.
const listeners = new Map<string, Set<() => void>>();
const memory = new Map<string, string>();
const volatile = new Set<string>();
let storageListening = false;
let lastStorageError = 0;
function storageChanged(event: StorageEvent) {
  const changedKey=event.key?.endsWith(".journal")?event.key.slice(0,-8):event.key;
  for(const key of memory.keys())if((changedKey===null||changedKey===key)&&!volatile.has(key))memory.delete(key);
  for (const [key, subscribers] of listeners) if (changedKey === null || changedKey === key) {
    if (!volatile.has(key)) memory.delete(key);
    for (const listener of subscribers) listener();
  }
}
export function exportLocalDrafts(scope:string) {
  const prefix=`tacos.draft.v1.${scope}.`;
  const drafts: Record<string, unknown> = {};
  try { for (let i=0;i<localStorage.length;i++) { const key=localStorage.key(i); if (key?.startsWith(prefix)&&!key.endsWith(".journal")) drafts[key]=read(key); } } catch { /* memory is still exportable */ }
  for (const key of volatile) if (key.startsWith(prefix)) drafts[key]=memory.get(key);
  const url=URL.createObjectURL(new Blob([JSON.stringify(drafts,null,2)],{type:"application/json"}));
  const link=document.createElement("a");link.href=url;link.download="drafts.json";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function cache(key: string, text: string) {
  memory.delete(key);memory.set(key,text);
  const persisted=[...memory.keys()].filter(key=>!volatile.has(key));
  for (const key of persisted.slice(0,Math.max(0,persisted.length-128))) memory.delete(key);
}

function read(key: string): string | null {
  if (volatile.has(key)) return memory.get(key) ?? null;
  if (memory.has(key)) return memory.get(key)!;
  let raw: string | null = null;
  try {
    raw = key.startsWith("tacos.draft.")?readDraft(key):window.localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
  if (raw !== null) cache(key,raw);
  return raw;
}

export function writeStoredJson(key:string,value:unknown,removeEmpty=false){
 const text=JSON.stringify(value);cache(key,text);
 try{if(key.startsWith("tacos.draft.")){if(removeEmpty){removeDraft(key);memory.delete(key);}else writeDraft(key,value);}else localStorage.setItem(key,text);volatile.delete(key);}
 catch{volatile.add(key);if(Date.now()-lastStorageError>30000){lastStorageError=Date.now();window.dispatchEvent(new Event("tacos:storage-error"));}}
 for(const listener of listeners.get(key)??[])listener();
}
export function localDraftEntries(scope:string){const prefix=`tacos.draft.v1.${scope}.`,entries=new Map<string,string>();for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key?.startsWith(prefix)&&!key.endsWith(".journal")){const value=read(key);if(value!==null)entries.set(key,value);}}for(const key of volatile)if(key.startsWith(prefix))entries.set(key,memory.get(key)??"");return [...entries].map(([key,value])=>({key,value,bytes:new Blob([value]).size,volatile:volatile.has(key)}));}
export function clearLocalDraft(key:string){removeDraft(key);memory.delete(key);volatile.delete(key);for(const listener of listeners.get(key)??[])listener();}

export function useStoredJson<T>(key: string, fallback: T): [T, (next: SetStateAction<T>) => void] {
  const fallbackRef = useRef(fallback); useEffect(()=>{fallbackRef.current=fallback;},[fallback]);
  const subscribe = useCallback(
    (listener: () => void) => {
      const set = listeners.get(key) ?? new Set();
      listeners.set(key, set);
      set.add(listener);
      if (!storageListening) { window.addEventListener("storage",storageChanged);storageListening=true; }
      return () => {set.delete(listener);if(!set.size)listeners.delete(key);if(!listeners.size){window.removeEventListener("storage",storageChanged);storageListening=false;for(const key of memory.keys())if(!volatile.has(key))memory.delete(key);}};
    },
    [key]
  );
  const raw = useSyncExternalStore(subscribe, () => read(key), () => null);
  const value = useMemo(() => {
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }, [raw, fallback]);
  const set = useCallback(
    (next: SetStateAction<T>) => {
      let current = fallbackRef.current;
      try {const raw = read(key); if(raw !== null) current = JSON.parse(raw) as T;} catch { /* use fallback */ }
      const value = typeof next === "function" ? (next as (old:T)=>T)(current) : next;
      const text = JSON.stringify(value);
      if (text === read(key)) return;
      writeStoredJson(key,value,((value === "" && fallbackRef.current === "") || (value === null && fallbackRef.current === null)));
    },
    [key]
  );
  return [value, set];
}
