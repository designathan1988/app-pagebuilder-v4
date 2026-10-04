import {test} from 'vitest';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createStore,type Store} from '../../core/store/store.ts';
import {setAttributeCommand} from '../../core/elements/attributes.ts';
import {renameCommand} from '../../core/nodes/names.ts';
import {undoCommand,redoCommand,canUndo,canRedo} from '../../core/history/history.ts';
import {newBlankPage} from '../../core/project/project.ts';
import {registerHandler,registerPredicate,NOT_AVAILABLE_YET,message,type CommandTable,type PredicateTable,type Message} from '../../core/commands/registry.ts';
import {commandsFileSchema,elementsFileSchema,propertiesFileSchema,generatedHtmlSchema,type Command} from '../../manifest/schema.ts';
import {rulesFromManifest} from '../../core/document/validate.ts';
import type {DocumentJson,NodeId} from '../../core/document/model.ts';
import type {CommandId} from '../../generated/ids.ts';
import type {CommandArgs} from '../../generated/commands.ts';
import {manualClock} from '../../core/ports/clock.ts';
import {sequentialIds} from '../../core/ports/ids.ts';
import {editorTools} from '../../editor/assistant/editor.ts';
import {createAssistantSession} from '../../editor/assistant/session.ts';
const read=(name:string)=>JSON.parse(readFileSync(new URL(`../../../manifest/${name}.json`,import.meta.url),'utf8'));
const commands:Command[]=readdirSync(new URL('../../../manifest/commands/',import.meta.url)).filter(name=>name.endsWith('.json')).flatMap(name=>commandsFileSchema.parse(read(`commands/${name.slice(0,-5)}`)).commands);
const rules=rulesFromManifest(elementsFileSchema.parse(read('elements')),propertiesFileSchema.parse(read('properties')),generatedHtmlSchema.parse(read('generated/html-elements')));
const node='button-node' as NodeId;
const initial:DocumentJson={version:2,pages:[{id:'page',name:'Home',file:'index.html',tree:{id:'root' as NodeId,type:'page',name:'Page',tag:'body',attributes:{},styles:{},classes:[],text:null,children:[{id:node,type:'button',name:'Action',tag:'button',attributes:{},styles:{},classes:[],text:'Action',children:[]}]}}]};
const busy=message('common.notAvailableYet');
interface Group {dispatch<Id extends CommandId>(id:Id,args:CommandArgs[Id]):ReturnType<Store<never>['dispatch']>;active():boolean;commit():void;cancel():void}
interface GroupStore extends Store<never>{commandGroup(refusal:Message):Group;commandGroupOpen():boolean}
const uiCommand=registerHandler('timeline.stop',({state})=>({kind:'change',ui:{...(state.ui as Record<string,unknown>),transcript:'streaming'} as never}));
const select=registerHandler('selection.select',(_context,{target})=>({kind:'change',selection:[target]}));
const load=registerHandler('project.newBlankPage',()=>({kind:'load',document:initial}));
function setup(overrides:Partial<CommandTable<never>>={}){
 const table={...Object.fromEntries(commands.map(command=>[command.id,NOT_AVAILABLE_YET])),'element.setAttribute':setAttributeCommand,'element.rename':renameCommand,'history.undo':undoCommand,'history.redo':redoCommand,'project.newBlankPage':load,'timeline.stop':uiCommand,'selection.select':select,...overrides} as CommandTable<never>;
 const predicates={...Object.fromEntries(commands.map(command=>[command.availability.predicate,registerPredicate(command.availability.predicate as Parameters<typeof registerPredicate>[0],()=>true)])),canUndo,canRedo} as PredicateTable<never>;
 return createStore({table,predicates,commands:new Map(commands.map(command=>[command.id as CommandId,command])),constants:new Map(),rules,clock:manualClock(),ids:sequentialIds('test'),words:(_ui,key)=>key,initial:{document:structuredClone(initial),selection:[node],ui:{} as never},freeze:true}) as GroupStore;
}
test('reproduces actual per-dispatch attribute refusal inside the existing pointer gesture',()=>{
 const store=setup();
 const before=store.getState();
 const gesture=store.gesture();
 assert.throws(()=>gesture.dispatch('element.setAttribute',{target:node,attribute:'buttonType',value:'submit'}),/per dispatch.*gesture/);
 gesture.cancel();
 assert.deepEqual(store.getState().document,before.document);
 assert.deepEqual(store.getState().history,before.history);
});
test('actual attribute and rename commands form one entry and undo/redo restore both',()=>{
 const store=setup();
 const before=store.getState();
 const group=store.commandGroup(busy);
 assert.equal(group.dispatch('element.setAttribute',{target:node,attribute:'buttonType',value:'submit'}).status,'done');
 assert.equal(group.dispatch('element.rename',{target:node,name:'Send'}).status,'done');
 assert.equal(store.getState().history.past.length,0);
 assert.equal(store.commandGroupOpen(),true);
 group.commit();
 assert.equal(store.getState().history.past.length,1);
 assert.equal(store.commandGroupOpen(),false);
 const after=store.getState();
 store.dispatch('history.undo',{});
 assert.deepEqual(store.getState().document,before.document);
 assert.deepEqual(store.getState().selection,before.selection);
 store.dispatch('history.redo',{});
 assert.deepEqual(store.getState().document,after.document);
});
test('cancel preserves existing history/redo and restores document/selection while allowing transcript and notice',()=>{
 const store=setup();
 store.dispatch('element.rename',{target:node,name:'Existing'});
 store.dispatch('history.undo',{});
 const before=store.getState();
 const group=store.commandGroup(busy);
 group.dispatch('element.setAttribute',{target:node,attribute:'buttonType',value:'submit'});
 group.dispatch('selection.select',{target:'root' as NodeId});
 assert.equal(store.dispatch('timeline.stop',{}).status,'done');
 store.notice(message('status.confirmation.cancelled'));
 group.cancel();
 assert.deepEqual(store.getState().document,before.document);
 assert.deepEqual(store.getState().selection,before.selection);
 assert.deepEqual(store.getState().history,before.history);
 assert.equal((store.getState().ui as Record<string,unknown>).transcript,'streaming');
 assert.equal(store.commandGroupOpen(),false);
});
test('busy lease refuses external document/load/history/selection dispatch but permits UI and status',()=>{
 const store=setup();
 store.dispatch('element.rename',{target:node,name:'Existing'});
 const group=store.commandGroup(busy);
 const before=store.getState();
 for(const result of [store.dispatch('element.setAttribute',{target:node,attribute:'buttonType',value:'submit'}),store.dispatch('project.newBlankPage',{}),store.dispatch('history.undo',{}),store.dispatch('selection.select',{target:'root' as NodeId})])assert.equal(result.status,'refused');
 assert.equal(store.canRun('element.rename',{target:node,name:'blocked'}),false);
 assert.deepEqual(store.getState().document,before.document);
 assert.deepEqual(store.getState().history,before.history);
 assert.deepEqual(store.getState().selection,before.selection);
 assert.equal(store.dispatch('timeline.stop',{}).status,'done');
 assert.throws(()=>store.gesture(),/group/);
 assert.throws(()=>store.sequence(),/group/);
 assert.throws(()=>store.commandGroup(busy),/group/);
 group.cancel();
});
test('refusal, throw and invalid-state failure roll back every prior command atomically',()=>{
 const bad=registerHandler('element.rename',()=>({kind:'change',patches:[{op:'replace',path:['pages',0,'tree','children',0,'tag'],value:'not-a-valid-tag'}]}));
 const thrown=registerHandler('element.rename',()=>{
   throw Error('Injected handler failure');
 });
 for(const failing of [bad,thrown]){
   const store=setup({'element.rename':failing});
   const before=store.getState();
   const group=store.commandGroup(busy);
   group.dispatch('element.setAttribute',{target:node,attribute:'buttonType',value:'submit'});
   assert.throws(()=>group.dispatch('element.rename',{target:node,name:'bad'}));
   assert.deepEqual(store.getState().document,before.document);
   assert.deepEqual(store.getState().selection,before.selection);
   assert.deepEqual(store.getState().history,before.history);
   assert.equal(group.active(),false);
 }
 const store=setup();
 const before=store.getState();
 const group=store.commandGroup(busy);
 group.dispatch('element.setAttribute',{target:node,attribute:'buttonType',value:'submit'});
 assert.equal(group.dispatch('element.setAttribute',{target:node,attribute:'buttonType',value:'invalid-type'}).status,'refused');
 assert.deepEqual(store.getState().document,before.document);
 assert.equal(group.active(),false);
});
test('group refuses load/history/confirmation/effects and remains separate from pointer/sequence contracts',()=>{
 const store=setup({'project.newBlankPage':newBlankPage});
 const group=store.commandGroup(busy);
 assert.equal(group.dispatch('project.newBlankPage',{}).status,'refused');
 assert.equal(group.active(),false);
 const pointer=store.gesture();
 assert.throws(()=>store.commandGroup(busy),/gesture/);
 pointer.cancel();
 const sequence=store.sequence();
 assert.throws(()=>store.commandGroup(busy),/sequence/);
 sequence.cancel();
});
test('real session reserves store before credential await and releases after cancellation without touching history',async()=>{
 const store=setup();
 let resolveKey:(value:string)=>void=()=>{
   throw Error('not started');
 };
 const key=new Promise<string>(resolve=>{
   resolveKey=resolve;
 });
 // Acquire through the production beginGroup port; the group is supplied at reservation time below.
 let group:Group;
 const actualTools=editorTools([], {read:()=>store.getState().document,screenshot:async()=>({data:'',mimeType:'image/png'}),dispatch:(id,args)=>store.dispatch(id as CommandId,args as CommandArgs[CommandId]),beginGroup:()=>{
   group=store.commandGroup(busy);
   return {dispatch:(id,args)=>group.dispatch(id as CommandId,args as CommandArgs[CommandId]),commit:()=>group.commit(),cancel:()=>group.cancel()};
 },authorize:async()=>true});
 const session=createAssistantSession({...actualTools,tools:[],vault:{read:()=>key,save:async()=>{},clear:async()=>{},close(){}},settings:()=>({model:'chosen',maxTokens:100}),onState:()=>{},onText:()=>{},onTool:()=>{},fetch:async()=>{
   throw Error('network must not start');
 }});
 const before=store.getState();
 const pending=session.send('Change the page');
 assert.equal(store.commandGroupOpen(),true);
 assert.equal(store.dispatch('element.rename',{target:node,name:'external'}).status,'refused');
 session.cancel();
 resolveKey('test-key');
 await assert.rejects(pending,/cancelled/);
 assert.equal(store.commandGroupOpen(),false);
 assert.deepEqual(store.getState().document,before.document);
 assert.deepEqual(store.getState().history,before.history);
});
