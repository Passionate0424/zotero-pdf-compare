import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const ready = () => new Promise(resolve => {
  const socket = net.connect(61357, '127.0.0.1');
  socket.setTimeout(500);
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => { socket.destroy(); resolve(false); });
  socket.once('timeout', () => { socket.destroy(); resolve(false); });
});

try {
  const started = await execute(process.execPath, [path.join(root, 'tools/dev-env.mjs'), 'start'], { windowsHide: true });
  const launch = JSON.parse(started.stdout);
  const deadline = Date.now() + 45000;
  while (!(await ready())) {
    if (Date.now() > deadline) throw new Error('Test debugger did not become ready; inspect runtime logs.');
    await pause(500);
  }
  // dev-rdp verifies listener address AND owning process before sending a request.
  await execute(process.execPath, [path.join(root, 'tools/dev-rdp.mjs'), 'install-probe'], { windowsHide: true, timeout: 25000 });
  while (true) {
    const reportPath = path.join(root, 'runtime/probe-report.json');
    const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : null;
    if (report?.runId === launch.runId) break;
    if (Date.now() > deadline) throw new Error('No fresh probe report; old reports were not accepted.');
    await pause(500);
  }
  const checked = await execute(process.execPath, [path.join(root, 'tools/dev-env.mjs'), 'verify'], { windowsHide: true });
  console.log(checked.stdout.trim());
} catch (error) {
  console.error(error.stderr || error.message);
  process.exitCode = 1;
}
