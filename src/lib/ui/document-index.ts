type Page = {id:string;title:string;parentId:string|null};
/** Build once per page collection; text filtering and comparisons only read these maps. */
export function documentIndex(pages: Page[]) {
  const byId=new Map(pages.map(page=>[page.id,page]));
  const children=new Map<string, string[]>();
  for(const page of pages){if(page.parentId){const bucket=children.get(page.parentId)??[];bucket.push(page.id);children.set(page.parentId,bucket);}}
  const paths=new Map<string,string>();
  for(const page of pages){
    if(paths.has(page.id))continue;
    const chain:Page[]=[],seen=new Set<string>();let at:Page|undefined=page;
    while(at&&!paths.has(at.id)&&!seen.has(at.id)){seen.add(at.id);chain.push(at);at=at.parentId?byId.get(at.parentId):undefined;}
    // Corrupt cycles remain readable; do not recurse forever or change real parents.
    let prefix=at?paths.get(at.id)??"":"";
    while(chain.length){const node=chain.pop()!;prefix=prefix?`${prefix} / ${node.title}`:node.title;paths.set(node.id,prefix);}
  }
  const search=new Map([...paths].map(([id,path])=>[id,path.toLowerCase()]));
  function descendants(id:string){const out=new Set([id]),queue=[id];for(let i=0;i<queue.length;i++)for(const child of children.get(queue[i])??[])if(!out.has(child)){out.add(child);queue.push(child);}return out;}
  return {byId,paths,search,descendants};
}
