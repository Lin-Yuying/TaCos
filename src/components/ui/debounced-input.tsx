"use client";
import { useEffect,useRef,useState,type InputHTMLAttributes } from "react";

export function DebouncedInput({value,onCommit,...props}:Omit<InputHTMLAttributes<HTMLInputElement>,"value"|"onChange">&{value:string;onCommit:(value:string)=>void}){
 const [draft,setDraft]=useState(value),[composing,setComposing]=useState(false);
 const callback=useRef(onCommit);useEffect(()=>{callback.current=onCommit;},[onCommit]);
 const [previous,setPrevious]=useState(value);
 if(previous!==value){setPrevious(value);setDraft(value);}
 useEffect(()=>{if(composing||draft===value)return;const timer=setTimeout(()=>callback.current(draft),250);return()=>clearTimeout(timer);},[draft,value,composing]);
 return <input {...props} value={draft} onChange={event=>setDraft(event.target.value)} onCompositionStart={()=>setComposing(true)} onCompositionEnd={event=>{setComposing(false);setDraft(event.currentTarget.value);}} onBlur={event=>{if(!composing&&draft!==value)callback.current(draft);props.onBlur?.(event);}} onKeyDown={event=>{if(event.key==="Enter"&&!event.nativeEvent.isComposing){callback.current(draft);}props.onKeyDown?.(event);}}/>;
}
