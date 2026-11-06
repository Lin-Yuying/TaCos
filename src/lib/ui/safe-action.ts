// Server actions already report business errors. Transport failures need the same shape.
export async function safeAction<T>(work:()=>Promise<T>):Promise<T|{ok:false;error:string}>{
 try{return await work();}catch{return {ok:false,error:"Could not save. Retry."};}
}
