import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({});vm.runInContext(fs.readFileSync(new URL('../../addon/src/zoom-sync.js',import.meta.url),'utf8'),context);
function setup(){
 const make=()=>{const listeners=new Set();const eventBus={on:(_,fn)=>listeners.add(fn),off:(_,fn)=>listeners.delete(fn)};
  let value=1,writes=0;const pdfViewer={get currentScale(){return Number(value)||.5},get currentScaleValue(){return String(value)},set currentScaleValue(v){value=v;writes++;for(const fn of listeners)fn({scale:Number(v)||.5,presetValue:typeof v==='string'?v:undefined})}};
  return{eventBus,pdfViewer,listeners,get writes(){return writes}}};
 const left=make(),right=make(),regions=[];const scroll={focusLinked:false,alignViewportFrom:side=>regions.push(side)};
 return{left,right,scroll,regions,sync:new context.DoubaoZoomSync({left,right,scroll})};
}
test('numeric zoom follows both directions without echo recursion and aligns the viewing region',()=>{
 const {left,right,scroll,regions,sync}=setup();sync.setEnabled(true);
 left.pdfViewer.currentScaleValue=2;assert.equal(right.pdfViewer.currentScale,2);
 right.pdfViewer.currentScaleValue=3;assert.equal(left.pdfViewer.currentScale,3);
 assert.equal(left.writes,2);assert.equal(right.writes,2);assert.equal(scroll.focusLinked,true);assert.equal(regions.at(-1),'right');
});
test('fit presets follow as presets and enable aligns an already matching scale',()=>{
 const {left,right,regions,sync}=setup();sync.setEnabled(true);assert.equal(regions.length,1);
 left.pdfViewer.currentScaleValue='page-width';assert.equal(right.pdfViewer.currentScaleValue,'page-width');
});
test('disabled zoom stays independent, re-enable follows the selected leader, disposal removes listeners',()=>{
 const {left,right,scroll,sync}=setup();sync.setEnabled(true);sync.setEnabled(false);
 left.pdfViewer.currentScaleValue=2;assert.equal(right.pdfViewer.currentScale,1);assert.equal(scroll.focusLinked,false);
 sync.setEnabled(true,'left');assert.equal(right.pdfViewer.currentScale,2);sync.dispose();
 assert.equal(left.listeners.size+right.listeners.size,0);assert.equal(scroll.focusLinked,false);
 right.pdfViewer.currentScaleValue=4;assert.equal(left.pdfViewer.currentScale,2);
});
