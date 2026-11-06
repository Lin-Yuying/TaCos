import { docDiffItems } from "../doc-diff-render";
self.onmessage=(event:MessageEvent<{before:string;after:string}>)=>{try{self.postMessage({items:docDiffItems(event.data.before,event.data.after)});}catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}};
