import {test} from 'vitest';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import type {DocNode,DocumentJson,NodeId} from '../document/model.ts';
import type {HandlerContext} from '../commands/registry.ts';
import {rulesFromManifest} from '../document/validate.ts';
import {manualClock} from '../ports/clock.ts';
import {sequentialIds} from '../ports/ids.ts';
import {anyCss} from '../ports/css.ts';
import {noLayout} from '../ports/layout.ts';
import {EMPTY_HISTORY} from '../history/history.ts';
import {projectLanguagePatches,renameBatch} from './authoring.ts';
const read=(name:string):unknown=>JSON.parse(readFileSync(new URL(`../../../manifest/${name}.json`,import.meta.url),'utf8'));
const rules=rulesFromManifest(read('elements') as Parameters<typeof rulesFromManifest>[0],read('properties') as Parameters<typeof rulesFromManifest>[1],read('generated/html-elements') as Parameters<typeof rulesFromManifest>[2]);
const node=(id:string,tag:string,children:DocNode[]=[]):DocNode=>({id:id as NodeId,name:id,type:(tag==='body'?'page':tag==='button'?'button':'div') as DocNode['type'],tag,attributes:{},styles:{},classes:[],text:null,children});
const document:DocumentJson={version:2,pages:[{id:'p',name:'Home',file:'index.html',tree:node('root','body',[node('a','div'),node('b','button'),node('f','form',[node('s','button')])])}]};
const context=(doc:DocumentJson):HandlerContext<never>=>({state:{document:doc,selection:[],history:EMPTY_HISTORY,message:null,ui:undefined as never},clock:manualClock(),ids:sequentialIds('new'),rules,words:key=>key,layout:noLayout,css:anyCss});
test('batch delegates locks and parent refusal atomically',()=>{
  assert.equal(renameBatch(context(document),['a','b'] as NodeId[],'Layer {n}').kind,'change');
  const locked=structuredClone(document);
  Object.assign(locked.pages[0]?.tree.children[1]??{},{locked:true});
  assert.equal(renameBatch(context(locked),['a','b'] as NodeId[],'Layer {n}').kind,'refused');
  assert.equal(renameBatch(context(document),['root'] as NodeId[],'No').kind,'refused');
});
test('project language accepts valid locales and rejects invalid languages without patches',()=>{
  assert.equal(projectLanguagePatches(document,'pt-BR','en').length,2);
  assert.throws(()=>projectLanguagePatches(document,'banana','en'));
  assert.deepEqual(projectLanguagePatches({...document,language:'fr',codeLanguage:'en'},'fr','en'),[]);
});
