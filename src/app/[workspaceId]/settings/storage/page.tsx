import { Suspense } from "react";
import { connection } from "next/server";
import { requireWorkspace } from "@/lib/auth";
import { StorageView } from "@/components/storage-view";
async function View({params}:{params:Promise<{workspaceId:string}>}){await connection();const {workspaceId}=await params,context=await requireWorkspace(workspaceId);return <StorageView workspaceId={workspaceId} admin={context.role==="admin"}/>;}
export default function StoragePage(props:{params:Promise<{workspaceId:string}>}){return <Suspense fallback={<p className="p-6">Loading…</p>}><View {...props}/></Suspense>;}
