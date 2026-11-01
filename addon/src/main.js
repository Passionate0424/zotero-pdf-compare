/* SPDX-License-Identifier: AGPL-3.0-only
 * Native source ReaderTab is preserved in place. Translation-pane API patterns
 * reviewed against Zotero 10 and ZTransplit 36e884f (see docs/REFERENCES.md).
 */
var DoubaoTranslateAddon = class {
  constructor(id) {
    this.id = id;
    this.states = new Map();
    this.buttons = new Set();
    this.hostWatches = new Map();
    this.modeQueues = new Map();
    this.modeRequests = new Map();
    this.stopped = false;
    this.timers = ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs');
    this.onToolbar = event => this.renderToolbar(event);
  }
  start() {
    Zotero.Reader.registerEventListener('renderToolbar', this.onToolbar, this.id);
    for (const win of Zotero.getMainWindows()) win.DoubaoTranslate = this;
    for (const reader of Zotero.Reader._readers) {
      const doc = reader._iframeWindow?.document;
      const end = doc?.querySelector('.toolbar > .end');
      if (end) this.renderToolbar({reader,doc,append:group => end.prepend(group)});
    }
  }
  stop() {
    this.stopped = true;
    for (const observer of this.hostWatches.values()) observer.disconnect();
    this.hostWatches.clear();
    Zotero.Reader.unregisterEventListener('renderToolbar', this.onToolbar);
    for (const state of [...this.states.values()]) this.restore(state);
    for (const button of this.buttons) {
      try {
        const parent = button.parentElement;
        if (parent?.classList.contains('section') && parent.childElementCount === 1) parent.remove();
        else button.remove();
      } catch {}
    }
    this.buttons.clear();
    for (const win of Zotero.getMainWindows()) if (win.DoubaoTranslate === this) delete win.DoubaoTranslate;
  }
  pair(source, translated) {
    const pairs = this.getPairs();
    pairs[`${source.libraryID}:${source.key}`] = translated.key;
    Zotero.Prefs.set('extensions.doubaoTranslate.pairs', JSON.stringify(pairs), true);
  }
  getPairs() {
    try { return JSON.parse(Zotero.Prefs.get('extensions.doubaoTranslate.pairs', true) || '{}'); }
    catch { return {}; }
  }
  translationFor(reader) {
    const source = Zotero.Items.get(reader.itemID);
    const key = this.getPairs()[`${source.libraryID}:${source.key}`];
    return key ? Zotero.Items.getByLibraryAndKey(source.libraryID, key) : null;
  }
  renderToolbar({ reader, doc, append }) {
    if (!reader._tabContainer || !this.translationFor(reader) || doc.querySelector('.doubao-reading-modes')) return;
    const group = this.createButtons(doc, reader);
    append(group);
    if (!this.hostWatches.has(reader.tabID)) {
      const container=reader._tabContainer;
      const observer=new container.ownerDocument.defaultView.MutationObserver(() => {
        if (container.isConnected && reader._iframe.isConnected) return;
        const state=this.states.get(reader.tabID);
        if (state) this.restore(state);
        for (const controls of [...this.buttons]) {
          if (controls.dataset.sourceTab===reader.tabID) { controls.remove();this.buttons.delete(controls); }
        }
        observer.disconnect();this.hostWatches.delete(reader.tabID);
      });
      observer.observe(container.parentNode,{childList:true});
      this.hostWatches.set(reader.tabID,observer);
    }
  }
  createButtons(doc, reader) {
    const group = doc.createElement('div');
    group.className = 'doubao-reading-modes';
    group.dataset.sourceTab=reader.tabID;
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'PDF 阅读模式');
    group.style.cssText = 'display:flex;gap:3px;align-items:center;margin:0 4px;flex-shrink:0;';
    for (const [mode, label] of [['original','原文'],['translation','译文'],['compare','对照']]) {
      const button = doc.createElement('button');
      button.textContent = label;
      button.className = 'toolbar-button doubao-mode-button';
      button.title = label;
      button.setAttribute('aria-label', label);
      button.dataset.doubaoMode = mode;
      button.style.cssText = 'font:inherit;font-size:11px;line-height:22px;height:26px;width:auto;padding:0 3px;min-width:32px;color:var(--fill-primary,#ddd);background:var(--fill-quinary,transparent);border:1px solid var(--fill-tertiary,#888);border-radius:4px;cursor:pointer;';
      button.addEventListener('click', () => this.setMode(reader, mode).catch(error => {
        if (this.stopped || !reader._iframe.isConnected) return;
        Zotero.logError(error);
        reader.displayError(error);
      }));
      group.appendChild(button);
    }
    this.buttons.add(group);
    return group;
  }
  responsiveToolbar(doc, readonly = false) {
    const root = doc.documentElement;
    const style = doc.createElement('style');
    style.textContent = `
      html.doubao-compare-layout .toolbar {height:auto !important;min-height:81px;flex-wrap:wrap;align-content:flex-start;justify-content:space-between;}
      html.doubao-compare-layout .toolbar > .start {flex:1 0 100%;min-width:0;min-height:40px;flex-wrap:wrap;}
      html.doubao-compare-layout .toolbar > .center {flex:0 0 auto;min-height:40px;}
      html.doubao-compare-layout .toolbar > .end {flex:0 0 auto;min-height:40px;margin-inline-start:auto;padding-inline-end:0;gap:4px;}
      html.doubao-compare-layout .toolbar > .start > * {flex-shrink:0;}
      html.doubao-compare-layout .toolbar #numPages {white-space:nowrap;flex:0 0 auto;align-items:center;}
      html.doubao-compare-layout .toolbar #numPages div {position:static;}
      @media (max-width:480px) {
        html.doubao-compare-layout .toolbar > .start::before {content:'';flex-basis:100%;order:1;}
        html.doubao-compare-layout .toolbar > .start > #previous,
        html.doubao-compare-layout .toolbar > .start > #next,
        html.doubao-compare-layout .toolbar > .start > #pageNumber,
        html.doubao-compare-layout .toolbar > .start > #numPages {order:2;}
      }
      html.doubao-compare-layout #reader-ui {min-height:var(--doubao-toolbar-offset,81px);}
      html.doubao-compare-layout #split-view,html.doubao-compare-layout #sidebarContainer,html.doubao-compare-layout .sidebar-resizer {top:var(--doubao-toolbar-offset,81px) !important;}
      ${readonly ? 'html.doubao-compare-layout .toolbar > .tools {display:none;}' : ''}
    `;
    const oldOffset = root.style.getPropertyValue('--doubao-toolbar-offset');
    const hadClass = root.classList.contains('doubao-compare-layout');
    doc.head.appendChild(style); root.classList.add('doubao-compare-layout');
    const toolbar = doc.querySelector('.toolbar');
    const update = () => root.style.setProperty('--doubao-toolbar-offset', `${Math.max(41,Math.ceil(toolbar.getBoundingClientRect().height))}px`);
    const observer = new doc.defaultView.ResizeObserver(update);
    observer.observe(toolbar); update();
    return () => { observer.disconnect(); style.remove(); if (!hadClass) root.classList.remove('doubao-compare-layout'); if (oldOffset) root.style.setProperty('--doubao-toolbar-offset',oldOffset); else root.style.removeProperty('--doubao-toolbar-offset'); };
  }
  async waitFor(check, state, timeout = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (this.stopped || state?.closed) throw new Error('译文阅读器初始化已取消。');
      try { const value = check(); if (value) return value; } catch {}
      await new Promise(resolve => this.timers.setTimeout(resolve, 40));
    }
    throw new Error('译文阅读器未能就绪，请切回原文后重试。');
  }
  async ensureState(reader) {
    const existing = this.states.get(reader.tabID);
    if (existing) return existing;
    const translated = this.translationFor(reader);
    if (!translated) throw new Error('尚未找到这份 PDF 对应的译文附件。');
    const sourceBrowser = reader._iframe;
    const container = reader._tabContainer;
    if (!sourceBrowser || sourceBrowser.parentNode !== container) throw new Error('当前 Zotero 阅读器布局暂不兼容。');
    const doc = container.ownerDocument;
    const right = doc.createXULElement('browser');
    right.setAttribute('type', 'content');
    right.setAttribute('transparent', 'true');
    right.setAttribute('class', 'reader doubao-translation-pane');
    right.style.cssText = 'flex:1 1 0;min-width:0;max-width:none;overflow:hidden;';
    const divider = doc.createXULElement('box');
    divider.className = 'doubao-divider';
    divider.style.cssText = 'width:5px;min-width:5px;flex:0 0 5px;background:var(--fill-secondary,#777);cursor:col-resize;touch-action:none;';
    divider.setAttribute('role','separator');
    divider.setAttribute('aria-label','调整原文和译文宽度');
    divider.setAttribute('aria-orientation','vertical');
    divider.setAttribute('tabindex','0');
    divider.setAttribute('aria-valuemin','20');
    divider.setAttribute('aria-valuemax','80');
    const state = {
      reader, sourceBrowser, container, right, divider, translated, mode: 'compare',
      originalContainerStyle: container.getAttribute('style'),
      originalBrowserStyle: sourceBrowser.getAttribute('style'),
      nativeInternal: reader._internalReader, originalParent: sourceBrowser.parentNode,
    };
    state.ratio = 0.5;
    const resize = ratio => {
      state.ratio = Math.max(0.2,Math.min(0.8,ratio));
      sourceBrowser.style.flex = `${state.ratio} 1 0`;
      right.style.flex = `${1-state.ratio} 1 0`;
      divider.setAttribute('aria-valuenow',String(Math.round(state.ratio*100)));
    };
    divider.setAttribute('aria-valuenow','50');
    divider.addEventListener('pointerdown',event => {
      if (event.button !== 0) return;
      event.preventDefault();state.dragPointer = event.pointerId;
      divider.setPointerCapture(event.pointerId);
    });
    divider.addEventListener('pointermove',event => {
      if (state.dragPointer !== event.pointerId) return;
      const bounds=container.getBoundingClientRect();
      resize((event.clientX-bounds.left)/Math.max(1,bounds.width-5));
    });
    const finishDrag = event => {
      if (state.dragPointer !== event.pointerId) return;
      state.dragPointer = null;
      if (divider.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId);
    };
    divider.addEventListener('pointerup',finishDrag);
    divider.addEventListener('pointercancel',finishDrag);
    divider.addEventListener('lostpointercapture',()=>{state.dragPointer=null;});
    divider.addEventListener('keydown',event => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault();
      resize(event.key==='Home'?0.2:event.key==='End'?0.8:state.ratio+(event.key==='ArrowLeft'?-0.05:0.05));
    });
    this.states.set(reader.tabID, state);
    container.style.display = 'flex';
    container.style.flexDirection = 'row';
    container.style.minWidth = '0';
    sourceBrowser.style.flex = '1 1 0';
    sourceBrowser.style.minWidth = '0';
    container.appendChild(divider);
    container.appendChild(right);
    right.setAttribute('src', 'resource://zotero/reader/reader.html');
    right.docShellIsActive = true;
    try {
      const content = await this.waitFor(() => {
        const win = right.contentWindow;
        return win?.wrappedJSObject?.createReader ? win : null;
      }, state);
      state.errors = [];
      content.addEventListener("error", event => {if(state.errors.length<20)state.errors.push({message:event.message,stack:event.error?.stack});Zotero.logError(event.error||event.message);});
      content.addEventListener("unhandledrejection", event => {if(state.errors.length<20)state.errors.push({message:String(event.reason),stack:event.reason?.stack});Zotero.logError(event.reason);});
      const ftl = [];
      for (const locale of [...new Set(['en-US', String(Zotero.locale || '')])]) {
        for (const file of ['branding/brand.ftl','zotero.ftl','reader.ftl']) {
          try { ftl.push(Zotero.File.getContentsFromURL(`resource://app/localization/${locale}/${file}`)); } catch {}
        }
      }
      const config = {
        type: 'pdf', data: {url: `zotero://attachment/${Zotero.API.getLibraryPrefix(translated.libraryID)}/items/${translated.key}/`},
        annotations: [], readOnly: true, ftl,
        primaryViewState: { pageIndex: 0, scale: 'page-width' },
        showAnnotations: false, sidebarOpen: false, sidebarWidth: 200,
        showContextPaneToggle: false, bottomPlaceholderHeight: null,
        fontSize: Zotero.Prefs.get('fontSize'), rtl: Zotero.rtl,
        onOpenLink: url => Zotero.launchURL(url),
        onOpenContextMenu: () => {}, onChangeViewState: () => {},
      };
      content.wrappedJSObject.createReader(Components.utils.cloneInto(config, content, {cloneFunctions:true,wrapReflectors:true}));
      state.rightInternal = await this.waitFor(() => content.wrappedJSObject._reader,state);
      right.docShellIsActive = true;
      right.browsingContext.isActive = true;
      await this.waitFor(() => state.rightInternal._primaryView?._iframeWindow?.document?.querySelector('.page'),state);
      await this.waitFor(() => content.document.querySelector('.toolbar'),state);
      const toolbar = content.document.querySelector('.toolbar');
      state.rightControls = this.createButtons(content.document, reader);
      toolbar.querySelector('.end').prepend(state.rightControls);
      state.restoreSourceLayout = this.responsiveToolbar(reader._iframeWindow.document);
      state.restoreRightLayout = this.responsiveToolbar(content.document,true);
      state.closeObserver = new doc.defaultView.MutationObserver(() => {
        if (!container.isConnected) this.restore(state);
      });
      state.closeObserver.observe(container.parentNode, { childList: true });
      state.selectionListener = event => { right.docShellIsActive = !!event.detail.selected; };
      container.addEventListener('tab-selection-change',state.selectionListener);
      return state;
    } catch (error) { this.restore(state); throw error; }
  }
  setMode(reader, mode) {
    if (!['original','translation','compare'].includes(mode)) return Promise.reject(new Error('未知阅读模式'));
    if (this.stopped) return Promise.reject(new Error('插件已停止。'));
    const request = {};
    this.modeRequests.set(reader.tabID,request);
    const previous = this.modeQueues.get(reader.tabID) || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      if (this.stopped || this.modeRequests.get(reader.tabID) !== request) return;
      await this.applyMode(reader,mode);
    });
    this.modeQueues.set(reader.tabID,next);
    return next.finally(() => {
      if (this.modeQueues.get(reader.tabID) === next) this.modeQueues.delete(reader.tabID);
      if (this.modeRequests.get(reader.tabID) === request) this.modeRequests.delete(reader.tabID);
    });
  }
  async applyMode(reader, mode) {
    if (!['original','translation','compare'].includes(mode)) throw new Error('未知阅读模式');
    if (mode === 'original') {
      const state = this.states.get(reader.tabID);
      if (state) this.restore(state);
    } else {
      const state = await this.ensureState(reader);
      state.mode = mode;
      state.sourceBrowser.style.display = mode === 'translation' ? 'none' : '';
      state.divider.style.display = mode === 'translation' ? 'none' : '';
    }
    for (const group of this.buttons) {
      if(group.dataset.sourceTab!==reader.tabID)continue;
      for (const button of group.querySelectorAll('button')) {
        const selected=button.dataset.doubaoMode===mode;
        button.setAttribute('aria-pressed',String(selected));
        button.style.background=selected?'#2563eb':'var(--fill-quinary,transparent)';
        button.style.color=selected?'white':'var(--fill-primary,#ddd)';
      }
    }
  }
  restore(state) {
    if (state.closed) return;
    state.closed = true;
    state.closeObserver?.disconnect();
    if (state.selectionListener) state.container.removeEventListener('tab-selection-change',state.selectionListener);
    state.restoreSourceLayout?.(); state.restoreRightLayout?.();
    if (state.rightControls) { this.buttons.delete(state.rightControls); state.rightControls.remove(); }
    try { state.rightInternal?.uninit?.(); } catch (error) { Zotero.logError(error); }
    state.right.remove(); state.divider.remove();
    for (const [node, style] of [[state.container,state.originalContainerStyle],[state.sourceBrowser,state.originalBrowserStyle]]) {
      if (style == null) node.removeAttribute('style'); else node.setAttribute('style', style);
    }
    if (this.states.get(state.reader.tabID) === state) this.states.delete(state.reader.tabID);
  }
};
