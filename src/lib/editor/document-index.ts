import type { Node as PMNode } from "@tiptap/pm/model";

type Block = { text: string; folded: string; positions: number[]; foldedPositions: number[] };
const blocks = new WeakMap<PMNode, Block>();
function blockIndex(node: PMNode): Block {
  const cached = blocks.get(node); if (cached) return cached;
  let text = ""; const positions: number[] = [];
  node.descendants((child, offset) => {
    if (child.isText) { const value = child.text ?? ""; text += value; for (let i=0;i<value.length;i++) positions.push(offset+i); }
  });
  const folded = text.toLocaleLowerCase(), foldedPositions: number[] = [];
  for (let i=0;i<text.length;) {
    const char=String.fromCodePoint(text.codePointAt(i)!);
    for(let j=0;j<char.toLocaleLowerCase().length;j++) foldedPositions.push(i+Math.min(j,char.length-1));
    i+=char.length;
  }
  const result={text,folded,positions,foldedPositions}; blocks.set(node,result); return result;
}
export function documentIndex(doc: PMNode) {
  const headings: {title:string;level:number;pos:number}[]=[], textBlocks: {pos:number;index:Block}[]=[];
  doc.descendants((node,pos)=>{
    if(node.type.name==="heading")headings.push({title:node.textContent,level:node.attrs.level,pos});
    if(node.isTextblock){textBlocks.push({pos,index:blockIndex(node)});return false;}
  });
  return {headings,textBlocks};
}
export function searchDocument(index: ReturnType<typeof documentIndex>, query:string) {
  const found:{from:number;to:number}[]=[],needle=query.toLocaleLowerCase(); if(!needle)return found;
  for(const {pos,index:block} of index.textBlocks){
    for(let at=block.folded.indexOf(needle);at>=0;at=block.folded.indexOf(needle,at+needle.length)){
      const first=block.foldedPositions[at],last=block.foldedPositions[at+needle.length-1];
      if(first!==undefined&&last!==undefined)found.push({from:pos+1+block.positions[first],to:pos+2+block.positions[last]});
    }
  }
  return found;
}
