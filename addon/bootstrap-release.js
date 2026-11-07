/* SPDX-License-Identifier: AGPL-3.0-only */
var addon;
function install() {}
function uninstall() {}
async function startup({ rootURI, id }) {
  await Zotero.initializationPromise;
  await Zotero.uiReadyPromise;
  const scope = { Zotero, Services, Components, ChromeUtils, IOUtils, PathUtils };
  for (const file of ['scroll-sync.js','zoom-sync.js','manual-import.js','main.js']) {
    Services.scriptloader.loadSubScriptWithOptions(rootURI + 'src/' + file, {target:scope,ignoreCache:true});
  }
  addon = new scope.DoubaoTranslateAddon(id);
  addon.start();
}
function shutdown() {
  addon?.stop();
  addon = null;
}
