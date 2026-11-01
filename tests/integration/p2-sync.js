/* SPDX-License-Identifier: AGPL-3.0-only */
var runP2=async function(ctx){
 if(Zotero.DataDirectory.dir.toLowerCase()!==PathUtils.join(ctx.runtime,'zotero-data').toLowerCase())throw new Error('Not the owned test database');
 const pause=ms=>new Promise(resolve=>ctx.timers.setTimeout(resolve,ms));
 const wait=async(fn,timeout=20000)=>{const start=Date.now();while(Date.now()-start<timeout){if(ctx.signal.aborted)throw new Error('Aborted');try{const value=fn();if(value)return value;}catch{}await pause(30);}throw new Error('P2 readiness timeout');};
 const fixture=await IOUtils.readJSON(PathUtils.join(ctx.runtime,'p1-fixture.json'));
 const source=Zotero.Items.getByLibraryAndKey(fixture.libraryID,fixture.sourceKey);
 const win=Zotero.getMainWindow(),addon=win.DoubaoTranslate;
 if(!addon)throw new Error('Development product not loaded');
 let reader=await Zotero.Reader.open(source.id);if(!reader)reader=await wait(()=>Zotero.Reader._readers.find(r=>r.itemID===source.id));
 await reader._initPromise;win.docShell.browsingContext.isActive=true;reader._updateDocShellActivity();
 const identity={reader,browser:reader._iframe,internal:reader._internalReader,parent:reader._iframe.parentNode};
 await addon.setMode(reader,'compare');
 const state=addon.states.get(reader.tabID),sync=state.sync;
 if(!sync)throw new Error('Scroll sync module is not loaded');
 state.right.docShellIsActive=true;state.right.browsingContext.isActive=true;
 const preparePaint=async()=>{
  const windows=[win,reader._iframeWindow,state.right.contentWindow,...Object.values(sync.views).map(v=>v.window)];
  const utils=windows.map(w=>Components.utils.unwaiveXrays(w).windowUtils);
  try{for(let i=0;i<20;i++){utils.forEach(u=>u.advanceTimeAndRefresh(17));await pause(10);}}
  finally{utils.forEach(u=>u.restoreNormalRefresh());}
 };
 // Background test windows may defer fit-width layout. Settle before starting
 // measurement, then restore normal refresh for every timed alignment sample.
 await preparePaint();await pause(300);
 if(ctx.action==='geometry')return {passed:true,stage:'debug_geometry',liveMetrics:String(sync.metrics),liveAlign:String(sync.alignFrom),selected:win.Zotero_Tabs.selectedID,sourceTab:reader.tabID,windowState:win.windowState,outer:[win.innerWidth,win.innerHeight],metrics:{left:sync.metrics('left'),right:sync.metrics('right')},bounds:{container:state.container.getBoundingClientRect().toJSON(),source:state.sourceBrowser.getBoundingClientRect().toJSON(),right:state.right.getBoundingClientRect().toJSON(),leftFrame:reader._internalReader._primaryView._iframe.getBoundingClientRect().toJSON(),rightFrame:state.rightInternal._primaryView._iframe.getBoundingClientRect().toJSON()},styles:{container:state.container.getAttribute('style'),right:state.right.getAttribute('style')},rightDOM:state.right.contentDocument.body.innerHTML.slice(0,800),rightWindow:[state.right.contentWindow.innerWidth,state.right.contentWindow.innerHeight],viewerIdentity:{rawClient:sync.views.right.viewer.clientHeight,xrayClient:Components.utils.unwaiveXrays(sync.views.right.viewer).clientHeight,ownClient:String(Object.getOwnPropertyDescriptor(sync.views.right.viewer,'clientHeight')?.get),rawScroll:sync.views.right.viewer.scrollTop,xrayScroll:Components.utils.unwaiveXrays(sync.views.right.viewer).scrollTop,connected:sync.views.right.viewer.isConnected,same:sync.views.right.viewer===state.rightInternal._primaryView._iframeWindow.document.getElementById('viewerContainer'),ownerSame:sync.views.right.viewer.ownerDocument===state.rightInternal._primaryView._iframeWindow.document,inner:[sync.views.right.window.innerWidth,sync.views.right.window.innerHeight],parents:[sync.views.right.viewer,...(function*(el){while(el.parentElement){el=el.parentElement;yield el;}})(sync.views.right.viewer)].map(el=>({id:el.id,tag:el.tagName,rect:el.getBoundingClientRect().toJSON(),position:el.ownerDocument.defaultView.getComputedStyle(el).position,height:el.ownerDocument.defaultView.getComputedStyle(el).height,display:el.ownerDocument.defaultView.getComputedStyle(el).display}))},stats:sync.stats};
 try{await wait(()=>['left','right'].every(side=>{const m=sync.metrics(side);return m.pages.length===19&&m.clientHeight>0&&m.pages[0].height>0;}));}catch(error){return{passed:false,stage:'readiness_diagnostic',error:String(error),metrics:{left:sync.metrics('left'),right:sync.metrics('right')},mode:state.mode,root:state.container.getBoundingClientRect().toJSON(),rightBounds:state.right.getBoundingClientRect().toJSON(),sourceBounds:state.sourceBrowser.getBoundingClientRect().toJSON()};}
 const distance=()=>{const a=sync.anchor('left'),b=sync.anchor('right');return a&&b?Math.abs((a.pageIndex+a.fraction)-(b.pageIndex+b.fraction)):Infinity;};
 const sampleMove=async(side,index,fraction)=>{
  const metrics=sync.metrics(side),viewer=sync.views[side].viewer;
  // Model the input-side intent separately from the measured DOM offset write.
  const inputWindow=sync.views[side].window;
  inputWindow.document.dispatchEvent(new inputWindow.Event('wheel',{bubbles:true}));
  const desired=metrics.pages[index].top+fraction*metrics.pages[index].height;
  const started=Date.now();viewer.scrollTop=desired;
  const anchor=sync.anchor(side),other=side==='left'?'right':'left';
  const targetMetrics=sync.metrics(other),page=targetMetrics.pages[anchor.pageIndex];
  const raw=page.top+anchor.fraction*page.height;
  const target=Math.max(0,Math.min(targetMetrics.scrollHeight-targetMetrics.clientHeight,raw));
  const clipped=Math.abs(target-raw)>0.5;
  try{await wait(()=>Math.abs(sync.views[other].viewer.scrollTop-target)<2,2000);}catch{throw new Error(JSON.stringify({phase:'paired-scroll',side,index,fraction,wanted:target,actual:sync.views[other].viewer.scrollTop,sourceNow:viewer.scrollTop,sourceAtStart:anchor,otherAnchor:sync.anchor(other),pointerSide:sync.pointerSide,enabled:sync.enabled,lastObserved:sync.lastObserved,expected:sync.expected,samples:sync.stats.samples.slice(-5)}));}
  const result={side,index,fraction,clipped,error:distance(),latencyMs:Date.now()-started,source:sync.views[side].viewer.scrollTop,target:sync.views[other].viewer.scrollTop};
  if(clipped)await pause(100);return result;
 };
 if(ctx.action==='alignment'){
  const pages=[];sync.setEnabled(true,'left');
  for(const side of ['left','right'])for(let index=0;index<19;index++)pages.push(await sampleMove(side,index,0.3));
  const latency=[];let seed=7819;
  for(let i=0;i<120;i++){seed=(seed*1664525+1013904223)>>>0;const index=1+(seed%17);const fraction=0.1+((seed>>>8)%700)/1000;latency.push(await sampleMove(i%2?'right':'left',index,fraction));}
  const unclipped=pages.concat(latency).filter(s=>!s.clipped),sorted=latency.map(s=>s.latencyMs).sort((a,b)=>a-b);
  const maximumError=Math.max(...unclipped.map(s=>s.error)),p95=sorted[Math.ceil(sorted.length*.95)-1];
  return{passed:maximumError<=0.02&&p95<=100,stage:'native_sync_alignment_latency',checks:{nineteenPagesBothDirections:pages.length===38,anchorError:maximumError<=0.02,latencyP95:p95<=100},maximumError,p95Ms:p95,sampleCount:latency.length,pages,latency,stats:{applies:sync.stats.applies,suppressed:sync.stats.suppressed,clamped:sync.stats.clamped},measurement:'DOM scrollTop mutation to observed paired scrollTop; normal timers/refresh, no synthetic refresh-driver advancement; not OS input-to-present latency'};
 }
 if(ctx.action==='mismatch'){
  const fixtureFile=PathUtils.join(ctx.runtime,'p2-mismatch-items.json');
  let items=await IOUtils.exists(fixtureFile)?await IOUtils.readJSON(fixtureFile):null;
  if(!items){
   const parent=new Zotero.Item('journalArticle');parent.libraryID=fixture.libraryID;parent.setField('title','[DEV P2] page mismatch fixture');parent.addTag('doubao-dev-fixture');await parent.saveTx();
   const a=await Zotero.Attachments.importFromFile({file:Zotero.File.pathToFile(await source.getFilePathAsync()),parentItemID:parent.id});
   const b=await Zotero.Attachments.importFromFile({file:Zotero.File.pathToFile(PathUtils.join(ctx.runtime,'p2-mismatch-two-pages.pdf')),parentItemID:parent.id});
   items={parent:parent.id,source:a.id,translated:b.id};await IOUtils.writeJSON(fixtureFile,items);
  }
  addon.pair(Zotero.Items.get(items.source),Zotero.Items.get(items.translated));
  const other=await Zotero.Reader.open(items.source);await other._initPromise;await addon.setMode(other,'compare');
  const otherState=addon.states.get(other.tabID);await wait(()=>otherState.sync.metrics('right').pages.length===2);
  otherState.sync.notify();
  const button=other._iframeWindow.document.querySelector('.doubao-sync-button');
  const before=otherState.sync.views.right.viewer.scrollTop;
  otherState.sync.views.left.viewer.scrollTop=1000;await pause(100);
  const checks={pageCountMismatchDetected:!otherState.sync.compatible(),buttonDisabled:button.disabled,explanationVisible:button.textContent==='页数不同',noSilentMapping:otherState.sync.views.right.viewer.scrollTop===before};
  await addon.setMode(other,'original');other.close();await Zotero.Reader.open(source.id);
  return{passed:Object.values(checks).every(Boolean),stage:'real_two_page_mismatch',checks,pageCounts:{source:19,translated:2}};
 }
 if(ctx.action==='layout-interactions'){
  const ratios=[],u=Components.utils.unwaiveXrays(win).windowUtils;
  const divider=state.divider.getBoundingClientRect(),container=state.container.getBoundingClientRect();
  u.sendMouseEvent('mousedown',divider.x+2,divider.y+100,0,1,0);
  for(let n=0;n<12;n++){
   const ratio=.3+n*.035;u.sendMouseEvent('mousemove',container.x+container.width*ratio,divider.y+100,0,0,0);await pause(25);ratios.push(state.ratio);
  }
  u.sendMouseEvent('mouseup',container.x+container.width*.685,divider.y+100,0,1,0);await preparePaint();
  const checks={continuousDividerDrag:Math.max(...ratios)-Math.min(...ratios)>.3,ratioBounded:ratios.every(r=>r>=.2&&r<=.8)};
  const before={width:win.outerWidth,height:win.outerHeight};win.maximize();await preparePaint();await pause(200);
  checks.maximized=win.windowState===win.STATE_MAXIMIZED;
  checks.controlsReachable=[reader._iframeWindow,state.right.contentWindow].every(w=>{const r=w.document.querySelector('.doubao-reading-modes').getBoundingClientRect();return r.width>0&&r.x>=0&&r.right<=w.innerWidth+1;});
  checks.hostPreserved=reader._iframe===identity.browser&&reader._internalReader===identity.internal;
  const snapshot=await win.docShell.browsingContext.currentWindowGlobal.drawSnapshot(null,win.devicePixelRatio,'rgb(255,255,255)',false);
  const canvas=win.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=snapshot.width;canvas.height=snapshot.height;canvas.getContext('2d').drawImage(snapshot,0,0);snapshot.close();
  const binary=win.atob(canvas.toDataURL('image/png').split(',')[1]),file=PathUtils.join(ctx.runtime,'p2-maximized.png');await IOUtils.write(file,Uint8Array.from(binary,c=>c.charCodeAt(0)));
  const screenshot={path:file,width:canvas.width,height:canvas.height,dpr:win.devicePixelRatio,theme:'dark',mode:'compare',method:'gecko-window-global-snapshot'};
  win.restore();win.resizeTo(before.width,before.height);await preparePaint();
  return{passed:Object.values(checks).every(Boolean),stage:'continuous_divider_and_maximized_layout',checks,ratios,screenshot};
 }
 if(ctx.action==='visual'){
  const shots=[];
  const capture=async(name,theme,mode,size)=>{
   const current=addon.states.get(reader.tabID),primary=reader._internalReader._primaryView;
   const windows=[win,reader._iframeWindow,primary._iframeWindow,current?.right.contentWindow,current?.rightInternal?._primaryView?._iframeWindow].filter(Boolean);
   const utils=[...new Set(windows.map(w=>Components.utils.unwaiveXrays(w).windowUtils).filter(Boolean))];
   try{for(let i=0;i<20;i++){for(const u of utils)u.advanceTimeAndRefresh(17);await pause(25);}}finally{for(const u of utils)u.restoreNormalRefresh();}
   const snapshot=await win.docShell.browsingContext.currentWindowGlobal.drawSnapshot(null,win.devicePixelRatio,'rgb(255,255,255)',false);
   const canvas=win.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=snapshot.width;canvas.height=snapshot.height;canvas.getContext('2d').drawImage(snapshot,0,0);snapshot.close();
   const binary=win.atob(canvas.toDataURL('image/png').split(',')[1]),file=PathUtils.join(ctx.runtime,name+'.png');await IOUtils.write(file,Uint8Array.from(binary,c=>c.charCodeAt(0)));
   const toolbar=reader._iframeWindow.document.querySelector('.toolbar');
   shots.push({path:file,width:canvas.width,height:canvas.height,dpr:win.devicePixelRatio,theme,mode,windowSize:size,method:'gecko-window-global-snapshot',toolbarHeight:toolbar.getBoundingClientRect().height,sourceWritable:!reader._isReadOnly(),rightReadOnly:current?.rightInternal?._state.readOnly,limit:'Test refresh only for screenshot; excluded from all latency samples'});
  };
  for(const theme of ['light','dark'])for(const [width,height] of [[1280,800],[1600,1000]]){
   await addon.setMode(reader,'compare');const current=addon.states.get(reader.tabID);
   reader._internalReader.setColorScheme(theme);current.rightInternal.setColorScheme(theme);
   win.resizeTo(width,height);await reader.navigate({pageIndex:0});await pause(200);current.sync.alignFrom('left');
   await capture(`p2-${theme}-compare-${width}`,theme,'compare',[width,height]);
  }
  reader._internalReader.setColorScheme('light');await addon.setMode(reader,'translation');await pause(200);addon.states.get(reader.tabID).rightInternal.setColorScheme('light');await capture('p2-light-translation','light','translation',[1600,1000]);
  await addon.setMode(reader,'original');await pause(200);await capture('p2-light-original','light','original',[1600,1000]);
  reader._internalReader.setColorScheme('dark');
  return{passed:true,stage:'visual_evidence_pending_review',screenshots:shots,screenshot:shots[1],requiresReview:true};
 }
 if(ctx.action==='zoom-modes'){
  const cases=[],checks={};
  await sampleMove('left',7,0.3);
  for(const [side,internal] of [['left',reader._internalReader],['right',state.rightInternal]]){
   sync.views[side].window.document.dispatchEvent(new sync.views[side].window.Event('wheel',{bubbles:true}));internal.zoomIn();await preparePaint();await wait(()=>distance()<=.02,2500);
   cases.push({action:side+'-zoom-in',error:distance()});
   sync.views[side].window.document.dispatchEvent(new sync.views[side].window.Event('wheel',{bubbles:true}));internal.zoomPageWidth();await preparePaint();await wait(()=>distance()<=.02,2500);
   cases.push({action:side+'-page-width',error:distance()});
  }
  for(const width of [1280,1600]){win.resizeTo(width,width===1280?800:1000);await preparePaint();await wait(()=>distance()<=.02,2500);cases.push({action:'resize-'+width,error:distance()});}
  checks.zoomResize=cases.every(c=>c.error<=0.02);
  await addon.setMode(reader,'translation');await pause(200);
  const m=sync.metrics('right');sync.views.right.viewer.scrollTop=m.pages[10].top+m.pages[10].height*.25;await pause(100);
  const translatedAnchor=sync.anchor('right');await addon.setMode(reader,'original');await pause(150);
  const view=reader._internalReader._primaryView._iframeWindow,viewer=view.document.getElementById('viewerContainer');
  const page=[...view.document.querySelectorAll('.page')][translatedAnchor.pageIndex];
  const originalAnchor=sync.anchor('left');
  checks.translationToOriginalPosition=Math.abs((originalAnchor.pageIndex+originalAnchor.fraction)-(translatedAnchor.pageIndex+translatedAnchor.fraction))<=0.02;
  await addon.setMode(reader,'compare');await pause(200);
  const current=addon.states.get(reader.tabID).sync;
  checks.rebuiltAligned=Math.abs((current.anchor('left').pageIndex+current.anchor('left').fraction)-(current.anchor('right').pageIndex+current.anchor('right').fraction))<=0.02;
  checks.hostPreserved=reader._iframe===identity.browser&&reader._internalReader===identity.internal;
  return{passed:Object.values(checks).every(Boolean),stage:'native_zoom_modes_resize',checks,cases,translatedAnchor,originalScroll:viewer.scrollTop};
 }
 if(ctx.action==='navigation'){
  const checks={},actions=[];
  for(const [side,internal] of [['left',reader._internalReader],['right',state.rightInternal]]){
   sync.leader=side;delete sync.expected[side];
   for(const [name,method,expected] of [['first','navigateToFirstPage',0],['next','navigateToNextPage',1],['last','navigateToLastPage',18],['previous','navigateToPreviousPage',17]]){
    const inputWindow=sync.views[side].window;inputWindow.document.dispatchEvent(new inputWindow.Event('keydown',{bubbles:true}));
    internal[method]();await preparePaint();try{await wait(()=>{const m=sync.metrics(side);return name==='last'?Math.abs(m.scrollTop-(m.scrollHeight-m.clientHeight))<2:sync.anchor(side)?.pageIndex===expected;},2000);}catch{throw new Error(JSON.stringify({phase:'native-navigation',side,name,expected,actual:sync.anchor(side),method:String(internal[method]),intentSide:sync.intentSide,leader:sync.leader,samples:sync.stats.samples.slice(-3)}));}await pause(100);
    actions.push({side,name,distance:distance(),anchor:sync.anchor(side)});
   }
   checks[side+'NativeNavigation']=actions.filter(a=>a.side===side).every(a=>a.distance<0.02||a.name==='last');
  }
  const toggle=reader._iframeWindow.document.querySelector('.doubao-sync-button');toggle.click();
  const before=sync.views.right.viewer.scrollTop;sync.views.left.viewer.scrollTop+=250;await pause(150);
  checks.disabledIndependent=!sync.enabled&&sync.views.right.viewer.scrollTop===before;
  toggle.click();await pause(150);checks.reenabledAligned=sync.enabled&&distance()<0.02;
  const pointerWindow=sync.views.left.window;
  pointerWindow.document.dispatchEvent(new pointerWindow.PointerEvent('pointerdown',{bubbles:true,pointerId:7,button:0}));
  const originalTop=sync.views.left.viewer.scrollTop;sync.views.right.viewer.scrollTop-=130;await pause(150);
  checks.annotationGestureNoReverseJump=sync.views.left.viewer.scrollTop===originalTop;
  pointerWindow.document.dispatchEvent(new pointerWindow.PointerEvent('pointerup',{bubbles:true,pointerId:7,button:0}));
  await addon.setMode(reader,'original');
  checks.nativeHostPreserved=reader._iframe===identity.browser&&reader._internalReader===identity.internal&&reader._iframe.parentNode===identity.parent;
  checks.cleanup=sync.disposed&&sync.cleanup.length===0&&sync.timer===null&&sync.poll===null&&!addon.states.has(reader.tabID);
  return{passed:Object.values(checks).every(Boolean),stage:'native_navigation_and_cleanup',checks,actions};
 }
 if(ctx.action==='engine-input'){
  const results=[];
  const refresh=async()=>{const us=[win,reader._iframeWindow,state.right.contentWindow,...Object.values(sync.views).map(v=>v.window)].map(w=>Components.utils.unwaiveXrays(w).windowUtils);try{for(let n=0;n<20;n++){us.forEach(u=>u.advanceTimeAndRefresh(17));await pause(10);}}finally{us.forEach(u=>u.restoreNormalRefresh());}};
  for(const side of ['left','right']){
   const v=sync.views[side],u=Components.utils.unwaiveXrays(v.window).windowUtils;
   await sampleMove(side,4,.25);await refresh();const before=v.viewer.scrollTop;
   const rect=v.viewer.getBoundingClientRect(),events=[];
   const capture=e=>events.push({type:e.type,trusted:e.isTrusted,key:e.key,keyCode:e.keyCode,defaultPrevented:e.defaultPrevented,target:e.target?.id});
   v.window.document.addEventListener('wheel',capture,true);v.window.document.addEventListener('keydown',capture,true);
   try{
    u.sendWheelEvent(rect.x+rect.width/2,rect.y+Math.min(150,rect.height/2),0,300,0,0,0,0,3,0);
    await refresh();await pause(150);
    results.push({side,input:'wheel',moved:Math.abs(v.viewer.scrollTop-before)>10,error:distance(),events:events.slice()});
    const oldTab=v.viewer.getAttribute('tabindex');v.viewer.setAttribute('tabindex','0');v.viewer.focus();v.window.focus();const keyBefore=v.viewer.scrollTop;
    const tip=Components.classes['@mozilla.org/text-input-processor;1'].createInstance(Components.interfaces.nsITextInputProcessor);if(!tip.beginInputTransactionForTests(v.window))throw new Error('Test key transaction unavailable');tip.keydown(new v.window.KeyboardEvent('keydown',Components.utils.cloneInto({key:'PageDown',code:'PageDown',keyCode:34},v.window)),tip.KEY_NON_PRINTABLE_KEY);tip.keyup(new v.window.KeyboardEvent('keyup',Components.utils.cloneInto({key:'PageDown',code:'PageDown',keyCode:34},v.window)),tip.KEY_NON_PRINTABLE_KEY);await refresh();await pause(150);
    results.push({side,input:'page-down',moved:Math.abs(v.viewer.scrollTop-keyBefore)>10,error:distance(),events:events.slice(),focus:v.window.document.activeElement?.id});if(oldTab===null)v.viewer.removeAttribute('tabindex');else v.viewer.setAttribute('tabindex',oldTab);
    const scrollBefore=v.viewer.scrollTop;
    u.sendMouseEvent('mousedown',rect.right-3,rect.y+Math.min(300,rect.height-20),0,1,0);
    u.sendMouseEvent('mouseup',rect.right-3,rect.y+Math.min(300,rect.height-20),0,1,0);await refresh();await pause(150);
    results.push({side,input:'scrollbar-track',moved:Math.abs(v.viewer.scrollTop-scrollBefore)>10,error:distance()});
   }finally{v.window.document.removeEventListener('wheel',capture,true);v.window.document.removeEventListener('keydown',capture,true);}
  }
  return{passed:results.every(r=>r.moved&&r.error<=.02),stage:'gecko_engine_input',results,method:'Gecko windowUtils events scoped to test PDF frames; no OS input'};
 }
 if(ctx.action==='inspect'){
  const left=sync.metrics('left'),right=sync.metrics('right');
  const before={left:sync.views.left.viewer.scrollTop,right:sync.views.right.viewer.scrollTop};
  sync.views.left.viewer.scrollTop=left.pages[5].top+0.3*left.pages[5].height;
  await pause(350);
  const after={left:sync.views.left.viewer.scrollTop,right:sync.views.right.viewer.scrollTop};
  return{passed:distance()<=0.02,stage:'initial_sync_probe',before,after,distance:distance(),left,right,stats:sync.stats,visibility:{root:win.document.visibilityState,left:sync.views.left.window.document.visibilityState,right:sync.views.right.window.document.visibilityState},methods:Object.getOwnPropertyNames(Object.getPrototypeOf(reader._internalReader)).filter(x=>/theme|color|zoom/i.test(x))};
 }
 throw new Error('Unknown P2 scenario');
};
