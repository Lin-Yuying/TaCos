import type { JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { MarkdownManager } from "@tiptap/markdown";

/** PM nodes are immutable: reuse unchanged JSON and top-level block renderings. */
export function incrementalMarkdown(manager: MarkdownManager) {
  const json=new WeakMap<PMNode,JSONContent>();
  const rendered=new WeakMap<JSONContent,{previous:JSONContent|undefined;text:string}>();
  const original=manager.renderNodeToMarkdown.bind(manager);
  manager.renderNodeToMarkdown=(node,parent,index=0,level=0,meta={})=>{
    if(parent?.type!=="doc"||level!==0)return original(node,parent,index,level,meta);
    const previous=parent.content?.[index-1],cached=rendered.get(node);
    if(cached&&cached.previous===previous)return cached.text;
    const text=original(node,parent,index,level,meta);rendered.set(node,{previous,text});return text;
  };
  const encode=(node:PMNode):JSONContent=>{
    const cached=json.get(node);if(cached)return cached;
    let value:JSONContent;
    if(node.isLeaf)value=node.toJSON();
    else {value={type:node.type.name};if(Object.keys(node.attrs).length)value.attrs=node.attrs;if(node.marks.length)value.marks=node.marks.map(mark=>mark.toJSON());const content:JSONContent[]=[];node.forEach(child=>content.push(encode(child)));if(content.length)value.content=content;}
    json.set(node,value);return value;
  };
  return (doc:PMNode)=>manager.serialize(encode(doc));
}
