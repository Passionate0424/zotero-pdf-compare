import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function createAddon() {
  const context = vm.createContext({ChromeUtils:{importESModule:()=>({setTimeout})},Promise,Date});
  vm.runInContext(fs.readFileSync(new URL('../../addon/src/main.js',import.meta.url),'utf8'),context);
  return new context.DoubaoTranslateAddon('unit-test');
}
const reader={tabID:'source-tab'};
test('rapid requests apply only the final requested mode',async()=>{
  const addon=createAddon(),applied=[];
  addon.applyMode=async(_,mode)=>applied.push(mode);
  await Promise.all(['compare','translation','original'].map(mode=>addon.setMode(reader,mode)));
  assert.deepEqual(applied,['original']);
  assert.equal(addon.modeQueues.size,0);
  assert.equal(addon.modeRequests.size,0);
});
test('a request during initialization restores to the newest mode in order',async()=>{
  const addon=createAddon(),applied=[];
  let release;
  const ready=new Promise(resolve=>{release=resolve;});
  addon.applyMode=async(_,mode)=>{applied.push(mode);if(mode==='compare')await ready;};
  const comparing=addon.setMode(reader,'compare');
  await Promise.resolve();await Promise.resolve();
  const original=addon.setMode(reader,'original');
  release();await Promise.all([comparing,original]);
  assert.deepEqual(applied,['compare','original']);
});
test('one failed initialization does not poison later mode changes',async()=>{
  const addon=createAddon();
  addon.applyMode=async()=>{throw new Error('test load failed');};
  await assert.rejects(addon.setMode(reader,'compare'),/test load failed/);
  let applied=false;addon.applyMode=async()=>{applied=true;};
  await addon.setMode(reader,'original');assert.equal(applied,true);
});
test('stopping or closing a pane cancels its pending readiness wait',async()=>{
  const addon=createAddon();
  await assert.rejects(addon.waitFor(()=>null,{closed:true}),/初始化已取消/);
  addon.stopped=true;
  await assert.rejects(addon.setMode(reader,'compare'),/插件已停止/);
});
