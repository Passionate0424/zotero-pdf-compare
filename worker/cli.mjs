/* SPDX-License-Identifier: AGPL-3.0-only */
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { TaskQueue } from './src/queue.mjs';
import { DoubaoProvider } from './src/doubao.mjs';
import { validatePdf } from './src/pdf.mjs';
import { publicError } from './src/errors.mjs';
import { assertWritableTarget } from '../tools/lib/path-guard.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = path.join(root, 'runtime');
const args = process.argv.slice(2), command = args.shift() || 'help';
const python = process.env.DOUBAO_PYTHON || 'D:/anaconda3/python.exe';
const output = value => console.log(JSON.stringify(value));

if (!['run','serve','status','cancel','retry','login'].includes(command)) {
  console.log('worker: run <owned-public.pdf> | status | cancel <id> | retry <id> | serve | login');
  process.exit(0);
}
const profile = assertWritableTarget(path.join(runtime, 'browser-profile'), runtime);
if (command === 'login') {
  // Explicit command only. Overnight acceptance always uses headless run.
  const { chromium } = await import('playwright');
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: false });
    const page = await context.newPage(); await page.goto('https://www.doubao.com/chat/');
    console.log('请在专用窗口登录，完成后关闭该窗口。');
    await new Promise(resolve => context.on('close', resolve));
  } catch(error) { output({protocol:1,ok:false,error:publicError(error)});process.exitCode=1; }
  finally { if(context)await context.close().catch(()=>{}); }
  process.exit(process.exitCode||0);
}
let queue;
try {
  queue = new TaskQueue({ directory: assertWritableTarget(path.join(runtime, 'worker'), runtime),
    inputRoots: [path.join(root, 'fixtures/public'), path.join(runtime, 'worker/inputs')],
    provider: new DoubaoProvider({ profile }),
    validate: (file, options) => validatePdf(file, { ...options, python }) });
  if (command === 'status') output({ protocol: 1, jobs: queue.list() });
  if (command === 'cancel') output({ protocol: 1, job: queue.cancel(args[0]) });
  if (command === 'retry') {
    queue.retry(args[0]); await queue.drain(); const job=queue.publicJob(queue.find(args[0]));
    output({ protocol: 1, job }); if(job.state!=='succeeded')process.exitCode=2;
  }
  if (command === 'run') {
    const { job, deduplicated } = queue.submit({ source: args[0] });
    await queue.drain(); const result = queue.publicJob(queue.find(job.id));
    output({ protocol: 1, deduplicated, job: result });
    if (result.state !== 'succeeded') process.exitCode = 2;
  }
  if (command === 'serve') {
    // Local stdio protocol only; no HTTP listener exposed to arbitrary websites.
    const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    process.once('SIGINT', () => lines.close()); process.once('SIGTERM', () => lines.close());
    for await (const line of lines) {
      let id = null;
      try {
        if (line.length > 65536) throw new Error('Request too large');
        const request = JSON.parse(line); id = typeof request.id === 'string' ? request.id.slice(0,80) : null;
        if (request.protocol !== 1) throw new Error('Protocol mismatch');
        let data;
        if (request.action === 'submit') data = queue.submit({source:request.task?.source,targetLanguage:request.task?.targetLanguage});
        else if (request.action === 'cancel') data = queue.cancel(request.taskId);
        else if (request.action === 'retry') data = queue.retry(request.taskId);
        else if (request.action === 'status') data = queue.list();
        else throw new Error('Unsupported action');
        output({ protocol: 1, id, ok: true, data });
        if(['submit','retry'].includes(request.action))queue.drain().catch(() => output({ protocol: 1, ok: false, error: publicError(null) }));
      } catch (error) { output({ protocol: 1, id, ok: false, error: publicError(error) }); }
    }
  }
} catch (error) { output({ protocol: 1, ok: false, error: publicError(error) }); process.exitCode = 1; }
finally {
  if (queue) await queue.close().catch(error => { output({ protocol: 1, ok: false, error: publicError(error) }); process.exitCode = 1; });
}
