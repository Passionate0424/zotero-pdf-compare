/* SPDX-License-Identifier: AGPL-3.0-only — runs only through the guarded test probe. */
var runP1 = async function(ctx) {
  const expected = PathUtils.join(ctx.root, 'runtime', 'zotero-data');
  if (Zotero.DataDirectory.dir.toLowerCase() !== expected.toLowerCase()) throw new Error('Refuse to run outside fixture database.');
  const pause = ms => new Promise(resolve => ctx.timers.setTimeout(resolve, ms));
  let progress = 'initialization';
  const waitFor = async (fn, timeout = 30000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (ctx.signal?.aborted) throw new Error('P1 suite aborted');
      try { const value = fn(); if (value) return value; } catch {}
      await pause(100);
    }
    throw new Error(`P1 test wait timed out: ${progress}`);
  };
  const fixturePath = PathUtils.join(ctx.runtime, 'p1-fixture.json');
  const fixture = await IOUtils.exists(fixturePath) ? await IOUtils.readJSON(fixturePath) : { libraryID: Zotero.Libraries.userLibraryID };
  const persist = () => IOUtils.writeJSON(fixturePath, fixture);
  const itemFor = key => key ? Zotero.Items.getByLibraryAndKey(fixture.libraryID, key) : null;
  let parent = itemFor(fixture.parentKey);
  if (!parent) {
    parent = new Zotero.Item('journalArticle');
    parent.libraryID = fixture.libraryID;
    parent.setField('title', '[DEV] World-Action Models for Robot Learning and Control: A Survey');
    parent.addTag('doubao-dev-fixture');
    await parent.saveTx(); fixture.parentKey = parent.key; await persist();
  }
  if (!parent.hasTag('doubao-dev-fixture')) throw new Error('Fixture parent ownership mismatch.');
  for (const [key, filename, title] of [
    ['sourceKey','world-action-models.original.pdf','[原文] World-Action Models'],
    ['translationKey','world-action-models.zh-CN.doubao.pdf','[豆包译文] World-Action Models'],
  ]) {
    if (!itemFor(fixture[key])) {
      const file = Zotero.File.pathToFile(PathUtils.join(ctx.root, 'fixtures','public','doubao-19p',filename));
      const att = await Zotero.Attachments.importFromFile({ file, parentItemID: parent.id, fileBaseName: filename.replace(/\.pdf$/i,'') });
      att.setField('title', title); await att.saveTx();
      fixture[key] = att.key; await persist();
    }
  }
  const source = itemFor(fixture.sourceKey);
  const translated = itemFor(fixture.translationKey);
  if (source.parentID !== parent.id || translated.parentID !== parent.id) throw new Error('Fixture attachment ownership mismatch.');
  if (!itemFor(fixture.seedKey)) {
    const key = Zotero.DataObjectUtilities.generateKey();
    const annotation = await Zotero.Annotations.saveFromJSON(source, {
      key, type: 'highlight', color: '#ffd400', pageLabel: '1', sortIndex: '00000|000100|00000',
      text: 'P1 existing native annotation', comment: '隔离测试：预置原生批注', tags: [{name:'P1-seed'}],
      position: {pageIndex:0, rects:[[72,675,310,691]]},
    });
    fixture.seedKey = annotation.key; await persist();
  }
  const win = Zotero.getMainWindow();
  const addon = win.DoubaoTranslate;
  if (!addon) throw new Error('Product development add-on is not installed.');
  addon.pair(source, translated);
  let reader = await Zotero.Reader.open(source.id);
  if (!reader) reader = await waitFor(() => Zotero.Reader._readers.find(r => r.itemID === source.id));
  await reader._initPromise;
  const native = await waitFor(() => reader._internalReader?._primaryView);
  // Background development windows are otherwise occluded and may suspend PDF painting.
  win.docShell.browsingContext.isActive = true;
  reader._updateDocShellActivity();
  await waitFor(() => reader._iframeWindow.document.querySelector('.toolbar'));
  const flushPaint = async () => {
    win.docShell.browsingContext.isActive=true;
    reader._updateDocShellActivity();
    const state=addon.states.get(reader.tabID);
    if(state){state.right.docShellIsActive=true;state.right.browsingContext.isActive=true;}
    const windows=[win,reader._iframeWindow,native._iframeWindow,state?.right.contentWindow,state?.rightInternal?._primaryView?._iframeWindow].filter(Boolean);
    const utils=[...new Set(windows.map(w=>Components.utils.unwaiveXrays(w).windowUtils).filter(Boolean))];
    const pdfWindows=[native._iframeWindow,state?.rightInternal?._primaryView?._iframeWindow].filter(Boolean);
    const pendingPages=()=>pdfWindows.flatMap((w,index)=>[...w.document.querySelectorAll('.page')].filter(p=>{const r=p.getBoundingClientRect();return r.width>0&&r.bottom>0&&r.top<w.innerHeight;}).filter(p=>p.classList.contains('loading')||!p.querySelector('.canvasWrapper canvas')).map(p=>({pane:index,page:p.dataset.pageNumber,loading:p.classList.contains('loading')})));
    let frames=0;
    try {
      const deadline=Date.now()+10000;
      while(Date.now()<deadline){for(const util of utils)util.advanceTimeAndRefresh(17);frames++;await pause(30);if(frames>=16&&!pendingPages().length)break;}
    } finally {for(const util of utils)util.restoreNormalRefresh();}
    return {frames,visiblePagesReady:pendingPages().length===0,pending:pendingPages()};
  };
  await flushPaint();
  progress='source-page-canvas';
  if (reader._iframe.style.display !== 'none' && !['render-debug','annotations-api','compare'].includes(ctx.action)) await waitFor(() => native._iframeWindow.document.querySelector('.page .canvasWrapper canvas'));
  await pause(500);
  const identity = { reader, browser: reader._iframe, internal: reader._internalReader, parent: reader._iframe.parentNode };
  const screenshot = async name => {
    const painting=await flushPaint();
    const canvas = win.document.createElementNS('http://www.w3.org/1999/xhtml','canvas');
    const context = win.browsingContext || win.docShell.browsingContext;
    const snapshot = await context.currentWindowGlobal.drawSnapshot(null,win.devicePixelRatio,'rgb(255,255,255)',false);
    canvas.width = snapshot.width; canvas.height = snapshot.height;
    canvas.getContext('2d').drawImage(snapshot,0,0);
    snapshot.close();
    const binary = win.atob(canvas.toDataURL('image/png').split(',')[1]);
    const output = PathUtils.join(ctx.runtime, name + '.png');
    await IOUtils.write(output,Uint8Array.from(binary,c => c.charCodeAt(0)));
    return { path: output, width: canvas.width, height: canvas.height, dpr: win.devicePixelRatio,method:'gecko-window-global-snapshot',painting,paint:'test refresh frames flushed; normal refresh restored; not used for timing benchmarks' };
  };
  const keys = object => { try { return Object.keys(object || {}); } catch { return []; } };
  if(ctx.action==='persistence'||ctx.action==='disable') {
    const checks={};
    const kept=itemFor(fixture.persistedKey);
    checks.databaseOriginalParent=kept?.parentID===source.id;
    checks.commentColorTags=kept?.annotationComment==='对照模式创建，重启后应保留'&&kept.annotationColor==='#5fb236'&&kept.hasTag('P1-persist');
    checks.loadedInNativeReader=reader._internalReader._annotationManager._annotations.some(a=>a.id===fixture.persistedKey);
    checks.noteBacklinks=itemFor(fixture.noteKey)?.getNote().includes(source.key)&&itemFor(fixture.noteKey)?.getNote().includes(fixture.persistedKey);
    await addon.setMode(reader,'compare');
    checks.hostPreserved=reader._iframe===identity.browser&&reader._internalReader===identity.internal;
    if(ctx.action==='disable'){
      const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
      const installed=await AddonManager.getAddonByID('doubao-translate@local.invalid');
      await installed.disable();
      checks.disabled=!(win.DoubaoTranslate)&&installed.userDisabled;
      checks.noPane=win.document.querySelectorAll('.doubao-translation-pane').length===0;
      checks.noButtons=reader._iframeWindow.document.querySelectorAll('.doubao-reading-modes').length===0;
      checks.nativeWritable=reader._isReadOnly()===false&&reader._internalReader._state.readOnly===false;
      checks.annotationPreserved=itemFor(fixture.persistedKey)?.parentID===source.id;
    }
    return {passed:Object.values(checks).every(Boolean),stage:ctx.action,checks,fixture,screenshot:await screenshot('p1-'+ctx.action)};
  }
  if(ctx.action==='all-tools-api') {
    await addon.setMode(reader,'compare');
    const manager=reader._internalReader._annotationManager;
    const checks={},created=[];
    for(const [i,type] of ['highlight','underline','note','text','image','ink'].entries()){
      const position=type==='ink'?{pageIndex:0,width:2,paths:[[75,500,90,515,105,500]]}:{pageIndex:0,rects:[[75,480-i*30,225,500-i*30]]};
      if(type==='text'){position.fontSize=12;position.rotation=0;}
      const data={type,color:'#ffd400',text:['highlight','underline'].includes(type)?'P1 '+type:'',comment:'P1 tool '+type,tags:[],pageLabel:'1',sortIndex:'00000|000'+(500+i*30)+'|00000',position};
      const annotation=manager.addAnnotation(Components.utils.cloneInto(data,reader._iframeWindow));
      created.push(annotation.id);progress='save-tool-'+type;
      await waitFor(()=>itemFor(annotation.id));
      checks[type]=itemFor(annotation.id).annotationType===type&&itemFor(annotation.id).parentID===source.id;
    }
    manager.deleteAnnotations(Components.utils.cloneInto(created,reader._iframeWindow));
    progress='delete-all-tools';await waitFor(()=>created.every(key=>!itemFor(key)));
    checks.deletedAll=created.every(key=>!itemFor(key));
    return {passed:Object.values(checks).every(Boolean),stage:'native_six_tool_save_delete',checks,limits:['Native manager and save callbacks tested; tool pointer gestures remain separate UI checks.']};
  }
  if(ctx.action==='close-reopen') {
    await addon.setMode(reader,'compare');
    const tabID=reader.tabID;
    reader.close();progress='close-native-tab';
    await waitFor(()=>!addon.states.has(tabID)&&!addon.hostWatches.has(tabID));
    const checks={closedPaneCleaned:!addon.states.has(tabID),closedToolbarCleaned:[...addon.buttons].every(group=>group.dataset.sourceTab!==tabID)};
    const reopened=await Zotero.Reader.open(source.id);await reopened._initPromise;
    checks.newNativeReader=reopened!==reader&&reopened._iframe!==identity.browser;
    checks.annotationLoaded=reopened._internalReader._annotationManager._annotations.some(a=>a.id===fixture.persistedKey);
    checks.originalParent=itemFor(fixture.persistedKey)?.parentID===source.id;
    return{passed:Object.values(checks).every(Boolean),stage:'native_close_reopen',checks,oldTabID:tabID,newTabID:reopened.tabID};
  }
  if(ctx.action==='save-failure') {
    await addon.setMode(reader,'compare');
    const internal=reader._internalReader;
    const key=Zotero.DataObjectUtilities.generateKey();
    const original=Zotero.Annotations.saveFromJSON;
    let thrown=false,settled=false;
    const expectedReadOnly=reader._isReadOnly();
    try{
      Zotero.Annotations.saveFromJSON=async function(attachment,json,...options){
        if(attachment.id===source.id&&(json.id===key||json.key===key))throw new Error('P1 injected save failure');
        return original.call(this,attachment,json,...options);
      };
      try{await internal._onSaveAnnotations(Components.utils.cloneInto([{id:key,type:'highlight',color:'#ffd400',pageLabel:'1',sortIndex:'00000|000560|00000',text:'P1 rejected save',position:{pageIndex:0,rects:[[75,510,250,526]]}}],reader._iframeWindow));settled=true;}
      catch(error){thrown=String(error).includes('P1 injected save failure');}
      await flushPaint();
      const checks={nativeErrorShown:reader._iframeWindow.document.body.textContent.includes('P1 injected save failure'),protectiveReadOnly:internal._state.readOnly===true,notFalselySaved:!itemFor(key),completionReleased:settled};
      return{passed:Object.values(checks).every(Boolean),stage:'native_save_failure',checks,screenshot:await screenshot('p1-save-failure')};
    }finally{Zotero.Annotations.saveFromJSON=original;internal.setReadOnly(expectedReadOnly);internal.setErrorMessage('');}
  }
  if(ctx.action==='mode-lifecycle') {
    const checks={};
    for(const panel of reader._popupset.querySelectorAll('panel'))panel.hidePopup();
    await addon.setMode(reader,'original');
    const sequence=Array.from({length:20},(_,i)=>['compare','translation','original'][i%3]);
    for(const mode of sequence)await addon.setMode(reader,mode);
    await addon.setMode(reader,'compare');
    const state=addon.states.get(reader.tabID),rect=state.divider.getBoundingClientRect();
    const utils=Components.utils.unwaiveXrays(win).windowUtils;
    utils.sendMouseEvent('mousedown',rect.x+2,rect.y+100,0,1,0);
    utils.sendMouseEvent('mousemove',rect.x+82,rect.y+100,0,0,0);
    utils.sendMouseEvent('mouseup',rect.x+82,rect.y+100,0,1,0);
    await pause(500);
    checks.twentySwitches=sequence.length===20;
    checks.singlePane=reader._tabContainer.querySelectorAll('.doubao-translation-pane').length===1;
    checks.dragResize=state.ratio>0.5&&state.ratio<0.8;
    checks.nativeHostPreserved=reader._iframe===identity.browser&&reader._internalReader===identity.internal&&reader._iframe.parentNode===identity.parent;
    const screenshots=[];
    for(const [width,height] of [[1280,800],[1600,1000]]){
      win.resizeTo(width,height);await pause(500);
      screenshots.push(await screenshot(`p1-layout-${width}x${height}`));
    }
    await Promise.all(['compare','original','translation','original'].map(mode=>addon.setMode(reader,mode)));
    checks.finalModeWins=addon.states.size===0;
    checks.noPaneAfterOriginal=reader._tabContainer.querySelectorAll('.doubao-translation-pane').length===0;
    checks.noQueueLeak=addon.modeQueues.size===0&&addon.modeRequests.size===0;
    return {passed:Object.values(checks).every(Boolean),stage:'mode_lifecycle',checks,ratio:state.ratio,sequence,screenshots,screenshot:await screenshot('p1-mode-restored')};
  }
  if(ctx.action==='native-edit'||ctx.action==='tags-panel') {
    await addon.setMode(reader,'compare');
    const internal=reader._internalReader,manager=internal._annotationManager,doc=reader._iframeWindow.document;
    const annotation=manager.addAnnotation(Components.utils.cloneInto({type:'highlight',color:'#ffd400',text:'P1 UI editing test',comment:'',pageLabel:'1',sortIndex:'00000|000520|00000',position:{pageIndex:0,rects:[[75,510,250,526]]}},reader._iframeWindow));
    progress='save-native-edit-fixture';await waitFor(()=>itemFor(annotation.id));
    internal.toggleSidebar(true);internal.setSidebarView('annotations');internal.setSelectedAnnotations(Components.utils.cloneInto([annotation.id],reader._iframeWindow));
    progress='native-comment-editor';
    const row=await waitFor(()=>doc.querySelector(`[data-sidebar-annotation-id="${annotation.id}"]`));
    const comment=await waitFor(()=>row.querySelector('.comment [contenteditable=true]'));
    comment.focus();doc.execCommand('insertText',false,'P1 UI comment saved');
    comment.blur();progress='native-ui-comment-save';await waitFor(()=>itemFor(annotation.id)?.annotationComment==='P1 UI comment saved');
    const tags=row.querySelector('button.tags');
    if(!tags)throw new Error('No native tags button');
    tags.click();progress='native-tags-panel';
    const panel=await waitFor(()=>reader._popupset.querySelector('.tags-popup'));
    const tagsbox=panel.querySelector('tags-box');
    await pause(500);
    let field=tagsbox.querySelector('editable-text');
    if(!field)field=tagsbox.newTag().querySelector('editable-text');
    field.focus();field.value='P1-ui-tag';
    field.dispatchEvent(new win.FocusEvent('blur'));
    progress='native-ui-tag-save';await waitFor(()=>itemFor(annotation.id)?.hasTag('P1-ui-tag'));
    const checks={commentSaved:true,tagSaved:true,nativePanelInvoked:['open','showing'].includes(panel.state)&&panel.getBoundingClientRect().width>0,originalParent:itemFor(annotation.id).parentID===source.id};
    const result={passed:Object.values(checks).every(Boolean),stage:'native_comment_tag_ui',checks,panel:{state:panel.state,rect:panel.getBoundingClientRect().toJSON()},screenshot:await screenshot('p1-native-edit')};
    if(ctx.action==='tags-panel')return result;
    panel.hidePopup();manager.deleteAnnotations(Components.utils.cloneInto([annotation.id],reader._iframeWindow));progress='delete-ui-edit-fixture';await waitFor(()=>!itemFor(annotation.id));
    return result;
  }
  if(ctx.action==='native-drop') {
    await addon.setMode(reader,'compare');
    const internal=reader._internalReader,manager=internal._annotationManager;
    const unique='P1 native drop '+ctx.nonce;
    const annotation=manager.addAnnotation(Components.utils.cloneInto({type:'highlight',color:'#ffd400',text:unique,comment:'测试拖入笔记',pageLabel:'1',sortIndex:'00000|000540|00000',position:{pageIndex:0,rects:[[75,510,250,526]]}},reader._iframeWindow));
    progress='save-drop-fixture';await waitFor(()=>itemFor(annotation.id));
    internal.toggleSidebar(true);internal.setSidebarView('annotations');internal.setSelectedAnnotations(Components.utils.cloneInto([annotation.id],reader._iframeWindow));
    const pane=win.ZoteroContextPane;
    pane.collapsed=false;pane.context.mode='notes';pane.context._selectNotesContext(fixture.libraryID);
    pane.context._getCurrentNotesContext()._setPinnedNote(itemFor(fixture.noteKey));
    progress='drop-native-editor';const editor=await waitFor(()=>pane.activeEditor?.getCurrentInstance());await editor._initPromise;
    const doc=reader._iframeWindow.document;
    const row=await waitFor(()=>doc.querySelector(`[data-sidebar-annotation-id="${annotation.id}"]`));
    const draggable=row.querySelector('[draggable=true]');
    if(!draggable)throw new Error('No native draggable annotation element');
    const transfer=new reader._iframeWindow.DataTransfer();const rect=draggable.getBoundingClientRect();
    const errors=[];const onError=event=>errors.push({message:event.message,stack:event.error?.stack});reader._iframeWindow.addEventListener('error',onError);
    draggable.dispatchEvent(new reader._iframeWindow.DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:rect.x+5,clientY:rect.y+5}));
    reader._iframeWindow.removeEventListener('error',onError);
    if(!transfer.getData('zotero/annotation'))return{passed:false,stage:'native_drag_diagnostic',types:[...transfer.types],errors,draggable:draggable.outerHTML.slice(0,3000),row:row.outerHTML.slice(0,1200)};
    const serialized=JSON.parse(transfer.getData('zotero/annotation'));
    const targetWindow=editor._iframeWindow;
    const target=await waitFor(()=>targetWindow.document.querySelector('.ProseMirror'));
    const targetRect=target.getBoundingClientRect();
    const drop=new targetWindow.DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:targetRect.x+10,clientY:targetRect.y+10});
    target.dispatchEvent(drop);
    progress='save-native-drop-note';await waitFor(()=>itemFor(fixture.noteKey).getNote().includes(unique));
    const noteHTML=itemFor(fixture.noteKey).getNote();
    const checks={nativeDragSerialized:serialized.some(a=>a.id===annotation.id&&a.attachmentItemID===source.id),nativeEditorSaved:noteHTML.includes(unique),originalBacklink:noteHTML.includes(source.key),annotationBacklink:noteHTML.includes(annotation.id)};
    return{passed:Object.values(checks).every(Boolean),stage:'native_dom_drag_drop',checks,eventTrusted:drop.isTrusted,annotationKey:annotation.id,screenshot:await screenshot('p1-native-drop'),limits:['Native source dragstart and note editor drop handlers exercised with DOM drag events; operating-system pointer drag gesture not covered.']};
  }
  if(['pointer-tools','pointer-tools-original','text-pointer'].includes(ctx.action)) {
    await addon.setMode(reader,ctx.action==='pointer-tools-original'?'original':'compare');
    const doc=reader._iframeWindow.document,pdf=native._iframeWindow;
    doc.querySelector('.context-menu button')?.click();
    const manager=reader._internalReader._annotationManager,utils=Components.utils.unwaiveXrays(pdf).windowUtils;
    const checks={},results=[];
    for(const [selector,type] of [['highlight','highlight'],['underline','underline'],['note','note'],['text','text'],['area','image'],['ink','ink']]){
      if(ctx.action==='text-pointer'&&type!=='text')continue;
      reader._internalReader.setSelectedAnnotations(Components.utils.cloneInto([],reader._iframeWindow));
      const button=doc.querySelector('.toolbar .'+selector);
      if(!button.classList.contains('active'))button.click();
      await flushPaint();
      const span=[...pdf.document.querySelectorAll('.page[data-page-number="1"] .textLayer span')].find(el=>el.textContent.includes('World-Action Models'));
      const rect=span.getBoundingClientRect();
      const page=pdf.document.querySelector('.page[data-page-number="1"]').getBoundingClientRect();
      const before=new Set(manager._annotations.map(a=>a.id));
      const start=['highlight','underline'].includes(type)?{x:rect.x+2,y:rect.y+rect.height/2}:type==='text'?{x:page.right-40,y:Math.min(page.bottom-35,pdf.innerHeight-50)}:{x:page.x+15,y:page.y+90};
      const finish=['highlight','underline'].includes(type)?{x:rect.right-2,y:start.y}:{x:start.x+70,y:start.y+30};
      utils.sendMouseEvent('mousedown',start.x,start.y,0,1,0);
      if(!['note','text'].includes(type))for(let i=1;i<=10;i++){utils.sendMouseEvent('mousemove',start.x+(finish.x-start.x)*i/10,start.y+(finish.y-start.y)*i/10,0,0,0);await pause(20);}
      utils.sendMouseEvent('mouseup',['note','text'].includes(type)?start.x:finish.x,['note','text'].includes(type)?start.y:finish.y,0,1,0);
      await pause(400);
      if(type==='text'){
        const editables=[...pdf.document.querySelectorAll('textarea,[contenteditable=true]'),...doc.querySelectorAll('textarea,[contenteditable=true]')];
        const textarea=pdf.document.querySelector('textarea.textAnnotation');
        if(textarea){textarea.value='P1 native pointer text';textarea.dispatchEvent(new pdf.InputEvent('input',{bubbles:true,inputType:'insertText',data:'P1 native pointer text'}));textarea.blur();await pause(400);}
        if(ctx.action==='text-pointer')return{passed:true,stage:'debug_text_input',tool:reader._internalReader._state.tool,editables:editables.map(el=>({html:el.outerHTML.slice(0,2000),rect:el.getBoundingClientRect().toJSON()})),screenshot:await screenshot('p1-text-input')};
      }
      const added=manager._annotations.filter(a=>!before.has(a.id));
      for(const annotation of added){progress='save-pointer-'+type;await waitFor(()=>itemFor(annotation.id));}
      checks[type]=added.some(a=>a.type===type&&itemFor(a.id)?.parentID===source.id);
      results.push({type,created:added.map(a=>({id:a.id,type:a.type,text:a.text}))});
      if(added.length){manager.deleteAnnotations(Components.utils.cloneInto(added.map(a=>a.id),reader._iframeWindow));progress='delete-pointer-'+type;await waitFor(()=>added.every(a=>!itemFor(a.id)));}
    }
    return{passed:Object.values(checks).every(Boolean),stage:'native_engine_pointer_six_tools',checks,results,screenshot:await screenshot('p1-pointer-tools')};
  }
  if(ctx.action==='native-pointer') {
    await addon.setMode(reader,'compare');
    const doc=reader._iframeWindow.document,pdf=native._iframeWindow;
    doc.querySelector('.context-menu button')?.click();
    await pause(250);
    const tool=doc.querySelector('.toolbar .highlight');
    if(!tool.classList.contains('active'))tool.click();
    await flushPaint();
    const span=[...pdf.document.querySelectorAll('.page[data-page-number="1"] .textLayer span')].find(el=>el.textContent.includes('World-Action Models'));
    if(!span)throw new Error('No source text span for native pointer test');
    const rect=span.getBoundingClientRect(),utils=Components.utils.unwaiveXrays(pdf).windowUtils;
    const manager=reader._internalReader._annotationManager,before=new Set(manager._annotations.map(a=>a.id));
    const events=[];const capture=e=>events.push({type:e.type,trusted:e.isTrusted});
    pdf.document.addEventListener('pointerup',capture);
    const x=rect.x+2,y=rect.y+rect.height/2;
    utils.sendMouseEvent('mousedown',x,y,0,1,0);
    for(let i=1;i<=10;i++){utils.sendMouseEvent('mousemove',x+(rect.width-4)*i/10,y,0,0,0);await pause(25);}
    utils.sendMouseEvent('mouseup',rect.right-2,y,0,1,0);
    await pause(500);pdf.document.removeEventListener('pointerup',capture);
    const added=manager._annotations.filter(a=>!before.has(a.id));
    for(const annotation of added){progress='native-pointer-save';await waitFor(()=>itemFor(annotation.id));}
    const checks={trustedPointerUp:events.some(e=>e.trusted),nativeHighlightCreated:added.some(a=>a.type==='highlight'&&a.text.includes('World-Action')),originalParent:added.length>0&&added.every(a=>itemFor(a.id)?.parentID===source.id)};
    const result={passed:Object.values(checks).every(Boolean),stage:'trusted_engine_pointer_highlight',checks,events,selection:String(pdf.getSelection()),span:span.textContent,rect:rect.toJSON(),added:added.map(a=>({id:a.id,type:a.type,text:a.text})),screenshot:await screenshot('p1-native-pointer')};
    if(added.length){manager.deleteAnnotations(Components.utils.cloneInto(added.map(a=>a.id),reader._iframeWindow));progress='delete-pointer-fixture';await waitFor(()=>added.every(a=>!itemFor(a.id)));}
    return result;
  }
  if(ctx.action==='native-popup') {
    await addon.setMode(reader,'compare');
    const doc=reader._iframeWindow.document;
    doc.querySelector('.toolbar .highlight').click();
    await pause(300);
    const color=doc.querySelector('.toolbar .toolbar-dropdown-button');
    const rect=color.getBoundingClientRect();
    const events=[];
    const observe=e=>events.push({type:e.type,trusted:e.isTrusted});
    for(const type of ['mousedown','mouseup','click','pointerdown'])color.addEventListener(type,observe);
    const utils=Components.utils.unwaiveXrays(reader._iframeWindow).windowUtils;
    utils.sendMouseEvent('mousedown',rect.x+rect.width/2,rect.y+rect.height/2,0,1,0);
    utils.sendMouseEvent('mouseup',rect.x+rect.width/2,rect.y+rect.height/2,0,1,0);
    await pause(600);
    for(const type of ['mousedown','mouseup','click','pointerdown'])color.removeEventListener(type,observe);
    const popup=[...doc.querySelectorAll('[role="menu"],.popup,.context-menu,.color-picker')].map(el=>({class:el.className,text:el.textContent.slice(0,150),html:el.outerHTML.slice(0,2000),rect:el.getBoundingClientRect().toJSON()}));
    return {passed:true,stage:'native_color_popup_observation',button:color.outerHTML,events,popup,mainPopups:[...win.document.querySelectorAll('menupopup,panel')].filter(el=>el.state==='open').map(el=>({id:el.id,html:el.outerHTML.slice(0,4000)})),screenshot:await screenshot('p1-native-color-popup')};
  }
  if(ctx.action==='permissions'){
    const checks={};
    let external=itemFor(fixture.externalKey);
    if(!external){external=await Zotero.Annotations.saveFromJSON(source,{key:Zotero.DataObjectUtilities.generateKey(),type:'highlight',isExternal:true,color:'#ff6666',text:'P1 external read-only annotation',comment:'只读批注不应被修改',pageLabel:'1',sortIndex:'00000|000400|00000',position:{pageIndex:0,rects:[[75,560,250,577]]}});fixture.externalKey=external.key;await persist();}
    const manager=reader._internalReader._annotationManager;
    progress='external-annotation-notification';
    await waitFor(()=>manager._annotations.find(a=>a.id===external.key)?.readOnly);
    let rejected=false;
    try{manager.updateAnnotations(Components.utils.cloneInto([{id:external.key,comment:'should not save'}],reader._iframeWindow));}catch(error){rejected=String(error).includes('read-only');}
    checks.externalAnnotationRejected=rejected&&external.annotationComment==='只读批注不应被修改';
    let group=fixture.permissionGroupID?Zotero.Groups.get(fixture.permissionGroupID):null;
    if(!group){group=new Zotero.Group({groupID:91000000+Math.floor(Math.random()*1000000),name:'[DEV] Read-only permission fixture',description:'Local offline permission test only',version:0,editable:true,filesEditable:true});await group.saveTx();fixture.permissionGroupID=group.groupID;await persist();}
    const groupItem=key=>key?Zotero.Items.getByLibraryAndKey(group.libraryID,key):null;
    if(!groupItem(fixture.permissionSourceKey)||!groupItem(fixture.permissionTranslationKey)){
      group.editable=true;group.filesEditable=true;await group.saveTx();
      let groupParent=groupItem(fixture.permissionParentKey);
      if(!groupParent){groupParent=new Zotero.Item('journalArticle');groupParent.libraryID=group.libraryID;groupParent.setField('title','[DEV] Read-only native reader test');await groupParent.saveTx();fixture.permissionParentKey=groupParent.key;await persist();}
      for(const field of ['permissionSourceKey','permissionTranslationKey']){
        if(!groupItem(fixture[field])){const att=await Zotero.Attachments.importFromFile({file:Zotero.File.pathToFile(PathUtils.join(ctx.root,'fixtures','public','doubao-19p','world-action-models.original.pdf')),libraryID:group.libraryID,parentItemID:groupParent.id});fixture[field]=att.key;await persist();}
      }
    }
    group.editable=false;group.filesEditable=false;await group.saveTx();
    const permissionSource=groupItem(fixture.permissionSourceKey),permissionTranslation=groupItem(fixture.permissionTranslationKey);
    addon.pair(permissionSource,permissionTranslation);
    const permissionReader=await Zotero.Reader.open(permissionSource.id);
    await permissionReader._initPromise;
    const beforeReadonly=permissionReader._isReadOnly();
    await addon.setMode(permissionReader,'compare');
    checks.readOnlyLibraryPreserved=beforeReadonly===true&&permissionReader._isReadOnly()===true&&permissionReader._internalReader._state.readOnly===true;
    checks.readOnlyCreateRejected=permissionReader._internalReader._annotationManager.addAnnotation(Components.utils.cloneInto({},permissionReader._iframeWindow))===null;
    await Zotero.Reader.open(source.id);
    checks.originalStillEditable=reader._isReadOnly()===false;
    return{passed:Object.values(checks).every(Boolean),stage:'native_permission_checks',checks,fixture,groupLibraryID:group.libraryID,groupEditable:group.editable,groupFilesEditable:group.filesEditable,screenshot:await screenshot('p1-permissions')};
  }
  if(ctx.action==='note'){
    if(!fixture.persistedKey)throw new Error('Run annotations-api first.');
    await addon.setMode(reader,'compare');
    win.resizeTo(1600,1000);
    let note=itemFor(fixture.noteKey);
    if(!note){note=new Zotero.Item('note');note.libraryID=fixture.libraryID;note.parentID=parent.id;note.setNote('<p>P1 native note insertion</p>');await note.saveTx();fixture.noteKey=note.key;await persist();}
    const pane=win.ZoteroContextPane;
    pane.collapsed=false;pane.context.mode='notes';pane.context._selectNotesContext(fixture.libraryID);
    pane.context._getCurrentNotesContext()._setPinnedNote(note);
    progress='native-note-editor';
    const editor=await waitFor(()=>pane.activeEditor?.getCurrentInstance());
    if(editor._initPromise)await editor._initPromise;
    await pause(500);
    const json=reader._internalReader._annotationManager._annotations.find(a=>a.id===fixture.persistedKey);
    reader._internalReader._onAddToNote([json]);
    progress='native-note-save';
    await waitFor(()=>note.getNote().includes('P1 persistence check'));
    const checks={nativeNoteSaved:true,noteLinksOriginal:note.getNote().includes(source.key),noteLinksAnnotation:note.getNote().includes(fixture.persistedKey),nativeHostPreserved:reader._iframe===identity.browser&&reader._internalReader===identity.internal};
    return {passed:Object.values(checks).every(Boolean),stage:'native_note_insertion',checks,fixture,
      editorKeys:keys(editor),editorDOMKeys:keys(pane.activeEditor),
      noteHTML:note.getNote(),screenshot:await screenshot('p1-note')};
  }
  if (ctx.action === 'annotations-api') {
    progress='compare-reader';
    await addon.setMode(reader,'compare');
    const internal=reader._internalReader;
    const manager=internal._annotationManager;
    const toReader=value=>Components.utils.cloneInto(value,reader._iframeWindow);
    const callbacks=Object.fromEntries(['_onSaveAnnotations','_onDeleteAnnotations','_onOpenTagsPopup','_onAddToNote','_onSetDataTransferAnnotations'].map(k=>[k,internal[k]]));
    const checks={existingAnnotations:manager._annotations.some(a=>a.id===fixture.seedKey),existingPositionUnchanged:JSON.stringify(JSON.parse(itemFor(fixture.seedKey).annotationPosition))===JSON.stringify({pageIndex:0,rects:[[72,675,310,691]]})};
    const annotation=manager.addAnnotation(toReader({type:'highlight',color:'#ffd400',text:'P1 native save path',comment:'创建后保存',tags:[],pageLabel:'1',sortIndex:'00000|000200|00000',position:{pageIndex:0,rects:[[75,620,250,636]]}}));
    if (!annotation?.id) throw new Error('Native annotation manager refused creation.');
    progress=`save-created-annotation:${annotation.id}`;
    await waitFor(()=>itemFor(annotation.id));
    checks.createdInOriginal=itemFor(annotation.id).parentID===source.id;
    manager.updateAnnotations(toReader([{id:annotation.id,color:'#a28ae5',comment:'已通过原生回调编辑',tags:[{name:'P1-native-edit'}]}]));
    progress='save-comment-tags-color';
    await waitFor(()=>itemFor(annotation.id)?.annotationComment==='已通过原生回调编辑'&&itemFor(annotation.id)?.hasTag('P1-native-edit'));
    checks.updatedCommentTagsColor=itemFor(annotation.id).annotationColor==='#a28ae5';
    manager.deleteAnnotations(toReader([annotation.id]));
    progress='delete-annotation';
    await waitFor(()=>!itemFor(annotation.id));
    checks.deletedFromDatabase=!source.getAnnotations().some(a=>a.key===annotation.id);
    let kept=itemFor(fixture.persistedKey);
    if(!kept){
      const annotation=manager.addAnnotation(toReader({type:'highlight',color:'#5fb236',text:'P1 persistence check',comment:'对照模式创建，重启后应保留',tags:[{name:'P1-persist'}],pageLabel:'1',sortIndex:'00000|000300|00000',position:{pageIndex:0,rects:[[75,590,250,607]]}}));
      progress='save-persistent-annotation';
      await waitFor(()=>itemFor(annotation.id)); fixture.persistedKey=annotation.id;await persist();kept=itemFor(annotation.id);
    }
    checks.retainedOriginalParent=kept.parentID===source.id;
    checks.nativeCallbacksPreserved=Object.entries(callbacks).every(([k,fn])=>internal[k]===fn);
    checks.nativeHostPreserved=reader._iframe===identity.browser&&reader._internalReader===identity.internal&&reader._iframe.parentNode===identity.parent;
    const dataTransfer=new win.DataTransfer();
    const json=manager._annotations.find(a=>a.id===fixture.persistedKey);
    internal._onSetDataTransferAnnotations(dataTransfer,[json],false);
    const serialized=JSON.parse(dataTransfer.getData('zotero/annotation'));
    checks.dragSerializationOriginalIdentity=serialized[0].attachmentItemID===source.id;
    checks.copyRichText=dataTransfer.getData('text/html').length>0&&dataTransfer.getData('text/plain').length>0;
    internal.setSelectedAnnotations(toReader([fixture.persistedKey]));
    internal.toggleSidebar(true);internal.setSidebarView('annotations');
    await pause(500);
    return {passed:Object.values(checks).every(Boolean),stage:'native_api_checks',checks,fixture,annotationCount:source.getAnnotations().length,
      clipboardMimeTypes:[...dataTransfer.types],screenshot:await screenshot('p1-native-annotations'),
      limits:['Copy/drag checks cover the native serialization callback; a complete pointer drag into the note editor is not yet tested.']};
  }
  if (ctx.action === 'right-debug') {
    await addon.setMode(reader,'compare');
    const state=addon.states.get(reader.tabID),view=state.rightInternal._primaryView;
    await pause(2500);
    return {passed:true,stage:'debug_only',errors:state.errors,initialized:view.initialized,
      state:view._viewState,visibility:view._iframeWindow.document.visibilityState,
      pages:view._iframeWindow.PDFViewerApplication.pdfViewer._pages.slice(0,2).map(p=>({state:p.renderingState,canvas:!!p.canvas,task:!!p.renderTask,html:p.div.innerHTML.slice(0,900)})),
      screenshot:await screenshot('p1-right-debug')};
  }
  if (ctx.action === 'render-debug') {
    const pdfDoc=native._iframeWindow.document;
    const before={main:win.document.visibilityState,reader:reader._iframeWindow.document.visibilityState,pdf:pdfDoc.visibilityState,docShell:reader._iframe.docShellIsActive};
    const activation=[];
    for (const [label,fn] of [['root-context',()=>{win.docShell.browsingContext.isActive=true}],['source-browser',()=>{reader._iframe.docShellIsActive=true}],['native-update',()=>reader._updateDocShellActivity()]]) {
      try { fn();activation.push({label,ok:true}); } catch(error) {activation.push({label,ok:false,error:String(error)})}
    }
    try {
      const innerUtils=Components.utils.unwaiveXrays(native._iframeWindow).windowUtils;
      for (let i=0;i<8;i++) {
        win.windowUtils.advanceTimeAndRefresh(17);
        innerUtils?.advanceTimeAndRefresh(17);
        await pause(70);
      }
      innerUtils?.restoreNormalRefresh();
    } finally { win.windowUtils.restoreNormalRefresh(); }
    await pause(1500);
    return {passed:true,stage:'debug_only', visibility: {main:win.document.visibilityState,reader:reader._iframeWindow.document.visibilityState,pdf:pdfDoc.visibilityState,docShell:reader._iframe.docShellIsActive},
      before,activation,windowState:win.windowState,selectedTab:win.Zotero_Tabs.selectedID,readerTab:reader.tabID,
      canvases:[...pdfDoc.querySelectorAll('canvas')].slice(0,8).map(c=>({width:c.width,height:c.height,rect:c.getBoundingClientRect().toJSON()})),
      pages:[...pdfDoc.querySelectorAll('.page')].slice(0,3).map(p=>({class:p.className,style:p.getAttribute('style'),text:p.textContent.slice(0,160),html:p.innerHTML.slice(0,2000)})),
      rendererProcessing:native._pdfRenderer._processing,rendererLast:native._pdfRenderer._lastRendered, refreshPending:win.windowUtils.refreshDriverHasPendingTick,
      pdfState:{windowUtils:!!Components.utils.unwaiveXrays(native._iframeWindow).windowUtils,views:native._iframeWindow.PDFViewerApplication.pdfViewer._pages.slice(0,2).map(p=>({renderingState:p.renderingState,task:!!p.renderTask,raf:p.renderTask?._internalRenderTask?._rAF,taskRunning:p.renderTask?._internalRenderTask?.running,paused:p.renderTask?._internalRenderTask?.graphicsReady})),visible:native._iframeWindow.PDFViewerApplication.pdfViewer._getVisiblePages().views.map(p=>p.id)},
      nativePageKeys:keys(native._pages?.[0]),rendererKeys:keys(native._pdfRenderer),
    };
  }
  if (ctx.action === 'annotations-debug') {
    const manager = reader._internalReader._annotationManager;
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(manager));
    const internalMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(reader._internalReader));
    if (!reader._internalReader._state.sidebarOpen) reader._iframeWindow.document.querySelector('#sidebarToggle')?.click();
    await pause(700);
    return {passed:true,stage:'debug_only',methods,internalMethods,
      add: String(manager.addAnnotation).slice(0,7000),update:String(manager.updateAnnotations).slice(0,6500),
      sidebarText:reader._iframeWindow.document.querySelector('.sidebar')?.textContent?.slice(0,2500),
      state: {readOnly:reader._internalReader._state.readOnly,sidebarOpen:reader._internalReader._state.sidebarOpen},
      sidebarWidth:reader._internalReader._state.sidebarWidth,
      sidebarGeometry:[reader._iframeWindow.document.querySelector('#sidebarContainer'),reader._iframeWindow.document.querySelector('#sidebarContent')].filter(Boolean).map(el=>{const s=reader._iframeWindow.getComputedStyle(el);return{id:el.id,rect:el.getBoundingClientRect().toJSON(),display:s.display,visibility:s.visibility,zIndex:s.zIndex,left:s.left,top:s.top,position:s.position}}),
      body:reader._iframeWindow.document.body.innerHTML.replace(/<svg[\s\S]*?<\/svg>/g,'<svg/>').slice(0,12000),
      outerSidebars:[...win.document.querySelectorAll('[id*="sidebar"]')].slice(0,25).map(el=>({id:el.id,hidden:el.hidden,rect:el.getBoundingClientRect().toJSON()})),
    };
  }
  if (ctx.action === 'layout-debug') {
    const doc = reader._iframeWindow.document;
    const toolbar = doc.querySelector('.toolbar');
    const elements = [toolbar,...toolbar.children];
    const state = addon.states.get(reader.tabID);
    return {passed:true, stage:'debug_only', toolbar:toolbar.outerHTML.slice(0,18000),
      style:elements.map(el => { const s=doc.defaultView.getComputedStyle(el);return {class:el.className,rect:el.getBoundingClientRect().toJSON(),display:s.display,position:s.position,flex:s.flex,minWidth:s.minWidth,color:s.color,background:s.backgroundColor}; }),
      structure: [...doc.body.querySelectorAll(':scope > *, .reader > *, .split-view > *')].slice(0,18).map(el => ({tag:el.tagName,id:el.id,class:el.className,rect:el.getBoundingClientRect().toJSON()})),
      css: [...doc.styleSheets].flatMap(sheet => {try{return [...sheet.cssRules].filter(rule => /toolbar|split-view|primary-view/.test(rule.selectorText || '')).slice(0,18).map(rule => rule.cssText);}catch{return []}}).slice(0,28),
      primaryKeys:keys(native), annotationManagerKeys:keys(reader._internalReader._annotationManager),
      rendering: {sourceSuspended:reader._internalReader._suspended,viewSuspended:native._suspended,pages:native._pages?.length,viewFrame:native._iframe?.getBoundingClientRect().toJSON(),viewContainer:native._container?.getBoundingClientRect().toJSON(),sourceViewer:native._iframeWindow?.document.querySelector('#viewerContainer')?.getBoundingClientRect().toJSON(),rightSuspended:state?.rightInternal?._suspended,rightPages:state?.rightInternal?._primaryView?._pages?.length},
      rightPrimaryKeys:keys(state?.rightInternal?._primaryView),
      rightPageMarkup:state?.rightInternal?._primaryView?._iframeWindow.document.querySelector('.page')?.innerHTML.slice(0,2500),
    };
  }
  if (ctx.action === 'inspect') {
    return {
      passed: true, stage: 'inspection_only', fixture,
      nativeHost: { tabID: reader.tabID, itemID: reader.itemID, isReadOnly: reader._isReadOnly(), browserParentTag: reader._iframe.parentNode.tagName },
      internalKeys: keys(reader._internalReader), primaryKeys: keys(native),
      nativeAnnotations: keys(reader._internalReader._annotationManager),
      buttons: [...reader._iframeWindow.document.querySelectorAll('button')].slice(0,70).map(b => ({title:b.title,label:b.getAttribute('aria-label'),text:b.textContent?.slice(0,35),class:b.className})),
      screenshot: await screenshot('p1-original'),
    };
  }
  if (ctx.action === 'compare') {
    await addon.setMode(reader, 'compare');
    await pause(3000);
    const state = addon.states.get(reader.tabID);
    const rightWin = state.right.contentWindow.wrappedJSObject;
    return {
      passed: true, stage: 'comparison_layout_only', fixture,
      identity: {sameReader:Zotero.Reader.getByTabID(reader.tabID)===identity.reader,sameBrowser:reader._iframe===identity.browser,sameInternal:reader._internalReader===identity.internal,sameParent:reader._iframe.parentNode===identity.parent},
      sourceReadOnly: reader._isReadOnly(),
      sourceBounds: reader._iframe.getBoundingClientRect().toJSON(), rightBounds: state.right.getBoundingClientRect().toJSON(),
      rightKeys: keys(rightWin._reader), sourceAnnotationCount: reader._internalReader._annotationManager?._annotations?.length,
      visibility:{main:win.document.visibilityState,source:reader._iframeWindow.document.visibilityState,sourceActive:reader._iframe.docShellIsActive,right:state.right.contentDocument.visibilityState,rightActive:state.right.docShellIsActive,rightPDF:state.rightInternal._primaryView._iframeWindow.document.visibilityState},
      canvasCounts:{source:native._iframeWindow.document.querySelectorAll('.page canvas').length,right:state.rightInternal._primaryView._iframeWindow.document.querySelectorAll('.page canvas').length},
      screenshot: await screenshot('p1-compare'),
    };
  }
  if (ctx.action === 'restore') {
    await addon.setMode(reader,'original'); await pause(1000);
    return {passed:true, sourceReadOnly:reader._isReadOnly(), remainingPanes:win.document.querySelectorAll('.doubao-translation-pane').length, screenshot:await screenshot('p1-restored')};
  }
  throw new Error('Unknown P1 scenario');
};
