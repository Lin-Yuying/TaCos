"use client";
import { useEffect,useImperativeHandle, useRef, type CSSProperties, type DragEvent, type ReactNode, type Ref, type RefObject } from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
export type VirtualStackHandle={scrollToIndex(index:number):void};
/** Shared measured window. Selection and operations keep using the complete items array. */
export function VirtualStack<T>({items,render,keyFor,estimate=40,className,style,scrollRef,handle,stickyIndexes=[],keepIndex,onVisibleItems,onDragOverIndex,onDropIndex}:{
 items:T[];render:(item:T,index:number)=>ReactNode;keyFor:(item:T,index:number)=>string;estimate?:number;className?:string;style?:CSSProperties;
 scrollRef?:RefObject<HTMLDivElement|null>;handle?:Ref<VirtualStackHandle>;stickyIndexes?:number[];keepIndex?:number;
 onVisibleItems?:(items:T[])=>void;
 onDragOverIndex?:(event:DragEvent<HTMLDivElement>,index:number)=>void;onDropIndex?:(event:DragEvent<HTMLDivElement>,index:number)=>void;
}){
 const own=useRef<HTMLDivElement>(null),root=scrollRef??own;
 const virtual=useVirtualizer({count:items.length,getScrollElement:()=>root.current,estimateSize:()=>estimate,getItemKey:index=>keyFor(items[index],index),overscan:6,
 rangeExtractor:range=>{const activeSticky=stickyIndexes.findLast(index=>index<=range.startIndex)??-1;return [...new Set([...defaultRangeExtractor(range),...(activeSticky>=0?[activeSticky]:[]),...(keepIndex!==undefined&&keepIndex>=0?[keepIndex]:[])])].sort((a,b)=>a-b);}});
 const visible=virtual.getVirtualItems();
 const visibleKeys=visible.map(row=>row.key).join("|");
 useEffect(()=>{onVisibleItems?.(visible.map(row=>items[row.index]));},[visibleKeys,items,onVisibleItems]);
 const activeSticky=stickyIndexes.findLast(index=>index<=(virtual.range?.startIndex??0))??-1;
 useImperativeHandle(handle,()=>({scrollToIndex:index=>virtual.scrollToIndex(index,{align:"auto"})}),[virtual]);
 const insertion=(event:DragEvent<HTMLDivElement>)=>{const offset=event.clientY-event.currentTarget.getBoundingClientRect().top+event.currentTarget.scrollTop;const row=virtual.getVirtualItemForOffset(offset);return row?row.index+(offset>row.start+row.size/2?1:0):items.length;};
 return <div ref={root} className={className??"min-h-0 flex-1 overflow-auto"} style={style} onDragOver={onDragOverIndex?event=>onDragOverIndex(event,insertion(event)):undefined} onDrop={onDropIndex?event=>onDropIndex(event,insertion(event)):undefined}>
 <div style={{height:virtual.getTotalSize(),position:"relative",width:"100%"}}>{virtual.getVirtualItems().map(row=><div key={row.key} data-index={row.index} ref={virtual.measureElement} style={{position:row.index===activeSticky?"sticky":"absolute",top:0,left:0,width:"100%",transform:row.index===activeSticky?undefined:`translateY(${row.start}px)`,zIndex:row.index===activeSticky?10:undefined}}>{render(items[row.index],row.index)}</div>)}</div>
 </div>;
}
