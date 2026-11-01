import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {rejectLinks} from './lib/path-guard.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtime=path.join(root,'runtime');
const launch=JSON.parse(fs.readFileSync(path.join(runtime,'launch.json'),'utf8'));
const probe=JSON.parse(fs.readFileSync(path.join(runtime,'probe-report.json'),'utf8'));
if(launch.runId!==probe.runId||path.resolve(probe.profile).toLowerCase()!==path.join(runtime,'zotero-profile').toLowerCase()||path.resolve(probe.data).toLowerCase()!==path.join(runtime,'zotero-data').toLowerCase())throw new Error('Not the registered current test environment');
const marker=path.join(root,'dist','current-dev-build.json');rejectLinks(marker);
const build=JSON.parse(fs.readFileSync(marker,'utf8'));
if(!/^doubao-translate-dev-[a-f0-9]{16}\.xpi$/.test(build.filename))throw new Error('Invalid package name');
const file=path.join(root,'dist',build.filename);rejectLinks(file);
if(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==build.sha256)throw new Error('Package fingerprint mismatch');
const nonce=crypto.randomUUID();
fs.writeFileSync(path.join(runtime,'probe-request.json'),JSON.stringify({runId:launch.runId,action:'install-product',filename:build.filename,nonce}));
const deadline=Date.now()+60000;
while(Date.now()<deadline){
 const reportPath=path.join(runtime,'product-install-report.json');
 if(fs.existsSync(reportPath)){
  const report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
  if(report.nonce===nonce){console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;break;}
 }
 await new Promise(resolve=>setTimeout(resolve,250));
}
if(Date.now()>=deadline)throw new Error('Test package installation timed out');
