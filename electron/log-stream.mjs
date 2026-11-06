import fs from "node:fs";
import path from "node:path";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
const active = new Set();
const maintaining = new Map();
const mb = (name, fallback) => Math.max(1, Number(process.env[name]) || fallback) * 1024 * 1024;

async function inUse(file){
 if(active.has(file))return true;
 const dir=path.dirname(file),prefix=path.basename(file)+".active-";
 for(const name of await fs.promises.readdir(dir))if(name.startsWith(prefix)){
  const pid=Number(name.slice(prefix.length));if(!Number.isSafeInteger(pid)||pid<=0)return true;
  try{process.kill(pid,0);return true;}catch(error){if(error.code!=="ESRCH")return true;await fs.promises.rm(path.join(dir,name),{force:true});}
 }
 return false;
}

async function maintainLogs(dir) {
  if (maintaining.has(dir)) return maintaining.get(dir);
  const work = (async () => {
    let files = await fs.promises.readdir(dir, { withFileTypes: true });
    const recent=(await Promise.all(files.filter(entry=>entry.isFile()&&entry.name.endsWith(".log")).map(async entry=>({name:entry.name,at:(await fs.promises.stat(path.join(dir,entry.name))).mtimeMs})))).sort((a,b)=>b.at-a.at).slice(0,5);
    const keep=new Set(recent.map(row=>row.name));
    for (const entry of files) {
      const file = path.join(dir, entry.name);
      if (!entry.isFile() || !entry.name.endsWith(".log") || await inUse(file) || keep.has(entry.name)) continue;
      const target = `${file}.gz`, temporary = `${target}.tmp`;
      try {
        await pipeline(fs.createReadStream(file), createGzip(), fs.createWriteStream(temporary, { flags: "wx" }));
        await fs.promises.rename(temporary, target);
        await fs.promises.rm(file);
      } catch { await fs.promises.rm(temporary, { force: true }).catch(() => {}); }
    }
    files = await fs.promises.readdir(dir, { withFileTypes: true });
    const sizes = await Promise.all(files.filter(entry => entry.isFile() && /\.log(?:\.gz)?$/.test(entry.name)).map(async entry => {
      const file = path.join(dir, entry.name), stat = await fs.promises.stat(file);
      return { file, size: stat.size, at: stat.mtimeMs };
    }));
    sizes.sort((a,b) => b.at-a.at);
    let total = sizes.reduce((sum,row) => sum+row.size,0);
    for (const row of sizes.slice(5).reverse()) {
      if (total <= mb("TACOS_LOG_DIR_MB",256)) break;
      if (await inUse(row.file) || !row.file.endsWith(".gz")) continue;
      await fs.promises.rm(row.file,{force:true}); total-=row.size;
    }
  })().finally(() => maintaining.delete(dir));
  maintaining.set(dir,work); return work;
}

/** A long-lived asynchronous sink. pipe() and write callbacks provide backpressure. */
function createLogStream(file) {
  const dir=path.dirname(file),marker=`${file}.active-${process.pid}`; let handle,bytes=0;
  active.add(file);
  const ready=fs.promises.mkdir(dir,{recursive:true}).then(async()=>{
    await fs.promises.writeFile(marker,String(process.pid),{mode:0o600});
    handle=await fs.promises.open(file,"a"); bytes=(await handle.stat()).size;
    void maintainLogs(dir).catch(()=>{});
  });
  const append=async chunks=>{
    await ready;
    if(bytes>=mb("TACOS_LOG_MAX_MB",8)){
      await handle.close();
      await fs.promises.rename(file,`${file}.${Date.now()}-${Math.random().toString(36).slice(2,8)}.log`);
      handle=await fs.promises.open(file,"a");bytes=0;
      void maintainLogs(dir).catch(()=>{});
    }
    const buffer=Buffer.concat(chunks.map(chunk=>Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk)));
    await handle.writeFile(buffer);bytes+=buffer.length;
  };
  const stream=new Writable({highWaterMark:64*1024,
    write(chunk,_encoding,done){append([chunk]).then(()=>done(),done);},
    writev(chunks,done){append(chunks.map(row=>row.chunk)).then(()=>done(),done);},
    final(done){ready.then(()=>handle?.close()).then(()=>fs.promises.rm(marker,{force:true})).then(()=>{active.delete(file);void maintainLogs(dir).catch(()=>{});done();},done);},
    destroy(error,done){active.delete(file);Promise.resolve(handle?.close()).catch(()=>{}).then(()=>fs.promises.rm(marker,{force:true})).catch(()=>{}).finally(()=>done(error));}
  });
  ready.catch(error=>stream.destroy(error));
  return stream;
}
export {createLogStream,maintainLogs};
