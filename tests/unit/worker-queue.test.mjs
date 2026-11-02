import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TaskQueue } from '../../worker/src/queue.mjs';
import { sha256 } from '../../worker/src/pdf.mjs';
import { TaskError, publicError } from '../../worker/src/errors.mjs';

function fixture(t, provider, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doubao-worker-'));
  fs.mkdirSync(path.join(root,'inputs')); const source = path.join(root,'inputs/source.pdf');
  fs.writeFileSync(source, '%PDF-source');
  const validate = async (file, { expectedPages, signal } = {}) => {
    signal?.throwIfAborted(); const data = fs.readFileSync(file,'utf8');
    if (!data.startsWith('%PDF-')) throw new TaskError('PDF_INVALID');
    const pages = data.includes('wrong-pages') ? 2 : 19;
    if (expectedPages && expectedPages !== pages) throw new TaskError('PAGE_COUNT');
    return { valid:true, pages, checkedPages:pages, sha256:sha256(file), bytes:data.length };
  };
  const settings = { directory:path.join(root,'queue'), inputRoots:[path.join(root,'inputs')], provider, validate, ...options };
  const queue = new TaskQueue(settings);
  t.after(async()=>{ await queue.close(); fs.rmSync(root,{recursive:true,force:true}); });
  return {root,source,queue,settings};
}
const success = { run:async ({output,phase}) => { phase('uploading'); phase('downloading'); fs.writeFileSync(output,'%PDF-translated'); } };
test('serial tasks use immutable input copies; duplicate submits share one task', async t=>{
  let active=0,maximum=0;
  const f=fixture(t,{run:async task=>{active++;maximum=Math.max(maximum,active); await new Promise(r=>setTimeout(r,10)); await success.run(task);active--;}});
  const one=f.queue.submit({source:f.source}); const duplicate=f.queue.submit({source:f.source});
  assert.equal(duplicate.job.id,one.job.id); assert.equal(duplicate.deduplicated,true);
  fs.writeFileSync(f.source,'%PDF-new-source'); f.queue.submit({source:f.source});
  await Promise.all([f.queue.drain(),f.queue.drain()]);
  assert.equal(maximum,1);assert.deepEqual(f.queue.list().map(j=>j.state),['succeeded','succeeded']);
  assert.equal(fs.readdirSync(path.join(f.root,'queue/results')).length,2);
});
test('login wait stops the shared queue and explicit retry recovers',async t=>{
  let login=false; const f=fixture(t,{run:async task=>{if(!login)throw new TaskError('LOGIN_REQUIRED');await success.run(task);}});
  const first=f.queue.submit({source:f.source}).job;f.queue.submit({source:f.source,independent:true});
  await f.queue.drain(); assert.deepEqual(f.queue.list().map(j=>j.state),['waiting_login','queued']);
  await f.queue.drain(); assert.deepEqual(f.queue.list().map(j=>j.state),['waiting_login','queued']);
  login=true;f.queue.retry(first.id);await f.queue.drain();assert.ok(f.queue.list().every(j=>j.state==='succeeded'));
});
for(const reason of ['cancel','timeout'])test(reason+' stops active work and removes partial output',async t=>{
  let started;const ready=new Promise(r=>started=r);
  const f=fixture(t,{run:async({signal,output})=>{fs.writeFileSync(output,'%PDF-partial');started();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}},{timeoutMs:reason==='timeout'?30:10000});
  const job=f.queue.submit({source:f.source}).job;const running=f.queue.drain();await ready;if(reason==='cancel')f.queue.cancel(job.id);await running;
  const result=f.queue.list()[0];assert.equal(result.state,reason==='cancel'?'cancelled':'failed');
  assert.equal(result.error.code,reason==='cancel'?'CANCELLED':'TIMEOUT');assert.equal(result.result,null);
  assert.equal(fs.readdirSync(path.join(f.root,'queue/pending')).length,0);assert.equal(fs.readdirSync(path.join(f.root,'queue/results')).length,0);
});
test('restart interrupts active tasks and never silently repeats a browser upload',async t=>{
  const f=fixture(t,success);const job=f.queue.submit({source:f.source}).job;
  f.queue.transition(f.queue.find(job.id),'translating');await f.queue.close();
  const reopened=new TaskQueue(f.settings);try{assert.equal(reopened.list()[0].state,'interrupted');await reopened.drain();assert.equal(reopened.list()[0].attempt,0);reopened.retry(job.id);await reopened.drain();assert.equal(reopened.list()[0].state,'succeeded');}finally{await reopened.close();}
});
test('two processes cannot concurrently own one task store',async t=>{
  const f=fixture(t,success);assert.throws(()=>new TaskQueue(f.settings),{code:'WORKER_BUSY'});
});
for(const [content,code] of [['<html>failure</html>','PDF_INVALID'],['%PDF-wrong-pages','PAGE_COUNT'],['%PDF-source','SOURCE_UNCHANGED']])test('rejects '+code+' without exposing a final PDF',async t=>{
  const f=fixture(t,{run:async({output})=>fs.writeFileSync(output,content)});f.queue.submit({source:f.source});await f.queue.drain();
  assert.equal(f.queue.list()[0].error.code,code);assert.equal(f.queue.list()[0].result,null);assert.equal(fs.readdirSync(path.join(f.root,'queue/results')).length,0);
});
test('network errors are classified without leaking URLs or credentials',async t=>{
  const f=fixture(t,{run:async()=>{throw new Error('net::ERR_CONNECTION_RESET https://private/?token=SECRET Cookie: SECRET');}});
  f.queue.submit({source:f.source});await f.queue.drain();assert.equal(f.queue.list()[0].error.code,'NETWORK_ERROR');
  assert.doesNotMatch(fs.readFileSync(path.join(f.root,'queue/tasks.json'),'utf8'),/SECRET|Cookie|private/);
  assert.equal(publicError(new Error('arbitrary secret')).code,'INTERNAL_ERROR');
  assert.equal(publicError(new Error('Lock file can not be created: 拒绝访问。 secret')).code,'PROFILE_ACCESS');
  assert.equal(publicError(new Error('ProcessSingleton busy secret')).code,'PROFILE_BUSY');
});
test('queued cancel never invokes provider and invalid phases fail closed',async t=>{
  let calls=0;const f=fixture(t,{run:async({phase})=>{calls++;phase('downloading');phase('uploading');}});
  const job=f.queue.submit({source:f.source}).job;f.queue.cancel(job.id);await f.queue.drain();assert.equal(calls,0);
  f.queue.retry(job.id);await f.queue.drain();assert.equal(f.queue.list()[0].state,'failed');
});
test('missing completed files cannot be returned as a successful duplicate',async t=>{
 const f=fixture(t,success);f.queue.submit({source:f.source});await f.queue.drain();
 const job=f.queue.list()[0];fs.unlinkSync(path.join(f.root,'queue',job.result.file));
 const duplicate=f.queue.submit({source:f.source});assert.equal(duplicate.deduplicated,true);
 assert.equal(duplicate.job.state,'failed');assert.equal(duplicate.job.error.code,'DOWNLOAD_FAILED');
 assert.equal(duplicate.job.result,null);
});
