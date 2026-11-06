/** Decode in chunks; reject an oversized body before materializing the whole file. */
export async function readImportedMarkdown(stream:ReadableStream<Uint8Array>,stem:string,max=1_000_000):Promise<{title:string;doc:string}>{
 const reader=stream.getReader(),decoder=new TextDecoder();
 let pending="",preamble="",preambleSize=0,doc="",title=stem,phase:"leading"|"body-leading"|"body"|"raw"="leading",first=true,cr="";
 const tooLong=()=>{throw new Error(`Document is too long (${max/1_000_000}M characters max)`);};
 const line=(text:string,newline:boolean)=>{
  const value=text+(newline?"\n":"");
  if(phase==="leading"){
   if(!text.trim()){preambleSize+=value.length;if(preamble.length<=max)preamble=(preamble+value).slice(0,max+1);return;}
   const heading=/^#\s+(.+?)\s*#*$/.exec(text);
   if(heading){title=heading[1].trim().slice(0,120)||stem;phase="body-leading";preamble="";return;}
   if(preambleSize+value.length>max)tooLong();doc=preamble+value;phase="raw";return;
  }
  if(phase==="body-leading"){if(!text.trim())return;phase="body";}
  if(doc.length+value.length>max)tooLong();doc+=value;
 };
 try{
  while(true){const {value,done}=await reader.read();let text=cr+decoder.decode(value,{stream:!done});cr="";
   if(first&&text){text=text.replace(/^\uFEFF/,"");first=false;}
   if(!done&&text.endsWith("\r")){cr="\r";text=text.slice(0,-1);}text=text.replace(/\r\n/g,"\n");pending+=text;
   let at:number;while((at=pending.indexOf("\n"))>=0){line(pending.slice(0,at),true);pending=pending.slice(at+1);}
   if((["raw","body"] as string[]).includes(phase)&&doc.length+pending.length>max)tooLong();
   if((phase==="leading"||phase==="body-leading")&&pending.length>max&&pending.trim()&&!/^#\s/.test(pending))tooLong();
   if(done){line(pending,false);break;}
  }
  if(phase==="leading"){if(preambleSize>max)tooLong();doc=preamble;}
  return {title,doc};
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
