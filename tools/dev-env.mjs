import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { assertWritableTarget, rejectLinks } from './lib/path-guard.mjs';
import { auditProtectedFiles, assessHistoricalAudit } from './lib/protected-audit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = path.join(root, 'runtime');
const marker = path.join(runtime, 'environment.local.json');
const projectId = 'zotero-doubao-translate-dev-v1';
const zotero = 'D:\\D_Applications\\Zotero\\zotero.exe';
const formalProfile = path.join(process.env.APPDATA, 'Zotero', 'Zotero', 'Profiles', 'jza7s4xb.default');
// User accepted pre-existing prefs drift on 2026-11-02; see docs/ISOLATION_DECISIONS.md.
const acceptedHistoricalConfig = path.join(formalProfile,'prefs.js');
const protectedPaths = ['D:\\Zoterodata', path.dirname(zotero), formalProfile];
const prefValues = {
  'extensions.zotero.useDataDir': true,
  'extensions.zotero.dataDir': path.join(runtime, 'zotero-data'),
  'extensions.zotero.sync.autoSync': false,
  'extensions.zotero.sync.storage.enabled': false,
  'extensions.zotero.sync.storage.groups.enabled': false,
  'extensions.zotero.sync.fulltext.enabled': false,
  'extensions.zotero.httpServer.enabled': false,
  'extensions.zotero.httpServer.localAPI.enabled': false,
  'extensions.zoteroWinWordIntegration.skipInstallation': true,
  'extensions.zoteroOpenOfficeIntegration.skipInstallation': true,
  'app.update.auto': false,
  'browser.shell.checkDefaultBrowser': false,
  'extensions.startupScanScopes': 15,
  'extensions.autoDisableScopes': 0,
  'extensions.logging.enabled': true,
  'extensions.update.enabled': false,
  'browser.dom.window.dump.enabled': true,
  'devtools.console.stdout.chrome': true,
  'devtools.debugger.log': true,
  'devtools.debugger.remote-enabled': true,
  'devtools.chrome.enabled': true,
  'devtools.debugger.force-local': true,
  'devtools.debugger.prompt-connection': false,
  'extensions.doubaoDev.root': runtime,
  'extensions.doubaoDev.expectedProfile': path.join(runtime, 'zotero-profile'),
  'extensions.doubaoDev.expectedData': path.join(runtime, 'zotero-data'),
};
const watchedFiles = [
  zotero, path.join(path.dirname(zotero), 'app', 'application.ini'),
  path.join(path.dirname(zotero), 'app', 'omni.ja'),
  path.join(formalProfile, 'prefs.js'),
  path.join(process.env.APPDATA, 'Zotero', 'Zotero', 'profiles.ini'),
  path.join(process.env.APPDATA, 'Microsoft', 'Word', 'STARTUP', 'Zotero.dotm'),
];
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const writeJSON = (p, value) => fs.writeFileSync(assertWritableTarget(p, root, protectedPaths), JSON.stringify(value, null, 2) + '\n');
const readJSON = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const normalize = p => path.resolve(p).toLowerCase();

