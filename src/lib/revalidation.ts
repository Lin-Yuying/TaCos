import { AsyncLocalStorage } from "node:async_hooks";
import { revalidatePath } from "next/cache";
const batches=new AsyncLocalStorage<Map<string,{path:string;type?:"page"|"layout"}>>();
export function invalidatePath(path:string,type?:"page"|"layout"){
 const batch=batches.getStore();if(batch){batch.set(`${type??""}:${path}`,{path,type});return;}revalidatePath(path,type);
}
/** Nested item actions contribute paths; a bulk request invalidates each path once. */
export async function withInvalidationBatch<T>(work:()=>Promise<T>):Promise<T>{
 if(batches.getStore())return work();const paths=new Map<string,{path:string;type?:"page"|"layout"}>();
 try{return await batches.run(paths,work);}finally{for(const {path,type} of paths.values())revalidatePath(path,type);}
}
