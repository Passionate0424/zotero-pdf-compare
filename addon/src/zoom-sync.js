/* SPDX-License-Identifier: AGPL-3.0-only */
var DoubaoZoomSync = class {
  constructor({left,right,scroll}) {
    this.views={left,right};this.enabled=false;this.disposed=false;this.applying=false;this.cleanup=[];
    this.scroll=scroll;
    for(const [side,view] of Object.entries(this.views)){
      const changed=event=>{if(this.enabled&&!this.applying&&!this.disposed)this.alignFrom(side,event);};
      view.eventBus.on('scalechanging',changed);
      this.cleanup.push(()=>view.eventBus.off('scalechanging',changed));
    }
  }
  value(side,event) {
    const presets=['auto','page-width','page-fit','page-height','page-actual'];
    const value=event?.presetValue??event?.scale??this.views[side].pdfViewer.currentScaleValue;
    if(presets.includes(value))return value;
    const number=Number(value);return Number.isFinite(number)&&number>0?number:null;
  }
  alignFrom(side,event) {
    if(!this.enabled||this.disposed)return;
    const value=this.value(side,event);if(value===null)return;
    const target=this.views[side==='left'?'right':'left'].pdfViewer;
    this.applying=true;
    try{
      if(!(typeof value==='string'?target.currentScaleValue===value:Math.abs(target.currentScale-value)<0.00001))target.currentScaleValue=value;
      this.scroll?.alignViewportFrom(side);
    }finally{this.applying=false;}
  }
  setEnabled(enabled,side='left') {
    this.enabled=!!enabled&&!this.disposed;if(this.scroll)this.scroll.focusLinked=this.enabled;if(this.enabled)this.alignFrom(side);
  }
  dispose() {
    if(this.disposed)return;this.disposed=true;this.enabled=false;
    if(this.scroll)this.scroll.focusLinked=false;
    for(const cleanup of this.cleanup.splice(0))cleanup();
  }
};