function getProcesses() {
  const script = "@(Get-CimInstance Win32_Process -Filter \"Name='zotero.exe'\" | Select-Object ProcessId,ExecutablePath,CommandLine) | ConvertTo-Json -Compress";
  const result = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true }).trim();
  if (!result) return [];
  const parsed = JSON.parse(result);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function config(checkPrefs = true) {
  if (!fs.existsSync(marker)) throw new Error('Run dev:prepare before using this environment.');
  rejectLinks(marker);
  const value = readJSON(marker);
  if (value.projectId !== projectId || normalize(value.root) !== normalize(root)) throw new Error('Environment ownership mismatch.');
  if (normalize(value.zotero) !== normalize(zotero) || !fs.existsSync(zotero)) throw new Error('Unexpected or missing Zotero program.');
  for (const p of [runtime, value.profile, value.data, value.browser]) assertWritableTarget(p, root, protectedPaths);
  if (normalize(value.profile) === normalize(value.data)) throw new Error('Profile and data must be distinct.');
  const expected = Object.entries(prefValues).map(([key, val]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(val)});`).join('\n') + '\n';
  rejectLinks(path.join(value.profile, 'user.js'));
  if (checkPrefs && fs.readFileSync(path.join(value.profile, 'user.js'), 'utf8') !== expected) throw new Error('Safety preferences changed; inspect before launching.');
  return value;
}

function refresh() {
  const c = config(false);
  if (getProcesses().some(p => p.CommandLine?.toLowerCase().includes(c.profile.toLowerCase()))) throw new Error('Close test instance before updating preferences.');
  const prefs = Object.entries(prefValues).map(([key, val]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(val)});`).join('\n') + '\n';
  fs.writeFileSync(assertWritableTarget(path.join(c.profile, 'user.js'), root, protectedPaths), prefs);
  return { refreshedTestPreferences: true };
}

function findTestParent(processes, c) {
  const matches = processes.filter(p => p.ExecutablePath && normalize(p.ExecutablePath) === normalize(c.zotero) && !p.CommandLine?.includes('-contentproc') &&
    p.CommandLine?.toLowerCase().includes(c.profile.toLowerCase()) &&
    p.CommandLine?.toLowerCase().includes(c.data.toLowerCase()));
  if (matches.length > 1) throw new Error('More than one matching test parent; refuse ambiguous process identity.');
  return matches[0];
}

