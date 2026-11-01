import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = path.join(root, 'runtime');
const launch = JSON.parse(fs.readFileSync(path.join(runtime, 'launch.json'), 'utf8'));
const probe = JSON.parse(fs.readFileSync(path.join(runtime, 'probe-report.json'), 'utf8'));
if (launch.runId !== probe.runId || path.resolve(probe.data).toLowerCase() !== path.join(runtime, 'zotero-data').toLowerCase()) throw new Error('Not a verified current test environment.');
const nonce = crypto.randomUUID();
fs.writeFileSync(path.join(runtime, 'probe-request.json'), JSON.stringify({ runId: launch.runId, action: 'run-suite', suite: 'p1-reader', scenario: process.argv[2] || 'inspect', nonce }));
const deadline = Date.now() + 90000;
while (Date.now() < deadline) {
  const output = path.join(runtime, 'p1-report.json');
  if (fs.existsSync(output)) {
    const report = JSON.parse(fs.readFileSync(output, 'utf8'));
    if (report.nonce === nonce) {
      report.scenario=process.argv[2]||'inspect';
      const captureName = `p1-${(process.argv[2] || 'inspect').replace(/[^a-zA-Z0-9_-]/g,'_')}-native.png`;
      const captured = report.screenshot?.method === 'gecko-window-global-snapshot' ? report.screenshot : null;
      if (captured) report.visualScreenshot = { ...captured, sha256: crypto.createHash('sha256').update(fs.readFileSync(captured.path)).digest('hex') };
      const archive = path.join(root,'artifacts','p1',nonce);
      fs.mkdirSync(archive,{recursive:true});
      if (captured) fs.copyFileSync(captured.path,path.join(archive,captureName));
      fs.writeFileSync(path.join(archive,'report.json'),JSON.stringify(report,null,2)+'\n');
      fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
      console.log(JSON.stringify(report, null, 2));
      if (report.passed === false) process.exitCode = 1;
      break;
    }
  }
  await new Promise(resolve => setTimeout(resolve, 400));
}
if (Date.now() >= deadline) throw new Error('Integration suite timed out; inspect test logs.');
