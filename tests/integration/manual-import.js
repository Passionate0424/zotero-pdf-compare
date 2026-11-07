/* Runs only through the isolated development probe. File selection is stubbed;
 * the actual toolbar, import, PDF worker, database, storage and reader are real. */
var runManualImport=async function(ctx){
 if(Zotero.DataDirectory.dir.toLowerCase()!==PathUtils.join(ctx.runtime,'zotero-data').toLowerCase())throw new Error('Not the owned test database');
 const win=Zotero.getMainWindow(),addon=win.DoubaoTranslate,service=addon?.manual;
 if(!service)throw new Error('Manual import product not loaded');
 const pause=ms=>new Promise(r=>ctx.timers.setTimeout(r,ms));
 const wait=async(fn)=>{const end=Date.now()+20000;while(Date.now()<end){if(ctx.signal.aborted)throw new Error('Aborted');const value=fn();if(value)return value;await pause(50);}throw new Error('Manual test readiness timeout');};
 const file=PathUtils.join(ctx.runtime,'manual-fixture.json');
 let fixture=await IOUtils.exists(file)?await IOUtils.readJSON(file):null;
 const originalPath=PathUtils.join(ctx.root,'fixtures','public','doubao-19p','world-action-models.original.pdf');
 const selectedPath=PathUtils.join(ctx.root,'fixtures','public','doubao-19p','world-action-models.zh-CN.doubao.pdf');
 if(!fixture){
  const parent=new Zotero.Item('journalArticle');parent.libraryID=Zotero.Libraries.userLibraryID;parent.setField('title','[DEV MANUAL] 手动译文导入与原生批注');parent.addTag('doubao-dev-fixture');await parent.saveTx();
  const source=await Zotero.Attachments.importFromFile({file:Zotero.File.pathToFile(originalPath),parentItemID:parent.id,title:'[原文] 手动导入验收'});
  const key=Zotero.DataObjectUtilities.generateKey();const annotation=await Zotero.Annotations.saveFromJSON(source,{key,type:'highlight',color:'#ffd400',pageLabel:'1',sortIndex:'00000|000100|00000',text:'Manual import annotation preservation',comment:'导入前已有批注',tags:[],position:{pageIndex:0,rects:[[72,675,310,691]]}});
  fixture={libraryID:source.libraryID,parentKey:parent.key,sourceKey:source.key,annotationKey:annotation.key};await IOUtils.writeJSON(file,fixture);
 }
 const source=Zotero.Items.getByLibraryAndKey(fixture.libraryID,fixture.sourceKey),parent=Zotero.Items.getByLibraryAndKey(fixture.libraryID,fixture.parentKey);
 let reader=await Zotero.Reader.open(source.id)||Zotero.Reader._readers.find(r=>r.itemID===source.id);await reader._initPromise;
 win.docShell.browsingContext.isActive=true;reader._updateDocShellActivity();
 const originalReader=reader._internalReader,originalBrowser=reader._iframe;
 const screenshot=async name=>{
  const state=addon.states.get(reader.tabID),windows=[win,reader._iframeWindow,reader._internalReader._primaryView._iframeWindow,state?.right.contentWindow,state?.rightInternal?._primaryView?._iframeWindow].filter(Boolean),utils=windows.map(w=>Components.utils.unwaiveXrays(w).windowUtils);
  const pdfWindows=[reader._internalReader._primaryView._iframeWindow,state?.rightInternal?._primaryView?._iframeWindow].filter(Boolean);
  const pending=()=>pdfWindows.some(w=>[...w.document.querySelectorAll('.page')].some(p=>{const r=p.getBoundingClientRect();return r.bottom>0&&r.top<w.innerHeight&&(p.classList.contains('loading')||!p.querySelector('.canvasWrapper canvas'));}));
  try{for(let n=0;n<250;n++){utils.forEach(u=>u.advanceTimeAndRefresh(17));await pause(20);if(n>=25&&!pending())break;}}finally{utils.forEach(u=>u.restoreNormalRefresh());}
  const shot=await win.docShell.browsingContext.currentWindowGlobal.drawSnapshot(null,win.devicePixelRatio,'rgb(255,255,255)',false);
  const canvas=win.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=shot.width;canvas.height=shot.height;canvas.getContext('2d').drawImage(shot,0,0);shot.close();
  const binary=win.atob(canvas.toDataURL('image/png').split(',')[1]),path=PathUtils.join(ctx.runtime,name+'.png');await IOUtils.write(path,Uint8Array.from(binary,c=>c.charCodeAt(0)));
  return{path,width:canvas.width,height:canvas.height,dpr:win.devicePixelRatio,method:'gecko-window-global-snapshot'};
 };
 const checks={},screenshots=[];
 if(ctx.action==='compare-toolbar-geometry'){
  const sizes=[];
  for(const width of [1600,1280]){
   win.resizeTo(width,width===1600?1000:800);await addon.setMode(reader,'compare');
   const s=addon.states.get(reader.tabID);
   screenshots.push(await screenshot('compare-toolbar-'+width));
   const measure=d=>{const toolbar=d.querySelector('.toolbar'),tools=toolbar.querySelector('.tools');return{height:toolbar.getBoundingClientRect().height,width:toolbar.getBoundingClientRect().width,toolsDisplay:d.defaultView.getComputedStyle(tools).display,toolsRect:tools.getBoundingClientRect().toJSON(),toolsChildren:tools.children.length};};
   sizes.push({width,ratio:.5,original:measure(reader._iframeWindow.document),translation:measure(s.right.contentDocument)});
   for(const ratio of [.3,.7,.5]){s.resize(ratio);await screenshot(`compare-toolbar-${width}-${ratio}`);sizes.push({width,ratio,original:measure(reader._iframeWindow.document),translation:measure(s.right.contentDocument)});}
  }
  checks.equal=sizes.every(s=>Math.abs(s.original.height-s.translation.height)<1);
  checks.splitWidths=sizes.filter(s=>s.ratio!==.5).every(s=>Math.abs(s.original.width-s.translation.width)>100);
  checks.heightRestored=[1600,1280].every(width=>{const entries=sizes.filter(s=>s.width===width&&s.ratio===.5);return Math.abs(entries[0].original.height-entries.at(-1).original.height)<1;});
  await addon.setMode(reader,'original');checks.cleanup=reader._iframeWindow.document.querySelector('.toolbar').style.minHeight==='';
  win.resizeTo(1600,1000);return{passed:Object.values(checks).every(Boolean),checks,sizes,screenshots,screenshot:screenshots[1]};
 }
 if(ctx.action==='toolbar-height'){
  const sizes=[];
  const controlsFit=doc=>{const bar=doc.querySelector('.toolbar').getBoundingClientRect();return [...doc.querySelectorAll('.toolbar button,.toolbar input')].every(el=>{const r=el.getBoundingClientRect();return !r.width||!r.height||(r.top>=bar.top-1&&r.bottom<=bar.bottom+1&&r.left>=bar.left-1&&r.right<=bar.right+1);});};
  const compareActionsHidden=doc=>[...doc.querySelectorAll('.doubao-sync-button,.doubao-swap-button,.doubao-zoom-button')].every(el=>el.getBoundingClientRect().width===0);
  const pageCountClear=doc=>{const text=doc.querySelector('#numPages div')?.getBoundingClientRect(),tools=doc.querySelector('.toolbar > .tools')?.getBoundingClientRect();return !text?.width||!tools?.width||text.right<=tools.left+1;};
  for(const width of [1600,1280]){
   win.resizeTo(width,width===1600?1000:800);await addon.setMode(reader,'original');
   const original=reader._iframeWindow.document.querySelector('.toolbar').getBoundingClientRect().height;
   screenshots.push(await screenshot('toolbar-original-'+width));
   const originalFit=controlsFit(reader._iframeWindow.document),originalHidden=compareActionsHidden(reader._iframeWindow.document),originalPageCountClear=pageCountClear(reader._iframeWindow.document);
   await addon.setMode(reader,'translation');const s=addon.states.get(reader.tabID),translated=s.right.contentDocument.querySelector('.toolbar').getBoundingClientRect().height;
   screenshots.push(await screenshot('toolbar-translation-'+width));sizes.push({width,original,translated,originalFit,translatedFit:controlsFit(s.right.contentDocument),originalHidden,translatedHidden:compareActionsHidden(s.right.contentDocument),originalPageCountClear});
  }
  checks.equalSingleToolbarHeight=sizes.every(s=>Math.abs(s.original-s.translated)<1);
  checks.singleControlsFit=sizes.every(s=>s.originalFit&&s.translatedFit);
  checks.pageCountDoesNotOverlapAnnotationTools=sizes.every(s=>s.originalPageCountClear);
  checks.compareOnlyActionsHiddenInSingle=sizes.every(s=>s.originalHidden&&s.translatedHidden);
  await addon.setMode(reader,'compare');const s=addon.states.get(reader.tabID),identity=s.rightInternal;
  checks.compareUsesResponsiveLayout=[reader._iframeWindow.document,s.right.contentDocument].every(d=>d.documentElement.classList.contains('doubao-compare-layout'));
  checks.compareActionsReturn=[reader._iframeWindow.document,s.right.contentDocument].every(d=>!compareActionsHidden(d));
  checks.originalAnnotationToolsAvailable=reader._iframeWindow.getComputedStyle(reader._iframeWindow.document.querySelector('.toolbar > .tools')).display!=='none'&&!reader._isReadOnly();
  checks.translatedAnnotationToolsHidden=s.right.contentWindow.getComputedStyle(s.right.contentDocument.querySelector('.toolbar > .tools')).display==='none';
  await addon.setMode(reader,'original');await addon.setMode(reader,'translation');checks.cacheStillReused=addon.states.get(reader.tabID).rightInternal===identity;
  win.resizeTo(1600,1000);return{passed:Object.values(checks).every(Boolean),checks,sizes,screenshots,screenshot:screenshots[1]};
 }
 if(ctx.action==='cache-transition'){
  const prior=addon.states.get(reader.tabID);if(prior)addon.restore(prior);
  let samples=0,split=false;const timer=ctx.timers.setInterval(()=>{const s=addon.states.get(reader.tabID);if(!s)return;const a=s.sourceBrowser.getBoundingClientRect(),b=s.right.getBoundingClientRect();samples++;if(a.width>0&&b.width>0&&(a.right<=b.left+1||b.right<=a.left+1))split=true;},8);
  try{await addon.setMode(reader,'translation');}finally{ctx.timers.clearInterval(timer);}
  return{passed:!split&&samples>0,samples,visibleSplitObserved:split};
 }
 if(ctx.action==='cache-reading-position'){
  await addon.setMode(reader,'translation');let state=addon.states.get(reader.tabID);const w=state.sync.views.right.window;w.document.dispatchEvent(new w.WheelEvent('wheel',{deltaY:1,bubbles:true}));
  await addon.setMode(reader,'original');await reader.navigate({pageIndex:5});reader._internalReader._primaryView._iframeWindow.PDFViewerApplication.pdfViewer.update();
  const expected=state.sync.anchor('left');await addon.setMode(reader,'translation');state=addon.states.get(reader.tabID);const actual=state.sync.anchor('right');
  return{passed:Math.abs(expected.pageIndex+expected.fraction-actual.pageIndex-actual.fraction)<.02,expected,actual};
 }
 if(ctx.action==='cache-memory'){
  const manager=Components.classes['@mozilla.org/memory-reporter-manager;1'].getService(Components.interfaces.nsIMemoryReporterManager);
  const collect=async()=>{await pause(300);for(let n=0;n<2;n++){Components.utils.forceGC();if(typeof Components.utils.forceCC==='function')Components.utils.forceCC();await pause(100);}return{residentBytes:manager.resident,heapAllocatedBytes:manager.heapAllocated};};
  for(const state of [...addon.states.values()])addon.restore(state);
  const before=await collect();await addon.setMode(reader,'translation');await addon.setMode(reader,'original');
  const hiddenCount=[...addon.states.values()].filter(s=>s.mode==='original').length,hidden=await collect();
  addon.restore(addon.states.get(reader.tabID));const released=await collect();
  return{passed:hiddenCount===1&&addon.states.size===0,hiddenCount,releasedCount:addon.states.size,before,hidden,released,scope:'test parent process snapshots after GC; includes other tabs/native caches; not a per-file guarantee'};
 }
 if(ctx.action==='cache-activity')return{passed:true,sourceActive:reader._iframe.docShellIsActive,sourceVisible:reader._iframe.getBoundingClientRect().width,sourcePDFVisibility:reader._internalReader._primaryView._iframeWindow.document.visibilityState,mode:addon.states.get(reader.tabID)?.mode};
 if(ctx.action==='cache-layout'){
  await addon.setMode(reader,'compare');await addon.setMode(reader,'translation');const s=addon.states.get(reader.tabID);
  const width=s.right.getBoundingClientRect().width,total=s.container.getBoundingClientRect().width;
  return{passed:Math.abs(width-total)<1,width,total};
 }
 if(ctx.action==='cache-reset-fixture'){
  addon.pair(source,Zotero.Items.getByLibraryAndKey(fixture.libraryID,fixture.translatedKey));return{passed: addon.translationFor(reader).key===fixture.translatedKey};
 }
 if(ctx.action==='cache-lifecycle'){
  let modeStep=0;const cacheMode=async(r,mode)=>{modeStep++;try{return await addon.setMode(r,mode);}catch(error){throw new Error(JSON.stringify({modeStep,itemID:r.itemID,mode,checks,error:String(error)}));}};
  await cacheMode(reader,'translation');const state=addon.states.get(reader.tabID),native=state.rightInternal,browser=state.right,sync=state.sync,zoom=state.zoom;
  const annotation=Zotero.Items.getByLibraryAndKey(fixture.libraryID,fixture.annotationKey),position=annotation.annotationPosition;
  await cacheMode(reader,'original');
  checks.retainedReader=addon.states.get(reader.tabID)===state&&state.rightInternal===native&&!state.closed;
  checks.hiddenOnly=state.mode==='original'&&browser.getBoundingClientRect().width===0&&!browser.docShellIsActive;
  checks.noBackgroundWork=sync.disposed&&sync.poll===null&&sync.frame===null&&sync.cleanup.length===0&&zoom.disposed&&zoom.cleanup.length===0;
  checks.nativeLayoutRestored=reader._iframe.getAttribute('style')===state.originalBrowserStyle&&reader._iframe.getAttribute('flex')===state.originalBrowserFlex;
  const quiet=sync.stats.applies;await pause(200);checks.noHiddenSyncUpdates=sync.stats.applies===quiet;
  const start=Date.now();await cacheMode(reader,'translation');const warmMs=Date.now()-start;
  checks.reusesSameBrowserAndPdf=addon.states.get(reader.tabID).right===browser&&addon.states.get(reader.tabID).rightInternal===native;
  checks.resumesFreshSync=state.sync!==sync&&!state.sync.disposed;
  checks.warmSwitchUnder250ms=warmMs<250;
  await cacheMode(reader,'original');
  const path=await state.translated.getFilePathAsync(),stat=await IOUtils.stat(path);
  try{await IOUtils.setModificationTime(path,stat.lastModified+2000);await cacheMode(reader,'translation');checks.changedFileInvalidates=state.closed&&addon.states.get(reader.tabID).rightInternal!==native;}
  finally{await IOUtils.setModificationTime(path,stat.lastModified);}
  await cacheMode(reader,'original');
  const secondSource=Zotero.Items.getByLibraryAndKey(fixture.libraryID,fixture.standaloneSourceKey);
  let other=await Zotero.Reader.open(secondSource.id)||Zotero.Reader._readers.find(r=>r.itemID===secondSource.id);await other._initPromise;
  await cacheMode(other,'translation');await cacheMode(other,'original');
  checks.oneHiddenCache=[...addon.states.values()].filter(s=>s.mode==='original').length===1&&!addon.states.has(reader.tabID);
  const cached=addon.states.get(other.tabID);other.close();await wait(()=>!addon.states.has(other.tabID));
  checks.closeReleasesCachedReader=cached.closed&&!cached.right.isConnected;
  checks.annotationUnchanged=annotation.parentID===source.id&&annotation.annotationPosition===position;
  await Zotero.Reader.open(source.id);await cacheMode(reader,'original');screenshots.push(await screenshot('cache-original'));
  await cacheMode(reader,'translation');screenshots.push(await screenshot('cache-translation'));
  await cacheMode(reader,'compare');screenshots.push(await screenshot('cache-compare'));
  return{passed:Object.values(checks).every(Boolean),checks,warmMs,screenshots,screenshot:screenshots[0]};
 }
 if(['cache-benchmark','cache-benchmark-force-cold'].includes(ctx.action)){
  const prior=addon.states.get(reader.tabID);if(prior)addon.restore(prior);
  const memory=()=>{try{return Components.classes['@mozilla.org/memory-reporter-manager;1'].getService(Components.interfaces.nsIMemoryReporterManager).resident;}catch{return null;}};
  const before=memory(),samples=[],identities=[];
  for(let n=0;n<5;n++){
   if(ctx.action==='cache-benchmark-force-cold'){const cached=addon.states.get(reader.tabID);if(cached)addon.restore(cached);}
   const start=Date.now();await addon.setMode(reader,'translation');const elapsedMs=Date.now()-start;
   const s=addon.states.get(reader.tabID);identities.push(s.right.browsingContext.id);samples.push({iteration:n,elapsedMs});
   await addon.setMode(reader,'original');
  }
  return{passed:true,benchmark:true,samples,readerReused:identities.slice(1).every(x=>x===identities[0]),memory:{beforeResidentBytes:before,afterResidentBytes:memory(),scope:'test parent process resident; includes rendering/GC and other tabs; not retained cache size'},cachedState:!!addon.states.get(reader.tabID)};
 }
 if(ctx.action==='swap-zoom-inspect'){
  const s=addon.states.get(reader.tabID),sync=s?.sync;
  return{passed:true,diagnostic:true,swapped:s?.swapped,zoomEnabled:s?.zoom.enabled,scrollEnabled:sync?.enabled,leader:sync?.leader,expected:sync?.expected,views:sync&&Object.fromEntries(Object.entries(sync.views).map(([side,v])=>[side,{scale:v.window.PDFViewerApplication.pdfViewer.currentScale,value:v.window.PDFViewerApplication.pdfViewer.currentScaleValue,focus:sync.focus(side),metrics:sync.metrics(side)}])),samples:sync?.stats.samples.slice(-5)};
 }
 if(ctx.action==='swap-zoom'||ctx.action==='swap-zoom-persistence'){
  if(ctx.action==='swap-zoom'){
   await addon.setMode(reader,'original');const cached=addon.states.get(reader.tabID);if(cached)addon.restore(cached);
   Zotero.Prefs.set('extensions.doubaoTranslate.translationOnLeft',false,true);Zotero.Prefs.set('extensions.doubaoTranslate.syncZoom',true,true);
  }
  await addon.setMode(reader,'compare');
  let s=addon.states.get(reader.tabID),sync=s.sync;
  const apps=Object.fromEntries(Object.entries(sync.views).map(([side,v])=>[side,v.window.PDFViewerApplication]));
  const focusError=()=>{const a=sync.focus('left'),b=sync.focus('right');return Math.max(Math.abs(a.pageIndex+a.fraction-b.pageIndex-b.fraction),Math.abs(a.xFraction-b.xFraction));};
  const settle=async(fn,phase)=>{try{await wait(fn);}catch(error){const trace={phase,checks,views:Object.fromEntries(Object.entries(apps).map(([side,a])=>[side,{scale:a.pdfViewer.currentScale,value:a.pdfViewer.currentScaleValue,focus:sync.focus(side)}]))};await IOUtils.writeJSON(PathUtils.join(ctx.runtime,'swap-zoom-trace.json'),trace);throw new Error(JSON.stringify(trace));}};
  const intent=side=>{const w=sync.views[side].window;w.document.dispatchEvent(new w.WheelEvent('wheel',{deltaY:1,bubbles:true}));};
  const place=(side,anchor)=>{intent(side);const m=sync.metrics(side),p=m.pages[anchor.pageIndex],v=sync.views[side].viewer;v.scrollTop=p.top+p.height*anchor.fraction-m.clientHeight/2;v.scrollLeft=p.left+p.width*anchor.xFraction-m.clientWidth/2;apps[side].pdfViewer.update();};
  if(ctx.action==='swap-zoom-persistence'){
   checks.swapRemembered=s.swapped&&s.sourceBrowser.getBoundingClientRect().x>s.right.getBoundingClientRect().x;
   checks.zoomRemembered=s.zoomWanted&&s.zoom.enabled;
   checks.nativeSourceWritable=!reader._isReadOnly()&&reader._internalReader===originalReader;
   return{passed:Object.values(checks).every(Boolean),checks};
  }
  checks.controlsPresent=!!reader._iframeWindow.document.querySelector('.doubao-swap-button')&&!!s.right.contentDocument.querySelector('.doubao-zoom-button');
  apps.left.pdfViewer.currentScaleValue=2;await settle(()=>Math.abs(apps.right.pdfViewer.currentScale-2)<.0001,'initial-scale');
  place('left',{pageIndex:6,fraction:.45,xFraction:.65});await settle(()=>focusError()<.005,'left-region');
  checks.zoomAndRegionLeftToRight=focusError()<.005;const regionCases=[{action:'left-region',error:focusError(),left:sync.focus('left'),right:sync.focus('right')}];
  const beforePan=sync.views.right.viewer.scrollLeft;intent('left');sync.views.left.viewer.scrollLeft-=100;await settle(()=>focusError()<.005,'horizontal-only-pan');
  checks.horizontalPanAloneFollows=Math.abs(sync.views.right.viewer.scrollLeft-beforePan)>50;
  place('right',{pageIndex:7,fraction:.55,xFraction:.4});await settle(()=>focusError()<.005,'right-region');
  checks.regionRightToLeft=focusError()<.005;regionCases.push({action:'right-region',error:focusError(),left:sync.focus('left'),right:sync.focus('right')});
  intent('right');apps.right.pdfViewer.currentScaleValue=2.2;await settle(()=>Math.abs(apps.left.pdfViewer.currentScale-2.2)<.0001&&focusError()<.005,'right-numeric-zoom');
  checks.numericZoomRightToLeft=true;
  reader._iframeWindow.document.querySelector('.doubao-swap-button').click();
  checks.swappedPhysically=s.sourceBrowser.getBoundingClientRect().x>s.right.getBoundingClientRect().x;
  checks.originalHostPreserved=reader._iframe===originalBrowser&&reader._internalReader===originalReader&&reader._iframe.parentNode===s.container;
  const beforeWidth=s.right.getBoundingClientRect().width;s.divider.dispatchEvent(new win.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
  checks.swappedDividerPhysicalDirection=s.right.getBoundingClientRect().width>beforeWidth;
  s.right.contentDocument.querySelector('.doubao-swap-button').click();checks.swapFromTranslationControls=!s.swapped&&s.sourceBrowser.getBoundingClientRect().x<s.right.getBoundingClientRect().x;
  reader._iframeWindow.document.querySelector('.doubao-swap-button').click();
  reader._iframeWindow.document.querySelector('.doubao-sync-button').click();
  checks.zoomIndependentOfScrollToggle=!sync.enabled&&s.zoom.enabled;
  intent('left');apps.left.pdfViewer.update();reader._internalReader.zoomIn();await settle(()=>Math.abs(apps.left.pdfViewer.currentScale-apps.right.pdfViewer.currentScale)<.0001&&focusError()<.005,'zoom-scroll-off');
  checks.zoomStillCopiesRegionWithScrollOff=focusError()<.005;regionCases.push({action:'zoom-scroll-off',error:focusError(),left:sync.focus('left'),right:sync.focus('right')});
  const idle=sync.focus('right');place('left',{pageIndex:8,fraction:.5,xFraction:.6});await pause(150);
  checks.scrollOffAllowsIndependentPan=Math.abs(sync.focus('right').pageIndex+sync.focus('right').fraction-idle.pageIndex-idle.fraction)<.001;
  reader._iframeWindow.document.querySelector('.doubao-zoom-button').click();const fixed=apps.right.pdfViewer.currentScale;
  apps.left.pdfViewer.currentScaleValue=1.7;await pause(150);checks.zoomOffIndependent=Math.abs(apps.right.pdfViewer.currentScale-fixed)<.0001&&Math.abs(apps.left.pdfViewer.currentScale-fixed)>.01;
  intent('right');s.right.contentDocument.querySelector('.doubao-zoom-button').click();await settle(()=>Math.abs(apps.left.pdfViewer.currentScale-apps.right.pdfViewer.currentScale)<.0001&&focusError()<.005,'reenable-from-right');
  checks.enableFromTranslationCopiesScaleAndRegion=focusError()<.005;
  reader._iframeWindow.document.querySelector('.doubao-sync-button').click();
  intent('right');s.rightInternal.zoomPageWidth();await settle(()=>apps.left.pdfViewer.currentScaleValue==='page-width'&&apps.right.pdfViewer.currentScaleValue==='page-width','fit-width');
  checks.fitPresetMirrored=true;
  const annotation=Zotero.Items.getByLibraryAndKey(fixture.libraryID,fixture.annotationKey);checks.annotationParentUnchanged=annotation.parentID===source.id;
  await addon.setMode(reader,'translation');checks.translationOnlyHidesOriginal=s.sourceBrowser.getBoundingClientRect().width===0&&!s.zoom.enabled;
  await addon.setMode(reader,'compare');checks.modeRetainsSwappedAndZoom=s.swapped&&s.zoom.enabled&&Math.abs(s.sourceBrowser.getBoundingClientRect().width-s.right.getBoundingClientRect().width)<1;
  intent('left');apps.left.pdfViewer.currentScaleValue=1.3;place('left',{pageIndex:0,fraction:.45,xFraction:.5});await settle(()=>focusError()<.005,'visual-region');
  win.resizeTo(1600,1000);screenshots.push(await screenshot('swap-zoom-1600'));
  win.resizeTo(1280,800);screenshots.push(await screenshot('swap-zoom-1280'));
  checks.narrowControlsReachable=[reader._iframeWindow,s.right.contentWindow].every(w=>{const r=w.document.querySelector('.doubao-reading-modes').getBoundingClientRect();return r.x>=0&&r.right<=w.innerWidth+1;});
  win.resizeTo(1600,1000);const oldZoom=s.zoom;
  await addon.setMode(reader,'original');checks.zoomListenersDisposed=oldZoom.disposed&&oldZoom.cleanup.length===0;
  checks.sourceOrderRestored=reader._iframe.getAttribute('style')===s.originalBrowserStyle;
  await addon.setMode(reader,'compare');
  return{passed:Object.values(checks).every(Boolean),checks,regionCases,screenshots,screenshot:screenshots[0]};
 }
 if(ctx.action==='ux-diagnose'){
  await addon.setMode(reader,'original');
  const frames=[],transitions=[];let observing=true;
  const capture=()=>{const s=addon.states.get(reader.tabID);if(s)frames.push({t:Date.now(),mode:s.mode,left:s.sourceBrowser.getBoundingClientRect().width,right:s.right.getBoundingClientRect().width,visible:s.right.ownerGlobal.getComputedStyle(s.right).visibility});};
  const sample=ctx.timers.setInterval(capture,10);
  await addon.setMode(reader,'translation');ctx.timers.clearInterval(sample);capture();
  transitions.push({request:'original-to-translation',frames});
  await addon.setMode(reader,'original');await addon.setMode(reader,'compare');await pause(500);
  const s=addon.states.get(reader.tabID),sync=s.sync,u=Components.utils.unwaiveXrays(win).windowUtils;
  const bounds=()=>({container:s.container.getBoundingClientRect().toJSON(),source:s.sourceBrowser.getBoundingClientRect().toJSON(),right:s.right.getBoundingClientRect().toJSON(),divider:s.divider.getBoundingClientRect().toJSON(),ratio:s.ratio,styles:{source:s.sourceBrowser.getAttribute('style'),right:s.right.getAttribute('style')},computed:{source:win.getComputedStyle(s.sourceBrowser).flex,right:win.getComputedStyle(s.right).flex}});
  const initial=bounds(),events=[];
  const record=e=>events.push({type:e.type,x:e.clientX,ratio:s.ratio,left:s.sourceBrowser.getBoundingClientRect().width});
  for(const name of ['pointerdown','pointermove','pointerup'])s.divider.addEventListener(name,record);
  const d=s.divider.getBoundingClientRect(),b=s.container.getBoundingClientRect(),x=d.x+2;
  u.sendMouseEvent('mousedown',x,d.y+100,0,1,0);
  for(let n=0;n<6;n++){u.sendMouseEvent('mousemove',x-10*n,d.y+100,0,0,0);await pause(25);}
  u.sendMouseEvent('mouseup',x-50,d.y+100,0,1,0);await pause(80);
  for(const name of ['pointerdown','pointermove','pointerup'])s.divider.removeEventListener(name,record);
  const dragged=bounds(),samples=[];const applied=sync.onApply;sync.onApply=sample=>samples.push({...sample,t:Date.now()});
  const input=[];
  for(const side of ['left','right']){
   const v=sync.views[side];v.window.document.dispatchEvent(new v.window.WheelEvent('wheel',{deltaY:50,bubbles:true}));
   for(let n=0;n<60;n++){v.viewer.scrollTop+=10;input.push({side,t:Date.now(),top:v.viewer.scrollTop});await pause(8);}
   await pause(200);
  }
  sync.onApply=applied;
  await addon.setMode(reader,'translation');await addon.setMode(reader,'compare');const reentered=bounds();
  await addon.setMode(reader,'original');const restoredFlex=reader._iframe.getAttribute('flex');
  await addon.setMode(reader,'compare');
  checks.equalInitialPanes=Math.abs(initial.source.width-initial.right.width)<1;
  checks.noVisibleIntermediateCompare=frames.every(f=>f.mode!=='compare'||f.visible!=='visible'||f.left===0||f.right===0);
  checks.dragMatchesPointer=Math.abs(dragged.source.width-(initial.source.width-50))<2;
  checks.firstMoveDoesNotJump=Math.abs(events.find(e=>e.type==='pointermove').left-initial.source.width)<1;
  checks.compareReentersAtHalf=Math.abs(reentered.source.width-reentered.right.width)<1;
  checks.nativeFlexRestored=restoredFlex==='1';
  checks.nativeHostPreserved=reader._iframe===originalBrowser&&reader._internalReader===originalReader;
  for(const side of ['left','right'])checks[side+'DenseInputFollowed']=samples.filter(s=>s.source===side).length>=input.filter(i=>i.side===side).length*.9;
  screenshots.push(await screenshot('manual-ux-fixed'));
  return{passed:Object.values(checks).every(Boolean),checks,transitions,initial,dragged,reentered,events,input,samples,screenshots,screenshot:screenshots[0]};
 }
 if(ctx.action==='visual'){
  await addon.setMode(reader,'original');const pref='extensions.doubaoTranslate.pairs',old=Zotero.Prefs.get(pref,true),pairs=addon.getPairs();delete pairs[source.libraryID+':'+source.key];
  try{Zotero.Prefs.set(pref,JSON.stringify(pairs),true);addon.refreshControls(source.id);screenshots.push(await screenshot('manual-before-import'));}
  finally{Zotero.Prefs.set(pref,old,true);addon.refreshControls(source.id);}
  await addon.setMode(reader,'compare');screenshots.push(await screenshot('manual-import-compare'));
  win.resizeTo(1280,800);screenshots.push(await screenshot('manual-compare-1280'));
  const groups=[reader._iframeWindow,...(addon.states.get(reader.tabID)?[addon.states.get(reader.tabID).right.contentWindow]:[])];
  checks.narrowControlsReachable=groups.every(w=>{const r=w.document.querySelector('.doubao-reading-modes').getBoundingClientRect();return r.x>=0&&r.right<=w.innerWidth+1;});
  win.resizeTo(1600,1000);
  return{passed:Object.values(checks).every(Boolean),checks,screenshots,screenshot:screenshots[1]};
 }
 if(ctx.action==='replacement-menu'){
  const previous=addon.translationFor(reader),n=parent.getAttachments().length;
  try{
  const changed=await service.importFile(source,PathUtils.join(ctx.runtime,'p2-mismatch-two-pages.pdf'));
  await addon.setMode(reader,'compare');await wait(()=>addon.states.get(reader.tabID)?.rightInternal);
  const button=reader._iframeWindow.document.querySelector('.doubao-sync-button');
  checks.mismatchImported=changed.pageCountMismatch;checks.mismatchLinkDisabled=button.disabled&&button.textContent==='页数不同';
  checks.previousTranslationRetained=Zotero.Items.get(previous.id)?.id===previous.id;
  screenshots.push(await screenshot('manual-page-mismatch'));
  const restored=await service.importFile(source,selectedPath);checks.restoreExistingPair=!restored.created&&restored.translated.id===previous.id;
  await addon.setMode(reader,'original');await win.ZoteroPane.selectItem(source.id);win.Zotero_Tabs.select('zotero-pane');await win.ZoteroPane.buildItemContextMenu();
  const popup=win.document.getElementById('zotero-itemmenu');popup.openPopup(win.document.documentElement,'after_start',300,100,false,false);await pause(150);
  const menu=popup.querySelector('[label="导入已有译文 PDF…"]');checks.nativeMenuVisible=!!menu&&!menu.disabled&&!menu.hidden;
  screenshots.push(await screenshot('manual-library-menu'));popup.hidePopup();
  await Zotero.Reader.open(source.id);await addon.setMode(reader,'compare');
  return{passed:Object.values(checks).every(Boolean),checks,screenshots,screenshot:screenshots[1],countBefore:n,countAfter:parent.getAttachments().length};
  }finally{if(addon.translationFor(reader)?.id!==previous.id)addon.pair(source,previous);}
 }
 if(ctx.action==='persistence'){
  const translated=addon.translationFor(reader),annotation=Zotero.Items.getByLibraryAndKey(fixture.libraryID,fixture.annotationKey);
  checks.pairPersisted=translated?.key===fixture.translatedKey;checks.recordPersisted=service.records().some(r=>r.sourceKey===source.key&&r.translatedKey===translated.key);
  checks.originalAnnotationPersisted=annotation?.parentID===source.id;
  await addon.setMode(reader,'compare');await wait(()=>addon.states.get(reader.tabID)?.rightInternal);
  checks.nativeSourceWritable=!reader._isReadOnly();checks.readOnlyTranslation=addon.states.get(reader.tabID).rightInternal._state.readOnly===true;
  screenshots.push(await screenshot('manual-after-restart'));
  return{passed:Object.values(checks).every(Boolean),checks,screenshots,screenshot:screenshots[0],fixture};
 }
 if(ctx.action==='disable-reenable'||ctx.action==='disable-reenable-hidden'){
  await addon.setMode(reader,'compare');const state=addon.states.get(reader.tabID),sync=state.sync;
  const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
  const installed=await AddonManager.getAddonByID('doubao-translate@local.invalid');
  if(ctx.action==='disable-reenable-hidden')await addon.setMode(reader,'original');
  try{
   await installed.disable();
   checks.controllerRemoved=!win.DoubaoTranslate;checks.panesRemoved=!win.document.querySelector('.doubao-translation-pane');
   checks.toolbarRemoved=!reader._iframeWindow.document.querySelector('.doubao-reading-modes');
   checks.nativeFlexRestored=reader._iframe.getAttribute('flex')==='1';
   checks.timersDisposed=sync.disposed&&sync.poll===null&&sync.frame===null&&sync.cleanup.length===0;
   await win.ZoteroPane.buildItemContextMenu();checks.menuRemoved=!win.document.getElementById('zotero-itemmenu').querySelector('[label="导入已有译文 PDF…"]');
   checks.originalAnnotationPreserved=Zotero.Items.getByLibraryAndKey(fixture.libraryID,fixture.annotationKey)?.parentID===source.id;
  }finally{await installed.enable();await wait(()=>win.DoubaoTranslate&&!win.DoubaoTranslate.stopped);}
  checks.reenabled=!!reader._iframeWindow.document.querySelector('.doubao-import-button');
  return{passed:Object.values(checks).every(Boolean),checks};
 }
 if(ctx.action==='uninstall-check'){
  await addon.setMode(reader,'compare');
  const state=addon.states.get(reader.tabID),sync=state.sync,translated=addon.translationFor(reader);
  if(!translated)throw new Error('Paired translated attachment is required');
  const annotation=Zotero.Items.getByLibraryAndKey(fixture.libraryID,fixture.annotationKey);
  if(!annotation)throw new Error('Native annotation is required');
  const sourcePath=await source.getFilePathAsync(),translatedPath=await translated.getFilePathAsync();
  const originalHash=service.hash(await IOUtils.read(sourcePath)),translatedHash=service.hash(await IOUtils.read(translatedPath));
  const annotationPosition=annotation.annotationPosition,pairs=Zotero.Prefs.get('extensions.doubaoTranslate.pairs',true);
  const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
  const installed=await AddonManager.getAddonByID('doubao-translate@local.invalid');
  if(!installed||installed.temporarilyInstalled)throw new Error('Expected installed test addon');
  await installed.uninstall();await wait(()=>!win.DoubaoTranslate);
  checks.uninstalled=!(await AddonManager.getAddonByID('doubao-translate@local.invalid'));
  checks.controlsRemoved=!reader._iframeWindow.document.querySelector('.doubao-reading-modes');
  checks.panesRemoved=!win.document.querySelector('.doubao-translation-pane');
  checks.nativeRestored=reader._iframe.getAttribute('flex')==='1'&&!reader._isReadOnly();
  checks.syncDisposed=sync.disposed&&sync.poll===null&&sync.frame===null&&sync.cleanup.length===0;
  checks.sourceUnchanged=service.hash(await IOUtils.read(sourcePath))===originalHash;
  checks.translatedUnchanged=service.hash(await IOUtils.read(translatedPath))===translatedHash&&!!Zotero.Items.get(translated.id);
  checks.annotationUnchanged=Zotero.Items.get(annotation.id)?.annotationPosition===annotationPosition&&annotation.parentID===source.id;
  checks.pairPreferencesRetained=Zotero.Prefs.get('extensions.doubaoTranslate.pairs',true)===pairs;
  return{passed:Object.values(checks).every(Boolean),checks,sourceKey:source.key,translatedKey:translated.key};
 }
 if(ctx.action==='direct-import'){
  const testParent=new Zotero.Item('journalArticle');testParent.libraryID=source.libraryID;testParent.setField('title','[DEV] 真实译文导入验收');testParent.addTag('doubao-dev-fixture');await testParent.saveTx();
  const testSource=await Zotero.Attachments.importFromFile({file:Zotero.File.pathToFile(originalPath),parentItemID:testParent.id});
  const sourceHash=service.hash(await IOUtils.read(await testSource.getFilePathAsync()));
  const selectedHash=service.hash(await IOUtils.read(selectedPath));
  const first=await service.importFile(testSource,selectedPath),second=await service.importFile(testSource,selectedPath);
  checks.created=first.created&&!first.cancelled;
  checks.correctParent=first.translated.parentID===testParent.id;
  checks.fileMatches=service.hash(await IOUtils.read(await first.translated.getFilePathAsync()))===selectedHash;
  checks.originalUnchanged=service.hash(await IOUtils.read(await testSource.getFilePathAsync()))===sourceHash;
  checks.duplicateReused=!second.created&&second.translated.id===first.translated.id;
  checks.pairRecorded=service.records().some(r=>r.sourceKey===testSource.key&&r.translatedKey===first.translated.key);
  return{passed:Object.values(checks).every(Boolean),checks,testParentKey:testParent.key};
 }
 if(ctx.action!=='import')throw new Error('Unknown manual scenario');
 await addon.setMode(reader,'original');
 const sourceBefore=service.hash(await IOUtils.read(await source.getFilePathAsync())),selectedBefore=service.hash(await IOUtils.read(selectedPath));
 const annotationBefore=Zotero.Items.getByLibraryAndKey(fixture.libraryID,fixture.annotationKey).annotationPosition;
 const count=()=>parent.getAttachments().length;
 const initialCount=count();const button=reader._iframeWindow.document.querySelector('.doubao-import-button');
 checks.importEntryWithoutPair=!!button;
 screenshots.push(await screenshot('manual-before-import'));
 const choose=service.pickFile;service.pickFile=async()=>null;await addon.openManualImport(source,win,reader);checks.cancelNoWrite=count()===initialCount;
 service.pickFile=async()=>selectedPath;
 try{button.click();await wait(()=>addon.translationFor(reader)&&addon.states.get(reader.tabID)?.rightInternal&&!service.pending.size);}
 finally{service.pickFile=choose;}
 const translated=addon.translationFor(reader);fixture.translatedKey=translated.key;await IOUtils.writeJSON(file,fixture);
 const afterCount=count();
 checks.storedSibling=translated.parentID===parent.id&&translated.attachmentLinkMode===Zotero.Attachments.LINK_MODE_IMPORTED_FILE;
 checks.correctPair=translated.id!==source.id&&translated.libraryID===source.libraryID;
 checks.copyMatchesSelected=service.hash(await IOUtils.read(await translated.getFilePathAsync()))===selectedBefore;
 checks.parseNineteenPages=service.records().some(r=>r.sourceKey===source.key&&r.translatedPages===19&&r.sourcePages===19);
 checks.sourceHostPreserved=reader._internalReader===originalReader&&reader._iframe===originalBrowser;
 checks.nativeAnnotationPreserved=Zotero.Items.getByLibraryAndKey(fixture.libraryID,fixture.annotationKey).annotationPosition===annotationBefore;
 screenshots.push(await screenshot('manual-import-compare'));
 const duplicate=await service.importFile(source,selectedPath);
 checks.duplicateNoNewAttachment=!duplicate.created&&duplicate.translated.id===translated.id&&count()===afterCount;
 for(const [label,path] of [['sameAsOriginal',originalPath],['invalidFile',PathUtils.join(ctx.runtime,'manual-inputs','invalid.pdf')]]){
  let rejected=false;try{await service.importFile(source,path);}catch{rejected=true;}checks[label+'Rejected']=rejected&&count()===afterCount;
 }
 const oldPair=addon.getPairs()[source.libraryID+':'+source.key],oldRecords=JSON.stringify(service.records()),pair=addon.pair;
 addon.pair=()=>{throw new Error('Injected pairing failure');};let failed=false;
 try{await service.importFile(source,PathUtils.join(ctx.runtime,'manual-inputs','rollback-three-pages.pdf'));}catch{failed=true;}finally{addon.pair=pair;}
 checks.failureRollback=failed&&count()===afterCount&&addon.getPairs()[source.libraryID+':'+source.key]===oldPair&&JSON.stringify(service.records())===oldRecords;
 checks.originalAndDownloadUnchanged=service.hash(await IOUtils.read(await source.getFilePathAsync()))===sourceBefore&&service.hash(await IOUtils.read(selectedPath))===selectedBefore;
 // Persist a standalone original as well, without reparenting either PDF.
 let standalone=fixture.standaloneSourceKey&&Zotero.Items.getByLibraryAndKey(fixture.libraryID,fixture.standaloneSourceKey);
 if(!standalone){standalone=await Zotero.Attachments.importFromFile({file:Zotero.File.pathToFile(originalPath),libraryID:fixture.libraryID,title:'[DEV MANUAL] 独立原文 PDF'});fixture.standaloneSourceKey=standalone.key;await IOUtils.writeJSON(file,fixture);}
 const top=await service.importFile(standalone,selectedPath),again=await service.importFile(standalone,selectedPath);
 checks.standalonePair=!standalone.parentID&&!top.translated.parentID&&top.translated.libraryID===standalone.libraryID&&again.translated.id===top.translated.id&&!again.created;
 await addon.setMode(reader,'compare');
 checks.buttonsEnabled=[...reader._iframeWindow.document.querySelectorAll('[data-doubao-mode]')].every(b=>!b.disabled);
 return{passed:Object.values(checks).every(Boolean),checks,screenshots,screenshot:screenshots[1],fixture,attachmentCountBefore:initialCount,attachmentCountAfter:afterCount};
};
