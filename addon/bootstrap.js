/* SPDX-License-Identifier: AGPL-3.0-only */
var addon;
function install() {}
function uninstall() {}
async function startup({ rootURI, id }) {
  await Zotero.initializationPromise;
  await Zotero.uiReadyPromise;
  const expected = Services.prefs.getStringPref('extensions.doubaoDev.expectedProfile', '');
  const expectedData = Services.prefs.getStringPref('extensions.doubaoDev.expectedData', '');
  if (!expected || Zotero.Profile.dir.toLowerCase() !== expected.toLowerCase() || Zotero.DataDirectory.dir.toLowerCase() !== expectedData.toLowerCase()) {
    Zotero.debug('[Doubao] Development build refused to load outside the registered test environment.');
    return;
  }
  const scope = { Zotero, Services, Components, ChromeUtils, IOUtils, PathUtils };
  Services.scriptloader.loadSubScriptWithOptions(rootURI + 'src/main.js', {target:scope,ignoreCache:true});
  addon = new scope.DoubaoTranslateAddon(id);
  addon.start();
}
function shutdown() {
  addon?.stop();
  addon = null;
}
