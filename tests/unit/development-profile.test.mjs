import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(new URL('../../addon/bootstrap.js',import.meta.url),'utf8');
for(const field of ['profile','data'])test(`development build refuses a mismatched ${field}`,async()=>{
  const expected={profile:'E:/project/test/runtime/zotero-profile',data:'E:/project/test/runtime/zotero-data'};
  let loaded=false;
  const context=vm.createContext({
    Zotero:{initializationPromise:Promise.resolve(),uiReadyPromise:Promise.resolve(),
      Profile:{dir:field==='profile'?'C:/production-profile':expected.profile},
      DataDirectory:{dir:field==='data'?'D:/production-data':expected.data},debug:()=>{}},
    Services:{prefs:{getStringPref:name=>name.endsWith('expectedProfile')?expected.profile:expected.data},
      scriptloader:{loadSubScriptWithOptions:()=>{loaded=true;}}}
  });
  vm.runInContext(code,context);
  await context.startup({rootURI:'file:///test/',id:'guard-test'});
  assert.equal(loaded,false);assert.equal(context.addon,undefined);
});
