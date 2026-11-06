import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
const zip=promisify(gzip),unzip=promisify(gunzip);
export async function packText(text:string):Promise<{text:string;compressed:string|null}>{
 if(Buffer.byteLength(text)<4096)return {text,compressed:null};
 const compressed=(await zip(Buffer.from(text))).toString("base64");
 return compressed.length<Buffer.byteLength(text)?{text:"",compressed}:{text,compressed:null};
}
export async function unpackText(text:string,compressed?:string|null):Promise<string>{return compressed?(await unzip(Buffer.from(compressed,"base64"))).toString("utf8"):text;}
