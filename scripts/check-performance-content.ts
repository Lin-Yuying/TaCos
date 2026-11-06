import assert from "node:assert/strict";
import { Editor } from "@tiptap/core";
import { documentMarkdown,markdownToDocument } from "../src/lib/editor/document-markdown";
import { documentExtensions } from "../src/lib/editor/extensions";
import { incrementalMarkdown } from "../src/lib/editor/incremental-markdown";
import { documentIndex,searchDocument } from "../src/lib/editor/document-index";
import { readImportedMarkdown } from "../src/lib/import-markdown-stream";
import { packText,unpackText } from "../src/lib/compressed-text";
async function main(){
 const baseline=documentMarkdown(),optimized=documentMarkdown(),serialize=incrementalMarkdown(optimized);
 const samples=["","Alpha\n\nBeta","# 中文\n\n**bold** and _italic_\n\n- [ ] todo\n- [x] done","1. first\n2. next\n\n3. more",":::toggle {open} Details\nhello\n:::","| A | B |\n| --- | --- |\n| first | second |","![picture](/api/files/fixture-file)\n\n[[Page]]\n\n![[Page]]","same\n\nsame\n\nsame","😀İß中文\n\n# Heading"];
 for(const source of samples){const editor=new Editor({extensions:documentExtensions(),content:markdownToDocument(baseline,source)});try{for(let n=0;n<20;n++){assert.equal(serialize(editor.state.doc),baseline.serialize(editor.state.doc.toJSON()),source);const tr=editor.state.tr.insertText(n%2?"中":"x",Math.min(2,editor.state.doc.content.size));editor.view.updateState(editor.state.apply(tr));}}finally{editor.destroy();}}
 const editor=new Editor({extensions:documentExtensions(),content:markdownToDocument(baseline,"İ test 😀中文 中文\n\n# 标题")});const indexed=documentIndex(editor.state.doc);assert.equal(searchDocument(indexed,"中文").length,2);assert.equal(searchDocument(indexed,"missing").length,0);editor.destroy();
 for(const source of [""," \n\n","\uFEFF# Title\r\n\r\n中文\r\n","before\n\n# Not title\n","\n\n# heading ###\n\nbody\n","# Title\n\n", "\r\n# 中文\r\n\r\n内容"]){
  const normalized=source.replace(/^\uFEFF/,"").replace(/\r\n/g,"\n"),lines=normalized.split("\n"),first=lines.findIndex(line=>line.trim()),heading=first>=0?/^#\s+(.+?)\s*#*$/.exec(lines[first]):null;let title="file",doc=normalized;if(heading){title=heading[1].trim().slice(0,120)||"file";doc=lines.slice(first+1).join("\n").replace(/^\s*\n/,"");}
  const bytes=new TextEncoder().encode(source);for(const size of [1,3,31]){let at=0;const stream=new ReadableStream<Uint8Array>({pull(controller){if(at>=bytes.length)controller.close();else {controller.enqueue(bytes.slice(at,at+size));at+=size;}}});assert.deepEqual(await readImportedMarkdown(stream,"file"),{title,doc});}
 }
 await assert.rejects(()=>readImportedMarkdown(new Blob(["中".repeat(102)]).stream(),"x",100),/too long/);
 for(const text of ["small","中文 😀\n".repeat(10000)]){const packed=await packText(text);assert.equal(await unpackText(packed.text,packed.compressed),text);}
 console.log("check-performance-content: pass (incremental edits differential, Unicode search, byte-split import, compression roundtrip)");
}main().catch(error=>{console.error(error);process.exit(1);});
