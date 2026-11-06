"use server";
import { requireWorkspace } from "@/lib/auth";
import { queryTaskView,taskViewChoices,type TaskQuery } from "@/lib/task-query";
import type { TaskView } from "@/lib/task-view";
import type { ActionResult } from "./actions";
async function run<T>(work:()=>Promise<T>):Promise<ActionResult<T>>{try{return {ok:true,data:await work()};}catch(error){return {ok:false,error:error instanceof Error?error.message:"Could not load tasks. Retry."};}}
export async function taskViewPageAction(ws:string,query:TaskQuery,view:TaskView,page:number,revision?:string){return run(async()=>{const {user}=await requireWorkspace(ws);return queryTaskView(ws,user.id,query,view,page,revision);});}
export async function taskViewCandidatesAction(ws:string,query:TaskQuery,view:TaskView){return run(async()=>{const {user}=await requireWorkspace(ws);const result=await queryTaskView(ws,user.id,query,view,0,undefined,true);return result.items.map(item=>({id:item.id,title:item.title}));});}
export async function taskViewExportAction(ws:string,query:TaskQuery,view:TaskView){return run(async()=>{const {user}=await requireWorkspace(ws);const result=await queryTaskView(ws,user.id,query,view,0,undefined,true,true);return {items:result.items,values:result.values};});}
export async function taskViewChoicesAction(ws:string){return run(async()=>{const {user}=await requireWorkspace(ws);return taskViewChoices(ws,user.id);});}
