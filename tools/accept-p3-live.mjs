/* Run only against the dedicated browser profile; never substitute local mocks. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { TaskQueue } from '../worker/src/queue.mjs';
import { DoubaoProvider } from '../worker/src/doubao.mjs';
import { validatePdf } from '../worker/src/pdf.mjs';
import { assertWritableTarget } from './lib/path-guard.mjs';
import { chromium } from 'playwright';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtime=path.join(root,'runtime'),fixture=path.join(root,'fixtures/public');
const directory=assertWritableTarget(path.join(runtime,'p3-live-'+crypto.randomUUID()),runtime);
const profile=path.join(runtime,'browser-profile');
const interactive=process.argv.includes('--login');
const context=await chromium.launchPersistentContext(profile,{channel:'chrome',headless:!interactive,acceptDownloads:true,viewport:{width:1500,height:950}});
if(interactive){
 const page=await context.newPage();await page.goto('https://www.doubao.com/chat/');
 const nonce=crypto.randomUUID();fs.writeFileSync(path.join(runtime,'p3-login-session.json'),JSON.stringify({nonce}));
 console.log('专用登录窗口已打开，请登录后保持窗口打开，等待确认。');
 const end=Date.now()+10*60*1000;
 while(Date.now()<end){
  const file=path.join(runtime,'p3-login-confirm.json');
  if(fs.existsSync(file)&&JSON.parse(fs.readFileSync(file,'utf8')).nonce===nonce)break;
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 if(Date.now()>=end){await context.close();throw new Error('Login confirmation timed out');}
}
const queue=new TaskQueue({directory,inputRoots:[fixture],provider:new DoubaoProvider({profile,sharedContext:context}),
 validate:(file,options)=>validatePdf(file,{...options,python:process.env.DOUBAO_PYTHON||'D:/anaconda3/python.exe'})});
const report={kind:'real-doubao-acceptance',startedAt:new Date().toISOString(),expectedTasks:3,expectedPages:19,tasks:[],passed:false};
try{
 for(let i=0;i<3;i++){
  const start=Date.now();const {job}=queue.submit({source:path.join(fixture,'doubao-19p/world-action-models.original.pdf'),independent:true});
  await queue.drain();report.tasks.push({...queue.publicJob(queue.find(job.id)),elapsedMs:Date.now()-start});
  if(report.tasks.at(-1).state!=='succeeded')break;
 }
 const successes=report.tasks.filter(j=>j.state==='succeeded'&&j.result.pages===19&&j.result.checkedPages===19);
 report.realDownloads=successes.length;
 report.independentConversations=new Set(successes.map(j=>j.result.conversationHash).filter(Boolean)).size;
 report.passed=report.realDownloads===3&&report.independentConversations===3;
 report.finishedAt=new Date().toISOString();
 fs.writeFileSync(path.join(directory,'acceptance.json'),JSON.stringify(report,null,2));
 fs.writeFileSync(path.join(runtime,'p3-live-latest.json'),JSON.stringify({directory,report},null,2));
 console.log(JSON.stringify({passed:report.passed,realDownloads:report.realDownloads,independentConversations:report.independentConversations,
  tasks:report.tasks.map(j=>({id:j.id,state:j.state,error:j.error?.code||null,pages:j.result?.pages||null,elapsedMs:j.elapsedMs}))},null,2));
 if(!report.passed)process.exitCode=2;
}finally{await queue.close();await context.close();}
