import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {rejectLinks} from './lib/path-guard.mjs';
import net from 'node:net';
import { execFileSync } from 'node:child_process';

// Local-only Gecko development protocol. Verify listener ownership before any request.
const script = "$c=@(Get-NetTCPConnection -LocalPort 61357 -State Listen -ErrorAction Stop); if($c.Count -ne 1){throw 'Ambiguous listener'}; $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$c[0].OwningProcess); [pscustomobject]@{Address=$c[0].LocalAddress;PID=$p.ProcessId;ExecutablePath=$p.ExecutablePath;CommandLine=$p.CommandLine}|ConvertTo-Json -Compress";
const owner = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true }));
if (!['127.0.0.1', '::1'].includes(owner.Address) || owner.ExecutablePath?.toLowerCase() !== 'd:\\d_applications\\zotero\\zotero.exe' || !owner.CommandLine.includes('E:\\project\\zotero-doubao-translate\\runtime\\zotero-profile') || !owner.CommandLine.includes('E:\\project\\zotero-doubao-translate\\runtime\\zotero-data') || !owner.CommandLine.includes('-datadir')) throw new Error('Not the registered local test debugger.');
const socket = net.connect(61357, owner.Address);
let buffer = Buffer.alloc(0);
const queue = [];
const waiters = [];
socket.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const colon = buffer.indexOf(58);
    if (colon < 0) break;
    const length = Number(buffer.subarray(0, colon).toString());
    if (!Number.isInteger(length) || length < 0 || length > 10_000_000) throw new Error('Invalid RDP frame');
    if (buffer.length < colon + 1 + length) break;
    const packet = JSON.parse(buffer.subarray(colon + 1, colon + 1 + length).toString());
    buffer = buffer.subarray(colon + 1 + length);
    const index = waiters.findIndex(w => w.match(packet));
    if (index >= 0) { const [w] = waiters.splice(index, 1); clearTimeout(w.timer); w.resolve(packet); }
    else queue.push(packet);
  }
});
const receive = match => {
  const index = queue.findIndex(match);
  if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
  return new Promise((resolve, reject) => {
    const w = { match, resolve, timer: null };
    w.timer = setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); reject(new Error('RDP response timed out')); }, 15000);
    waiters.push(w);
  });
};
async function send(packet) {
  const result = receive(p => p.from === packet.to && !['newSource','consoleAPICall','pageError'].includes(p.type));
  const data = Buffer.from(JSON.stringify(packet));
  socket.write(Buffer.concat([Buffer.from(`${data.length}:`), data]));
  return result;
}
try {
  const hello = await receive(p => p.from === 'root');
  console.log('CONNECTED', JSON.stringify({ pid: owner.PID, applicationType: hello.applicationType }));
  const root = await send({ to: 'root', type: 'getRoot' });
  console.log('ROOT', JSON.stringify(root));
  if (['install-probe', 'install-product', 'install-product-xpi'].includes(process.argv[2])) {
    if (!root.addonsActor) throw new Error('No addons actor');
    const rootPath=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
    let addonPath=path.join(rootPath,process.argv[2]==='install-probe'?'tools/probe-addon':'addon');
    if(process.argv[2]==='install-product-xpi'){
      const marker=path.join(rootPath,'dist','current-dev-build.json');rejectLinks(marker);
      const build=JSON.parse(fs.readFileSync(marker,'utf8'));
      if(!/^doubao-translate-dev-[a-f0-9]{16}\.xpi$/.test(build.filename))throw new Error('Invalid build filename');
      addonPath=path.join(rootPath,'dist',build.filename);rejectLinks(addonPath);
      if(crypto.createHash('sha256').update(fs.readFileSync(addonPath)).digest('hex')!==build.sha256)throw new Error('Build hash mismatch');
    }
    const installed = await send({ to: root.addonsActor, type: 'installTemporaryAddon', addonPath });
    console.log('INSTALL', JSON.stringify(installed));
    if (installed.error) throw new Error(installed.message);
  }
} finally { socket.end(); }
