import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { UPLOAD_DIR } from "./attachments";
const pending=new Map<string,Promise<Buffer>>();
let jobs=0;
/** Header/pixel limits precede decoding. Originals are always retained. */
export async function imagePreview(id:string):Promise<Buffer>{
 const current=pending.get(id);if(current)return current;
 if(jobs>=2)throw new Error("Image previews are busy. Retry shortly.");
 jobs++;
 const job=(async()=>{
  const original=path.join(UPLOAD_DIR,id),target=path.join(UPLOAD_DIR,`${id}.preview.webp`);
  try{return await fs.readFile(target);}catch{/* first preview */}
  const image=sharp(original,{limitInputPixels:40_000_000,animated:true,failOn:"error"});
  const meta=await image.metadata();
  if(!meta.width||!meta.height||meta.width*(meta.pageHeight??meta.height)*(meta.pages??1)>40_000_000)throw new Error("Download the original to view this image.");
  const data=await image.rotate().resize({width:2048,height:2048,fit:"inside",withoutEnlargement:true}).webp({quality:85}).toBuffer();
  const temporary=`${target}.${process.pid}.tmp`;await fs.writeFile(temporary,data);await fs.rename(temporary,target);return data;
 })().finally(()=>{pending.delete(id);jobs--;});pending.set(id,job);return job;
}
