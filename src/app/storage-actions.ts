"use server";
import { requireWorkspace,requireAdmin } from "@/lib/auth";
import { storageUsage } from "@/lib/storage-usage";
import { auditAttachmentReferences } from "@/lib/attachment-references";
import { getDb } from "@/db/client";
import type { ActionResult } from "./actions";
async function run<T>(work:()=>Promise<T>):Promise<ActionResult<T>>{try{return {ok:true,data:await work()};}catch(error){return {ok:false,error:error instanceof Error?error.message:"Could not load storage usage. Retry."};}}
export async function storageUsageAction(ws:string){return run(async()=>{const context=await requireAdmin(ws);return storageUsage(ws,context.user.siteRole==="admin");});}
export async function auditAttachmentsAction(ws:string){return run(async()=>{await requireAdmin(ws);return auditAttachmentReferences(ws);});}
export async function listRunArchivesAction(ws:string,before?:string){return run(async()=>{const {user}=await requireWorkspace(ws);return getDb().$client.prepare("SELECT id,status,created_at AS createdAt,error FROM agent_runs WHERE workspace_id=? AND user_id=? AND status NOT IN ('queued','running') AND (? IS NULL OR created_at||id<?) ORDER BY created_at DESC,id DESC LIMIT 51").all(ws,user.id,before??null,before??null) as {id:string;status:string;createdAt:string;error:string|null}[];});}
