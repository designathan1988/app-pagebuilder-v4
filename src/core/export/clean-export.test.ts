import {test} from 'vitest';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {siteFiles,previewPage} from './export.ts';
import {createEmptyDocument,isEmptyProject,type DocumentJson,type DocNode,type NodeId} from '../document/model.ts';
import {sequentialIds} from '../ports/ids.ts';
import {rulesFromManifest} from '../document/validate.ts';
import {HtmlValidate} from 'html-validate';
const read=(name:string):unknown=>JSON.parse(readFileSync(new URL(`../../../manifest/${name}.json`,import.meta.url),'utf8'));
const rules=rulesFromManifest(read('elements') as Parameters<typeof rulesFromManifest>[0],read('properties') as Parameters<typeof rulesFromManifest>[1],read('generated/html-elements') as Parameters<typeof rulesFromManifest>[2]);
const node=(id:string,name:string,tag:string,children:DocNode[]=[],styles:DocNode['styles']={}):DocNode=>({id:id as NodeId,name,type:(tag==='body'?'page':tag==='h1'?'heading':tag==='button'?'button':'div') as DocNode['type'],tag,attributes:{},styles,classes:[],text:tag==='button'?'Action':tag==='h1'?'Welcome':null,children});
const declaration={desktop:{base:{'padding-top':'80px','padding-right':'64px','padding-bottom':'80px','padding-left':'64px'}}} as DocNode['styles'];
const page=(id:string,file:string)=>({id,name:'Home',file,tree:node(`${id}-root`,'Page','body',[node(`${id}-hero`,'Hero','section',[node(`${id}-title`,'Título 3','h1',[],declaration)],declaration),node(`${id}-btn`,'Button','button'),node(`${id}-form`,'Form','form',[node(`${id}-submit`,'Button','button')])])});
test('actual export owner shares semantic classes across pages and preserves language/button semantics',async()=>{
 const document={version:3,language:'pt-BR',codeLanguage:'en',pages:[page('one','index.html'),page('two','about.html')]} as DocumentJson;
 const files=siteFiles(document,rules);
 assert.ok(files.pages.every(p=>p.html.includes('<html lang="pt-BR">')));
 assert.ok(files.pages.every(p=>p.html.includes('class="hero__title"')));
 assert.doesNotMatch(files.css,/hero-2|titulo-3/);
 assert.equal((files.css.match(/padding: 80px 64px;/g)??[]).length,1);
 assert.match(files.pages[0]?.html??'',/<button type="button">Action<\/button>/);
 assert.match(files.pages[0]?.html??'',/<button type="submit">Action<\/button>/);
 assert.deepEqual(siteFiles(document,rules),files);
 const validator=new HtmlValidate({extends:['html-validate:recommended']});
 for(const p of files.pages){
   const report=await validator.validateString(p.html);
   assert.equal(report.valid,true,JSON.stringify(report.results));
 }
});
test('new project metadata does not make a fresh project nonempty',()=>{
  const names={page:'Início',root:'Página',language:'pt-BR'};
  const document=createEmptyDocument(sequentialIds('test'),names,rules.root);
  assert.equal(isEmptyProject(document),true);
  assert.equal((document as DocumentJson&{language?:string}).language,'pt-BR');
});
test('captured residual stylesheet keeps its cascade and resolves assets in preview',()=>{
 const document={version:3,pages:[page('one','folder/index.html')],files:[{path:'folder/index.capture.css',type:'text/css',bytes:btoa('.hero::before { content: "test"; background-image: url("../img/a.png"); }')},{path:'img/a.png',type:'image/png',bytes:btoa('image')}]} as DocumentJson;
 const html=siteFiles(document,rules).pages[0]?.html??'';
 assert.ok(html.indexOf('href="index.capture.css"')<html.indexOf('href="../css/styles.css"'));
 const preview=previewPage(document,rules);
 assert.match(preview,/data:image\/png;base64,/);
 assert.match(preview,/\.hero::before/);
 assert.doesNotMatch(preview,/href="data:text\/css/);
});
