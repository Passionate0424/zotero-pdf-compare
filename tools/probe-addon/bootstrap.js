/* Test-only probe. Refuses to observe or handle commands outside expected paths. */
var timer;
var stopped = false;
var timerAPI;

function install() {}
function uninstall() {}
function startup() {
  stopped = false;
  timerAPI = ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs');
  runProbe().catch(error => Zotero.logError(error));
}
function shutdown() {
  stopped = true;
  if (timer) timerAPI.clearInterval(timer);
  timer = null;
  for (const win of Zotero.getMainWindows()) win.document.getElementById('doubao-dev-badge')?.remove();
}

async function runProbe() {
  await Zotero.initializationPromise;
  await Zotero.uiReadyPromise;
  const pref = name => Services.prefs.getStringPref(name, '');
  const expectedProfile = pref('extensions.doubaoDev.expectedProfile');
  const expectedData = pref('extensions.doubaoDev.expectedData');
  const root = pref('extensions.doubaoDev.root');
  const norm = value => String(value).replace(/\//g, '\\').toLowerCase();
  if (!root || !expectedProfile || !expectedData || norm(Zotero.Profile.dir) !== norm(expectedProfile) || norm(Zotero.DataDirectory.dir) !== norm(expectedData)) return;
  const requestPath = PathUtils.join(root, 'probe-request.json');
  const request = await IOUtils.readJSON(requestPath);
  const bool = name => Services.prefs.getBoolPref(name, false);
  const win = Zotero.getMainWindow();
  if (win) win.docShell.browsingContext.isActive = true;
  if (win) win.document.title = '[DEV TEST LIBRARY] Zotero — Doubao plugin development';
  if (win && !win.document.getElementById('doubao-dev-badge')) {
    const badge = win.document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
    badge.id = 'doubao-dev-badge';
    badge.textContent = '开发测试库 · E 盘隔离';
    badge.style.cssText = 'position:fixed;top:5px;right:165px;z-index:2147483647;pointer-events:none;background:#6d28d9;color:#fff;font:12px sans-serif;padding:3px 8px;border-radius:4px;';
    win.document.documentElement.appendChild(badge);
  }
  await new Promise(resolve => timerAPI.setTimeout(resolve, 2500));
  let screenshot;
  try {
    const canvas = win.document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
    canvas.width = win.innerWidth;
    canvas.height = win.innerHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawWindow(win, 0, 0, win.innerWidth, win.innerHeight, 'rgb(255,255,255)');
    const encoded = canvas.toDataURL('image/png').split(',')[1];
    const binary = win.atob(encoded);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const output = PathUtils.join(root, 'initial-window.png');
    await IOUtils.write(output, bytes);
    screenshot = { ok: true, path: output, width: canvas.width, height: canvas.height, dpr: win.devicePixelRatio };
  } catch (error) {
    screenshot = { ok: false, error: String(error) };
  }
  const report = {
    projectId: 'zotero-doubao-translate-dev-v1', runId: request.runId,
    generatedAt: new Date().toISOString(), pid: Services.appinfo.processID,
    version: Zotero.version, buildID: Services.appinfo.appBuildID,
    profile: Zotero.Profile.dir, data: Zotero.DataDirectory.dir,
    userID: Zotero.Users.getCurrentUserID() ?? null,
    syncAuto: bool('extensions.zotero.sync.autoSync'),
    storageSync: bool('extensions.zotero.sync.storage.enabled'),
    groupSync: bool('extensions.zotero.sync.storage.groups.enabled'),
    httpServer: bool('extensions.zotero.httpServer.enabled'),
    wordSkip: bool('extensions.zoteroWinWordIntegration.skipInstallation'),
    libreOfficeSkip: bool('extensions.zoteroOpenOfficeIntegration.skipInstallation'),
    itemCount: await Zotero.DB.valueQueryAsync('SELECT COUNT(*) FROM items'),
    screenshot,
  };
  await IOUtils.writeJSON(PathUtils.join(root, 'probe-report.json'), report);
  timer = timerAPI.setInterval(async () => {
    if (stopped) return;
    try {
      const command = await IOUtils.readJSON(requestPath);
      if (command.runId === request.runId && command.action === 'run-suite' && command.suite === 'p1-reader' && !globalThis.__doubaoSuiteBusy) {
        globalThis.__doubaoSuiteBusy = true;
        try {
          const projectRoot = PathUtils.parent(root);
          const suiteFile = Zotero.File.pathToFile(PathUtils.join(projectRoot, 'tests', 'integration', 'p1-reader.js'));
          const scope = { Zotero, Services, Components, ChromeUtils, IOUtils, PathUtils };
          Services.scriptloader.loadSubScriptWithOptions(Services.io.newFileURI(suiteFile).spec, {target:scope,ignoreCache:true});
          const controller = new win.AbortController();
          let deadline;
          const work = scope.runP1({ root: projectRoot, runtime: root, action: command.scenario || 'inspect', timers: timerAPI, nonce: command.nonce, signal:controller.signal });
          let result;
          try {
            result = await Promise.race([work,new Promise((_,reject) => { deadline=timerAPI.setTimeout(() => {controller.abort();reject(new Error('P1 suite exceeded its deadline'));},80000); })]);
          } finally { timerAPI.clearTimeout(deadline); }
          await IOUtils.writeJSON(PathUtils.join(root, 'p1-report.json'), { ...result, nonce: command.nonce, generatedAt: new Date().toISOString() });
        } catch (error) {
          await IOUtils.writeJSON(PathUtils.join(root, 'p1-report.json'), { passed: false, nonce: command.nonce, error: String(error), stack: error.stack });
        } finally {
          await IOUtils.writeJSON(requestPath, { runId: request.runId, action: 'observe' });
          globalThis.__doubaoSuiteBusy = false;
        }
      }
      if (command.runId === request.runId && command.action === 'quit') {
        stopped = true;
        timerAPI.clearInterval(timer);
        Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
      }
    } catch (error) { Zotero.logError(error); }
  }, 500);
}
