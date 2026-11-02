/* Test-only compositor preparation for an occluded development window.
 * Timed warm switches and scroll measurements run with normal refresh. */
var withNativePdfStartup=async function(addon,ctx,work){
 if(!addon)return work();
 const ready=addon.waitFor;let preparations=0;
 addon.waitFor=async function(check,state,timeout){
  if(!String(check).includes('pdfReady'))return ready.call(this,check,state,timeout);
  const windows=[Zotero.getMainWindow(),state.reader._iframeWindow,state.reader._internalReader._primaryView._iframeWindow,state.right.contentWindow,state.rightInternal._primaryView._iframeWindow];
  const utils=windows.map(w=>Components.utils.unwaiveXrays(w).windowUtils);
  const tick=()=>{for(const u of utils){try{u.advanceTimeAndRefresh(17);}catch{}}};tick();preparations++;
  const timer=ctx.timers.setInterval(tick,17);
  const stop=()=>{ctx.timers.clearInterval(timer);for(const u of utils){try{u.restoreNormalRefresh();}catch{}}};
  ctx.signal.addEventListener('abort',stop,{once:true});
  try{return await ready.call(this,check,state,timeout);}finally{ctx.signal.removeEventListener('abort',stop);stop();}
 };
 try{return{...await work(),readiness:{refreshPreparations:preparations,coldInitUsesTestRefresh:preparations>0,warmSwitchTimingUsesNormalClocks:true}};}
 finally{addon.waitFor=ready;}
};
