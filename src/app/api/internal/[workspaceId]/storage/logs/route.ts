import fs from "node:fs";
import path from "node:path";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { requireAdmin } from "@/lib/auth";
import { harnessLogDir } from "@/lib/harness/turn-log";
export async function GET(_request:Request,{params}:{params:Promise<{workspaceId:string}>}){
 try{const {workspaceId}=await params,{user}=await requireAdmin(workspaceId);if(user.siteRole!=="admin")return new Response(null,{status:403});
  const root=path.dirname(harnessLogDir());
  async function* contents():AsyncGenerator<Buffer>{const stack=[root];while(stack.length){const dir=stack.pop()!;let entries;try{entries=await fs.promises.readdir(dir,{withFileTypes:true});}catch{continue;}for(const entry of entries){const file=path.join(dir,entry.name);if(entry.isDirectory())stack.push(file);else if(entry.isFile()&&/\.log(?:\.gz)?$/.test(entry.name)){yield Buffer.from(`\n===== ${path.relative(root,file)} =====\n`);try{const stream=fs.createReadStream(file);const content=entry.name.endsWith(".gz")?stream.pipe(createGunzip()):stream;for await(const chunk of content)yield Buffer.from(chunk);}catch{yield Buffer.from("\nLog rotated during export. Retry to include the latest archive.\n");}}}}}
  return new Response(Readable.toWeb(Readable.from(contents())) as ReadableStream,{headers:{"Content-Type":"text/plain; charset=utf-8","Content-Disposition":"attachment; filename=diagnostics.txt","Cache-Control":"no-store"}});
 }catch{return new Response(null,{status:403});}
}