function prepare() {
  rejectLinks(root);
  if (!fs.existsSync(path.join(root, '.git'))) throw new Error('Initialize Git first.');
  if (fs.existsSync(marker)) return config();
  const value = {
    projectId, root, zotero, protectedPaths,
    profile: path.join(runtime, 'zotero-profile'), data: path.join(runtime, 'zotero-data'),
    browser: path.join(runtime, 'browser-profile'),
    createdAt: new Date().toISOString(),
  };
  for (const p of [runtime, value.profile, value.data, value.browser, path.join(runtime, 'logs'), path.join(runtime, 'jobs'), path.join(runtime, 'backups')]) {
    assertWritableTarget(p, root, protectedPaths);
    if (fs.existsSync(p) && [value.profile, value.data, value.browser].includes(p) && fs.readdirSync(p).length) throw new Error(`Expected an empty directory: ${p}`);
    fs.mkdirSync(p, { recursive: true });
  }
  const prefs = Object.entries(prefValues).map(([key, val]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(val)});`).join('\n') + '\n';
  fs.writeFileSync(path.join(value.profile, 'user.js'), prefs, { flag: 'wx' });
  writeJSON(marker, value);
  return value;
}

function start() {
  const c = config();
  const initialBaselinePath = path.join(runtime,'protected-baseline.json');
  if (fs.existsSync(initialBaselinePath)) {
    const audit = assessHistoricalAudit(auditProtectedFiles(readJSON(initialBaselinePath).files),acceptedHistoricalConfig);
    if (!audit.passed) throw new Error(`Unaccepted protected baseline drift in ${audit.blockingDrift.length} file(s); no test process started.`);
  }
  const before = getProcesses();
  if (before.some(p => (p.CommandLine || '').toLowerCase().includes(c.profile.toLowerCase()))) throw new Error('Test instance already running.');
  const portOwner = execFileSync('powershell.exe', ['-NoProfile', '-Command', "Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -eq 61357 } | Select-Object -ExpandProperty OwningProcess"], { encoding: 'utf8', windowsHide: true }).trim();
  if (portOwner) throw new Error('Development debugger port 61357 is occupied; refuse to attach to another process.');
  const runId = crypto.randomUUID();
  const report = path.join(runtime, 'probe-report.json');
  // Stale reports stay in their run-specific files and cannot satisfy this run.
  writeJSON(path.join(runtime, 'probe-request.json'), { runId, action: 'observe', createdAt: new Date().toISOString() });
  const watched = watchedFiles.map(p => ({ path: p, exists: fs.existsSync(p), sha256: fs.existsSync(p) ? hash(p) : null }));
  const baselinePath = path.join(runtime, 'protected-baseline.json');
  if (!fs.existsSync(baselinePath)) {
    const earlier = path.join(runtime, 'protected-before.json');
    writeJSON(baselinePath, fs.existsSync(earlier) ? readJSON(earlier) : { runId, processes: before, files: watched });
  }
  writeJSON(path.join(runtime, 'protected-before.json'), { runId, processes: before, files: watched });
  const logPath = path.join(runtime, 'logs', `${runId}.log`);
  const log = fs.openSync(logPath, 'wx');
  const args = ['-no-remote', '-profile', c.profile, '-datadir', c.data, '-ZoteroDebugText', '-start-debugger-server', '61357'];
  // This is an interactive UI test app, not a hidden helper console.
  const child = spawn(c.zotero, args, { detached: true, stdio: ['ignore', log, log], windowsHide: false });
  fs.closeSync(log);
  child.unref();
  if (!child.pid) throw new Error('Zotero failed to launch.');
  const launch = { runId, launcherPid: child.pid, args, logPath, report, startedAt: new Date().toISOString() };
  writeJSON(path.join(runtime, 'launch.json'), launch);
  return launch;
}

function verify() {
  const c = config();
  const launch = readJSON(path.join(runtime, 'launch.json'));
  const probe = readJSON(path.join(runtime, 'probe-report.json'));
  if (probe.runId !== launch.runId || probe.projectId !== projectId) throw new Error('Stale or unrelated probe.');
  if (normalize(probe.profile) !== normalize(c.profile) || normalize(probe.data) !== normalize(c.data)) throw new Error('Actual profile/data do not match.');
  const before = readJSON(path.join(runtime, 'protected-before.json'));
  const processes = getProcesses();
  const parent = findTestParent(processes, c);
  if (!parent || !parent.CommandLine?.includes(c.profile) || !parent.CommandLine?.includes(c.data)) throw new Error('Test parent process identity mismatch.');
  if (Number(probe.pid) !== parent.ProcessId) throw new Error('Probe PID does not match actual test process.');
  const preservedProcesses = before.processes.filter(p => !p.CommandLine?.includes('-contentproc')).map(p => ({ pid: p.ProcessId, alive: processes.some(q => q.ProcessId === p.ProcessId) }));
  const baseline = readJSON(path.join(runtime, 'protected-baseline.json'));
  const initialBaselineFiles = auditProtectedFiles(baseline.files);
  const initialBaselineAudit = assessHistoricalAudit(initialBaselineFiles,acceptedHistoricalConfig);
  const files = auditProtectedFiles(before.files);
  const checks = {
    actualProfile: true, actualData: true, parentProcess: true,
    noAccount: probe.userID == null || probe.userID === false || probe.userID === 0,
    syncOff: probe.syncAuto === false && probe.storageSync === false && probe.groupSync === false,
    connectorOff: probe.httpServer === false,
    wordInstallSkipped: probe.wordSkip === true && probe.libreOfficeSkip === true,
    productionProcessesPreserved: preservedProcesses.every(p => p.alive),
    protectedFilesUnchanged: files.every(p => p.unchanged),
    initialBaselinePolicy: initialBaselineAudit.passed,
    nativeDatabaseCreated: fs.existsSync(path.join(c.data, 'zotero.sqlite')),
    screenshot: probe.screenshot?.ok === true,
  };
  if (c.libraryStage === 'p1-fixture') checks.testLibraryRegistered = true;
  else checks.emptyLibrary = probe.itemCount === 0;
  const result = { runId: launch.runId, verifiedAt: new Date().toISOString(), passed: Object.values(checks).every(Boolean), checks, preservedProcesses, files, initialBaselineFiles, initialBaselineAudit, comparisonScope:'files compare against this run start; initial baseline retained separately', probe };
  writeJSON(path.join(runtime, 'verification.json'), result);
  if (!result.passed) throw new Error(`Isolation verification failed: ${JSON.stringify(checks)}`);
  return { runId: result.runId, passed: result.passed, checks };
}

function beginP1() {
  const c = config();
  if (findTestParent(getProcesses(), c)) throw new Error('Close test instance before registering the P1 fixture library.');
  c.libraryStage = 'p1-fixture';
  writeJSON(marker, c);
  return { libraryStage: c.libraryStage, note: 'The same owned test library may now contain public fixtures and test annotations.' };
}

function stop() {
  const c = config();
  const launch = readJSON(path.join(runtime, 'launch.json'));
  const parent = findTestParent(getProcesses(), c);
  if (!parent) return { alreadyStopped: true };
  if (!parent.CommandLine?.includes(c.profile) || !parent.CommandLine?.includes(c.data)) throw new Error('Refuse to stop an unverified process.');
  const reportPath = path.join(runtime, 'probe-report.json');
  const probe = fs.existsSync(reportPath) ? readJSON(reportPath) : null;
  if (probe?.runId !== launch.runId || Number(probe.pid) !== parent.ProcessId) {
    const pid = Number(parent.ProcessId);
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid test process id.');
    const result = execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${pid} -ErrorAction Stop).CloseMainWindow()`], { encoding: 'utf8', windowsHide: true }).trim();
    if (result !== 'True') throw new Error('Test window did not accept graceful close; no force-kill attempted.');
    return { requestedWindowClose: pid, reason: 'probe unavailable' };
  }
  writeJSON(path.join(runtime, 'probe-request.json'), { runId: launch.runId, action: 'quit' });
  return { requestedGracefulShutdown: parent.ProcessId };
}

