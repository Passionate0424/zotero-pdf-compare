import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
function service({pairs={},items={},library={editable:true,filesEditable:true}}={}){
 const context=vm.createContext({Zotero:{Libraries:{get:()=>library},Items:{get:ids=>ids.map(id=>items[id])}}});
 vm.runInContext(fs.readFileSync(new URL('../../addon/src/manual-import.js',import.meta.url),'utf8'),context);
 const addon={stopped:false,getPairs:()=>pairs,refreshControls:()=>{}};
 return{manual:new context.DoubaoManualImport(addon),addon};
}
const pdf=(id,key)=>({id,key,libraryID:1,parentID:9,deleted:false,isPDFAttachment:()=>true});
test('a selected concrete PDF is never replaced by a different sibling',()=>{
 const {manual}=service();const source=pdf(1,'SOURCE');assert.equal(manual.sourceForSelection([source]),source);
});
test('ambiguous parent selection requires the user to identify the original PDF',()=>{
 const {manual}=service({items:{1:pdf(1,'A'),2:pdf(2,'B')}});
 assert.throws(()=>manual.sourceForSelection([{libraryID:1,isPDFAttachment:()=>false,isRegularItem:()=>true,getAttachments:()=>[1,2]}]),/多份 PDF/);
});
test('known translated attachments and read-only libraries cannot become import targets',()=>{
 assert.throws(()=>service({pairs:{'1:SOURCE':'ZH'}}).manual.assertSource(pdf(2,'ZH')),/已配对的译文/);
 assert.throws(()=>service({library:{editable:true,filesEditable:false}}).manual.assertSource(pdf(1,'SOURCE')),/权限/);
});
test('same-source double clicks share one operation and different sources serialize',async()=>{
 const {manual}=service();let calls=0,active=0,max=0;
 const work=async()=>{calls++;active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,10));active--;return{cancelled:true};};
 const a=manual.once(pdf(1,'A'),work),b=manual.once(pdf(1,'A'),work),c=manual.once(pdf(2,'B'),work);
 assert.equal(a,b);await Promise.all([a,b,c]);assert.equal(calls,2);assert.equal(max,1);assert.equal(manual.pending.size,0);
});
test('picker cancellation performs no import and releases the operation lock',async()=>{
 const {manual}=service();let imported=false;manual.pickFile=async()=>null;manual._importFile=async()=>{imported=true;};
 assert.equal((await manual.choose(pdf(1,'SOURCE'),{})).cancelled,true);assert.equal(imported,false);assert.equal(manual.pending.size,0);
});
