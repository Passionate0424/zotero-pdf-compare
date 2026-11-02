/* Local provider contract test. NOT a Doubao acceptance download. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { TaskQueue } from '../../worker/src/queue.mjs';
import { DoubaoProvider } from '../../worker/src/doubao.mjs';
import { validatePdf } from '../../worker/src/pdf.mjs';
import { assertWritableTarget } from '../../tools/lib/path-guard.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const runtime=path.join(root,'runtime');
const directory=assertWritableTarget(path.join(runtime,'p3-contract-'+crypto.randomUUID()),runtime);
fs.mkdirSync(directory,{recursive:true});
const fixture=path.join(root,'fixtures/public/doubao-19p');
const original=path.join(fixture,'world-action-models.original.pdf');
const translated=fs.readdirSync(fixture).find(name=>name.endsWith('.pdf')&&!name.includes('original'));
if(!translated)throw new Error('Translation fixture missing');
let uploads=0,downloads=0;
const html=variant=>`<!doctype html><meta charset="utf-8">
<div contenteditable="true"></div>${variant==='login'?'<span>登录</span>':''}
<input type="file"><div id="attachment" data-testid="attachment_file_item" data-available="true"></div><button data-testid="chat_input_send_button">发送</button>
<script>
const input=document.querySelector('input'),attachment=document.querySelector('#attachment');let filename='';
input.onchange=()=>{filename=input.files[0].name;attachment.innerHTML='';const el=document.createElement('div');el.dataset.testid='message_nested_content_file_name';el.textContent=filename;attachment.append(el);fetch('/upload-observed');};
document.querySelector('button').onclick=()=>{history.pushState(null,'','/chat/server-'+Date.now());attachment.innerHTML='';const sent=document.createElement('div');sent.textContent=filename;attachment.append(sent);sent.onclick=()=>{const b=document.createElement('button');b.textContent='${variant==='drift'?'全新入口':'开始翻译'}';document.body.append(b);b.onclick=()=>{b.textContent='关闭翻译';${variant==='stall'?'':`const d=document.createElement('button');d.textContent='下载';document.body.append(d);d.onclick=()=>{const m=document.createElement('button');m.setAttribute('role','menuitem');m.textContent='下载翻译版';document.body.append(m);m.onclick=()=>{const a=document.createElement('a');a.href='/translated.pdf';a.download='translation.pdf';a.click();};};`}};};};
</script>`;
const server=http.createServer((req,res)=>{
  if(req.url==='/translated.pdf'){downloads++;res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="translation.pdf"'});fs.createReadStream(path.join(fixture,translated)).pipe(res);}
  else if(req.url==='/upload-observed'){uploads++;res.end('ok');}
  else{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html(req.url.includes('login')?'login':req.url.includes('drift')?'drift':req.url.includes('stall')?'stall':'success'));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const results=[];
let queue;
try{
 const validate=(file,options)=>validatePdf(file,{...options,python:'D:/anaconda3/python.exe'});
 const sourceReport=await validate(original),translationReport=await validate(path.join(fixture,translated),{expectedPages:19});
 assert.equal(sourceReport.pages,19);assert.equal(translationReport.checkedPages,19);
 const invalid=path.join(directory,'invalid.pdf');fs.writeFileSync(invalid,'<html>not pdf</html>');
 await assert.rejects(validate(invalid),{code:'PDF_INVALID'});
 await assert.rejects(validate(path.join(runtime,'p2-mismatch-two-pages.pdf'),{expectedPages:19}),{code:'PAGE_COUNT'});
 for(const [variant,expected] of [['success','succeeded'],['login','waiting_login'],['drift','failed'],['stall','failed'],['offline','failed'],['cancel','cancelled']]){
  const provider=new DoubaoProvider({profile:path.join(directory,'profile-'+variant),entry:origin+'/'+variant,
    stepTimeoutMs:3000,translationTimeoutMs:variant==='success'?30000:1200,
    ...(variant==='offline'?{launch:async(p,options)=>{const c=await chromium.launchPersistentContext(p,options);await c.setOffline(true);return c;}}:{})});
  if(variant==='cancel'){
   const run=provider.run.bind(provider);
   provider.run=task=>run({...task,phase:state=>{task.phase(state);if(state==='translating')queue.cancel(queue.current.job.id);}});
  }
  queue=new TaskQueue({directory:path.join(directory,'queue-'+variant),inputRoots:[fixture],provider,validate,timeoutMs:45000});
  const before=uploads;const started=Date.now();queue.submit({source:original});await queue.drain();
  const job=queue.list()[0];assert.equal(job.state,expected,JSON.stringify(job));
  if(variant==='success'){assert.equal(job.result.pages,19);assert.equal(job.result.checkedPages,19);assert.notEqual(job.result.sha256,job.sourceHash);}
  if(variant==='login'){assert.equal(uploads,before);assert.equal(job.error.code,'LOGIN_REQUIRED');}
  if(variant==='drift')assert.equal(job.error.code,'UI_CHANGED');
  if(variant==='stall')assert.equal(job.error.code,'TIMEOUT');
  if(variant==='offline')assert.equal(job.error.code,'NETWORK_ERROR');
  if(variant==='cancel')assert.equal(job.error.code,'CANCELLED');
  assert.equal(fs.readdirSync(path.join(directory,'queue-'+variant,'pending')).length,0);
  results.push({variant,state:job.state,error:job.error?.code||null,elapsedMs:Date.now()-started,pages:job.result?.pages||0,history:job.history});
  await queue.close();queue=null;
 }
 assert.equal(downloads,1);
 const report={passed:true,kind:'local-http-provider-contract-not-doubao',results,downloadEvents:downloads,
  pdfValidation:{original:sourceReport,translation:translationReport},realDoubaoDownloads:0};
 fs.writeFileSync(path.join(runtime,'p3-local-contract.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({passed:true,cases:results.map(r=>({variant:r.variant,state:r.state,error:r.error,pages:r.pages})),downloadEvents:downloads,realDoubaoDownloads:0},null,2));
}finally{
 if(queue)await queue.close();await new Promise(resolve=>server.close(resolve));
 // Never delete runtime as a whole or a computed external browser profile.
 assertWritableTarget(directory,runtime);if(!path.basename(directory).startsWith('p3-contract-'))throw new Error('Cleanup scope');
 fs.rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
