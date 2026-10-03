import type {DocumentJson,NodeId} from '../document/model.ts';
import {locate,walk} from '../document/model.ts';
import { languageTagAllowed } from '../text/language-tag.ts';
import type {Patch} from '../history/transaction.ts';
import type {HandlerContext,Outcome} from '../commands/registry.ts';
import {renameCommand} from '../nodes/names.ts';
import {batchNames} from './names.ts';
export type ExportDocument=DocumentJson&{readonly language?:string;readonly codeLanguage?:string};
export function projectLanguagePatches(document:ExportDocument,language:string,codeLanguage:string):readonly Patch[]{
 if(!languageTagAllowed(language)||!languageTagAllowed(codeLanguage))throw new Error('A project language must be a valid language tag');
 return [['language',language],['codeLanguage',codeLanguage]].flatMap(([key,value])=>{
   if(key===undefined||value===undefined)return [];
   const held=key==='language'?document.language:document.codeLanguage;
   return held===value?[]:[{op:held===undefined?'add' as const:'replace' as const,path:[key],value}];
 });
}
// Reuse the rename owner for every refusal and patch; no partial changes escape when one target is locked.
export function renameBatch(context:HandlerContext<never>,targets:readonly NodeId[],pattern:string,start=1):Outcome<never>{
 if(new Set(targets).size!==targets.length)throw new Error('A batch target must occur once');
 const names=targets.map(id=>{
   const at=locate(context.state.document,id);
   if(at===null)throw new Error('A batch target no longer exists');
   return at.node.name;
 });
 const renamed=batchNames(names,pattern,start);
 const patches:Patch[]=[];
 for(const [index,target] of targets.entries()){
   const outcome=renameCommand.run(context,{target,name:renamed[index]??''});
   if(outcome.kind!=='change')return outcome;
   patches.push(...outcome.patches??[]);
 }
 return {kind:'change',patches};
}
export function formNodes(document:DocumentJson):ReadonlySet<NodeId>{
  const inside=new Set<NodeId>();
  for(const page of document.pages)for(const node of walk(page.tree))if(node.tag==='form')for(const child of walk(node))inside.add(child.id);
  return inside;
}