function snapshot() {
  const c = config();
  if (getProcesses().some(p => p.CommandLine?.toLowerCase().includes(c.profile.toLowerCase()))) throw new Error('Close the test instance before taking a snapshot.');
  const id = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = assertWritableTarget(path.join(runtime, 'backups', id), root, protectedPaths);
  fs.mkdirSync(destination);
  for (const [name, source] of [['profile', c.profile], ['data', c.data]]) {
    rejectLinks(source);
    fs.cpSync(source, path.join(destination, name), { recursive: true, errorOnExist: true, force: false, filter: p => { rejectLinks(p); return true; } });
  }
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile()) files.push({ path: path.relative(destination, p), bytes: fs.statSync(p).size, sha256: hash(p) });
      else throw new Error(`Unexpected snapshot entry: ${p}`);
    }
  }
  walk(destination);
  for (const file of files) {
    const [kind, ...parts] = file.path.split(path.sep);
    const original = path.join(kind === 'profile' ? c.profile : c.data, ...parts);
    if (hash(original) !== file.sha256) throw new Error(`Snapshot mismatch: ${file.path}`);
  }
  writeJSON(path.join(destination, 'snapshot-manifest.json'), { id, files });
  return { destination, filesVerified: files.length };
}

function protectedAudit() {
  config();
  const baseline=readJSON(path.join(runtime,'protected-baseline.json'));
  const files=auditProtectedFiles(baseline.files);
  const policy=assessHistoricalAudit(files,acceptedHistoricalConfig);
  const result={observedAt:new Date().toISOString(),...policy,initialBaselineUnchanged:files.every(file=>file.unchanged),files,decision:'2026-11-02 user accepted historical prefs.js drift; cause not verified; in-run comparisons remain strict'};
  writeJSON(path.join(runtime,'protected-audit.json'),result);
  if(!result.passed)process.exitCode=1;
  return result;
}

const commands = { 'protected-audit': protectedAudit, prepare, refresh, 'begin-p1': beginP1, check: () => ({ ...config(), processes: getProcesses() }), start, verify, stop, snapshot };
const command = process.argv[2];
try {
  if (!commands[command]) throw new Error('Use prepare, refresh, check, start, verify, stop, or snapshot.');
  console.log(JSON.stringify(commands[command](), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
