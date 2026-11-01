/* SPDX-License-Identifier: AGPL-3.0-only */
var DoubaoScrollMath = {
  anchor(metrics) {
    if (!metrics?.pages?.length || metrics.clientHeight <= 0) return null;
    const y=metrics.scrollTop;
    let index=0;
    for(let i=1;i<metrics.pages.length;i++){
      if(metrics.pages[i].top>y)break;
      index=i;
    }
    const page=metrics.pages[index];
    if(!Number.isFinite(page.height)||page.height<=0)return null;
    return {pageIndex:index,fraction:(y-page.top)/page.height};
  },
  target(anchor,metrics) {
    if(!anchor||!metrics?.pages?.length||metrics.clientHeight<=0)return null;
    const page=metrics.pages[anchor.pageIndex];
    if(!page||page.height<=0)return null;
    const desired=page.top+anchor.fraction*page.height;
    const maximum=Math.max(0,metrics.scrollHeight-metrics.clientHeight);
    const top=Math.max(0,Math.min(maximum,desired));
    return {top,desired,clamped:Math.abs(top-desired)>0.5};
  },
  distance(a,b) {return a&&b?Math.abs((a.pageIndex+a.fraction)-(b.pageIndex+b.fraction)):Infinity;}
};

var DoubaoScrollSync = class {
  constructor({left,right,timers,onState,onNavigate}) {
    this.views={left,right};this.timers=timers;this.onState=onState||(()=>{});this.onNavigate=onNavigate||(()=>{});
    this.enabled=true;this.disposed=false;this.leader='left';this.pending=null;this.timer=null;this.expected={};this.cleanup=[];
    this.stats={applies:0,suppressed:0,clamped:0,samples:[]};
    this.lastObserved={left:left.viewer.scrollTop,right:right.viewer.scrollTop};
    const listen=(target,type,callback,options)=>{target.addEventListener(type,callback,options);this.cleanup.push(()=>target.removeEventListener(type,callback,options));};
    for(const [side,view] of Object.entries(this.views)){
      listen(view.viewer,'scroll',()=>this.onScroll(side),{passive:true});
      const intent=()=>{
        this.leader=side;this.intentSide=side;this.intentUntil=Date.now()+150;delete this.expected[side];
        if(this.pending?.side!==side){
          if(this.timer!==null)this.timers.clearTimeout(this.timer);
          this.timer=null;this.pending=null;
        }
      };
      for(const doc of new Set([view.window.document,view.outerDocument].filter(Boolean))) {
        for(const type of ['wheel','keydown','touchstart'])listen(doc,type,intent,{capture:true,passive:true});
        listen(doc,'pointerdown',()=>{intent();this.pointerSide=side;},{capture:true,passive:true});
        for(const type of ['pointerup','pointercancel','dragend'])listen(doc,type,()=>{this.pointerSide=null;},{capture:true,passive:true});
      }
      // A selection may be dropped into the outer Zotero note pane, outside the
      // PDF document that received pointerdown. Release the gesture there too.
      const outer=view.host?.ownerDocument;
      if(outer){
        for(const type of ['pointerup','pointercancel','mouseup','dragend'])listen(outer,type,()=>{this.pointerSide=null;},{capture:true,passive:true});
        listen(outer.defaultView,'blur',()=>{this.pointerSide=null;},{capture:true,passive:true});
      }
      const Observer=view.window.ResizeObserver;
      if(Observer){
        const observer=new Observer(()=>this.schedule(this.leader,'resize'));
        observer.observe(view.viewer);
        // Fit-width can resize PDF pages after the container itself has settled.
        const pages=view.window.document.getElementById('viewer');
        if(pages)observer.observe(pages);
        const first=view.window.document.querySelector('.page');if(first)observer.observe(first);
        this.cleanup.push(()=>observer.disconnect());
      }
    }
    // Background Gecko documents can defer scroll events. Poll only two numeric
    // offsets; full page geometry is read only when an offset actually changes.
    this.poll=this.timers.setInterval(()=>{
      if(this.disposed||!this.enabled)return;
      for(const side of ['left','right'])if(Math.abs(this.views[side].viewer.scrollTop-this.lastObserved[side])>0.25)this.onScroll(side);
    },24);
    this.notify();
  }
  metrics(side) {
    const view=this.views[side],viewer=view.viewer;
    view.host?.getBoundingClientRect();
    view.outerDocument?.documentElement.getBoundingClientRect();
    const rect=viewer.getBoundingClientRect();
    const pages=[...view.window.document.querySelectorAll('.page')].map(page=>{
      let top=0,node=page;
      while(node&&node!==viewer){top+=node.offsetTop;node=node.offsetParent;}
      return{top,height:page.offsetHeight||page.getBoundingClientRect().height};
    });
    return{pages,scrollTop:viewer.scrollTop,clientHeight:Math.max(viewer.clientHeight,rect.height),scrollHeight:viewer.scrollHeight};
  }
  anchor(side) {return DoubaoScrollMath.anchor(this.metrics(side));}
  compatible() {
    const a=this.metrics('left'),b=this.metrics('right');
    return a.pages.length>0&&a.pages.length===b.pages.length&&[a,b].every(m=>m.pages.every((p,i)=>i===0||p.top>m.pages[i-1].top));
  }
  notify() {this.onState({enabled:this.enabled,compatible:this.compatible(),leader:this.leader,reason:this.metrics('left').pages.length!==this.metrics('right').pages.length?'page-count':'layout'});}
  onScroll(side) {
    if(this.disposed)return;
    const top=this.views[side].viewer.scrollTop,expected=this.expected[side];
    if(Math.abs(top-this.lastObserved[side])<0.25)return;
    this.lastObserved[side]=top;
    if(expected&&Date.now()<expected.until&&Math.abs(top-expected.top)<2){this.stats.suppressed++;return;}
    if(this.pointerSide&&this.pointerSide!==side)return;
    if(this.intentSide&&side!==this.intentSide&&Date.now()<this.intentUntil)return;
    const anchor=this.anchor(side);if(anchor)this.onNavigate(side,anchor);
    this.leader=side;
    this.schedule(side,'scroll');
  }
  schedule(side,reason='scroll') {
    if(!this.enabled||this.disposed)return;
    this.pending={side,reason,at:Date.now()};
    if(this.timer!==null)return;
    this.timer=this.timers.setTimeout(()=>{this.timer=null;const pending=this.pending;this.pending=null;if(pending)this.alignFrom(pending.side,pending.at);},12);
  }
  alignFrom(side,started=Date.now(),anchor=null) {
    if(!this.enabled||this.disposed)return null;
    if(!this.compatible()){this.notify();return null;}
    const targetSide=side==='left'?'right':'left';
    anchor=anchor||this.anchor(side);
    const target=DoubaoScrollMath.target(anchor,this.metrics(targetSide));
    if(!target)return null;
    this.expected[targetSide]={top:target.top,until:Date.now()+250};
    const viewer=this.views[targetSide].viewer;
    if(Math.abs(viewer.scrollTop-target.top)>0.25)viewer.scrollTop=target.top;
    this.leader=side;this.stats.applies++;if(target.clamped)this.stats.clamped++;
    const sample={source:side,anchor,target:target.top,clamped:target.clamped,elapsedMs:Date.now()-started};
    this.stats.samples.push(sample);if(this.stats.samples.length>200)this.stats.samples.shift();
    this.onApply?.(sample);return sample;
  }
  setEnabled(enabled,side=this.leader) {
    this.enabled=!!enabled;
    if(this.timer!==null){this.timers.clearTimeout(this.timer);this.timer=null;}this.pending=null;this.expected={};
    this.notify();if(this.enabled)this.alignFrom(side);
  }
  dispose() {
    if(this.disposed)return;this.disposed=true;
    if(this.timer!==null)this.timers.clearTimeout(this.timer);
    this.timer=null;this.pending=null;
    this.timers.clearInterval(this.poll);this.poll=null;
    for(const cleanup of this.cleanup.splice(0))cleanup();
    this.expected={};
  }
};
