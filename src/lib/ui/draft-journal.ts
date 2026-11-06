type Snapshot={draftSnapshot:1;revision:string;value:unknown};
type Patch={at:number;remove:number;insert:string};
type Journal={revision:string;patches:Patch[]};
export const journalKey=(key:string)=>`${key}.journal`;
function snapshot(raw:string|null):Snapshot|undefined{try{const value=JSON.parse(raw??"null");return value?.draftSnapshot===1?value:undefined;}catch{return;}}
export function readDraft(key:string):string|null {
  const raw=localStorage.getItem(key),base=snapshot(raw);if(!base)return raw;
  let value=base.value;
  if(typeof value==="string"){
    const journal=JSON.parse(localStorage.getItem(journalKey(key))??"null") as Journal|null;
    if(journal?.revision===base.revision){let text=value;for(const patch of journal.patches)text=text.slice(0,patch.at)+patch.insert+text.slice(patch.at+patch.remove);value=text;}
  }
  return JSON.stringify(value);
}
/** Each accepted edit first writes a small durable splice; snapshots compact that journal. */
export function writeDraft(key:string,value:unknown){
  const raw=localStorage.getItem(key),base=snapshot(raw);
  if(typeof value==="string"&&typeof base?.value==="string"){
    const old=JSON.parse(readDraft(key)??'""') as string;
    if(old===value)return;
    let at=0,end=0;while(at<old.length&&at<value.length&&old[at]===value[at])at++;
    while(end<old.length-at&&end<value.length-at&&old[old.length-1-end]===value[value.length-1-end])end++;
    const stored=JSON.parse(localStorage.getItem(journalKey(key))??"null") as Journal|null;
    const journal:Journal=stored?.revision===base.revision?stored:{revision:base.revision,patches:[]};
    journal.patches.push({at,remove:old.length-at-end,insert:value.slice(at,value.length-end)});
    const encoded=JSON.stringify(journal);
    if(journal.patches.length<64&&encoded.length<65536){localStorage.setItem(journalKey(key),encoded);return;}
  }
  localStorage.setItem(key,JSON.stringify({draftSnapshot:1,revision:crypto.randomUUID(),value} satisfies Snapshot));
  // Keep the old journal: a different tab may already have appended to this new
  // snapshot. Revision checks ignore the old generation without deleting newer work.
}
export function removeDraft(key:string){localStorage.removeItem(key);localStorage.removeItem(journalKey(key));}
