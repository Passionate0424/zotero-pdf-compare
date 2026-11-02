import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({});vm.runInContext(fs.readFileSync(new URL('../../addon/src/scroll-sync.js',import.meta.url),'utf8'),context);
const math=context.DoubaoScrollMath;
test('viewing-region mapping preserves both axes across zoom and viewport sizes',()=>{
 const a={pages:[{top:0,left:0,height:1000,width:1000}],scrollTop:300,scrollLeft:400,clientHeight:200,clientWidth:200,scrollHeight:1000,scrollWidth:1000};
 const b={pages:[{top:0,left:0,height:2000,width:2000}],scrollTop:0,scrollLeft:0,clientHeight:400,clientWidth:300,scrollHeight:2000,scrollWidth:2000};
 const anchor=math.focus(a),target=math.focusTarget(anchor,b);assert.equal(target.top,600);assert.equal(target.left,850);assert.equal(target.clamped,false);
 const actual=math.focus({...b,scrollTop:target.top,scrollLeft:target.left});assert.ok(math.distance(anchor,actual)<1e-9);assert.equal(actual.xFraction,anchor.xFraction);
 const clipped=math.focusTarget({...anchor,xFraction:0,fraction:0},b);assert.equal(clipped.clamped,true);assert.equal(clipped.top,0);assert.equal(clipped.left,0);
});
function layout(heights,viewport=200){let top=10;const pages=heights.map(height=>{const page={top,height};top+=height+10;return page;});return{pages,scrollTop:0,clientHeight:viewport,scrollHeight:top};}
test('maps corresponding page positions across different zoom and viewport sizes',()=>{
 const a=layout([1000,800,1200]),b=layout([500,400,600],150);
 for(let index=0;index<3;index++)for(const fraction of [0,0.1,0.4,0.7]){
  a.scrollTop=a.pages[index].top+fraction*a.pages[index].height;
  const anchor=math.anchor(a),target=math.target(anchor,b);b.scrollTop=target.top;
  if(!target.clamped)assert.ok(math.distance(anchor,math.anchor(b))<1e-9);
 }
});
test('reports unavoidable bottom clipping instead of silently misaligning',()=>{
 const b=layout([500],400);const result=math.target({pageIndex:0,fraction:0.9},b);
 assert.equal(result.clamped,true);assert.equal(result.top,b.scrollHeight-b.clientHeight);
});
test('handles margins and missing page geometry without invalid writes',()=>{
 const a=layout([600,600]);const anchor=math.anchor(a);assert.ok(anchor.fraction<0);
 assert.equal(math.target({pageIndex:9,fraction:0},a),null);
 assert.equal(math.anchor({...a,clientHeight:0}),null);
 assert.equal(math.anchor({...a,pages:[]}),null);
});
test('does not silently map two-page or horizontal layouts by vertical offsets',()=>{
 const compatible=context.DoubaoScrollSync.prototype.compatible;
 const a=layout([500,500]);
 assert.equal(compatible.call({metrics:()=>a}),true);
 const spread={...a,pages:[{top:10,height:500},{top:10,height:500}]};
 assert.equal(compatible.call({metrics:side=>side==='left'?a:spread}),false);
 assert.equal(compatible.call({metrics:side=>side==='left'?a:layout([500])}),false);
});
