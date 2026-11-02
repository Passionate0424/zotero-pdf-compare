/* SPDX-License-Identifier: AGPL-3.0-only */
var DoubaoManualImport = class {
  constructor(addon) { this.addon=addon;this.pending=new Map();this.tail=Promise.resolve(); }
  sourceForSelection(items) {
    if(items.length!==1)throw new Error('请只选择一份原文 PDF，或只有一份原文 PDF 的文献。');
    const item=items[0];
    if(item.isPDFAttachment())return item;
    if(!item.isRegularItem())throw new Error('请选中原文 PDF 附件。');
    const translations=new Set(Object.entries(this.addon.getPairs()).filter(([key])=>key.startsWith(item.libraryID+':')).map(([,value])=>value));
    const pdfs=Zotero.Items.get(item.getAttachments()).filter(a=>!a.deleted&&a.isPDFAttachment()&&!translations.has(a.key));
    if(pdfs.length!==1)throw new Error('此文献有多份 PDF 或没有原文，请展开条目并选中具体原文 PDF。');
    return pdfs[0];
  }
  assertSource(source) {
    if(this.addon.stopped)throw new Error('插件已停止，请重新启用后再导入。');
    if(!source?.isPDFAttachment()||source.deleted)throw new Error('原文 PDF 已不存在，请重新选择。');
    const library=Zotero.Libraries.get(source.libraryID);
    if(!library?.editable||!library.filesEditable)throw new Error('当前文献库没有添加附件的权限。');
    if(Object.entries(this.addon.getPairs()).some(([key,value])=>key.startsWith(source.libraryID+':')&&value===source.key))throw new Error('当前打开的是已配对的译文，请从原文 PDF 导入。');
  }
  records() {
    try { const value=JSON.parse(Zotero.Prefs.get('extensions.doubaoTranslate.manualImports',true)||'[]');return Array.isArray(value)?value:[]; }
    catch { return []; }
  }
  once(source,work) {
    const key=source.libraryID+':'+source.key;
    if(this.pending.has(key))return this.pending.get(key);
    const promise=this.tail.catch(()=>{}).then(work).finally(()=>{this.pending.delete(key);this.addon.refreshControls(source.id);});
    this.tail=promise.catch(()=>{});
    this.pending.set(key,promise);this.addon.refreshControls(source.id);return promise;
  }
  async pickFile(win) {
    const {FilePicker}=ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs');
    const picker=new FilePicker();picker.init(win,'选择已下载的译文 PDF',picker.modeOpen);picker.appendFilter('PDF 文件','*.pdf');
    return await picker.show()===picker.returnOK?picker.file:null;
  }
  choose(source,win) {
    return this.once(source,async()=>{
      this.assertSource(source);const file=await this.pickFile(win);
      return file?this._importFile(source,file):{cancelled:true};
    });
  }
  importFile(source,file) { return this.once(source,()=>this._importFile(source,file)); }
  hash(bytes) {
    const hash=Components.classes['@mozilla.org/security/hash;1'].createInstance(Components.interfaces.nsICryptoHash);
    hash.init(hash.SHA256);hash.update(bytes,bytes.length);
    return [...hash.finish(false)].map(c=>c.charCodeAt(0).toString(16).padStart(2,'0')).join('');
  }
  async inspect(file) {
    const stat=await IOUtils.stat(file);
    if(stat.type!=='regular'||stat.size<128||stat.size>256*1024*1024)throw new Error('请选择完整的 PDF 文件，大小需在 256 MB 以内。');
    const bytes=await IOUtils.read(file);
    if(String.fromCharCode(...bytes.subarray(0,5))!=='%PDF-')throw new Error('所选文件不是有效的 PDF。');
    const sha256=this.hash(bytes);
    try {
      const buf=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
      const result=await Zotero.PDFWorker._enqueue(()=>Zotero.PDFWorker._query('pdf.getFulltext',{buf,maxPages:null},[buf]),true);
      if(!result.totalPages||result.extractedPages!==result.totalPages)throw new Error('Incomplete PDF');
      return{sha256,bytes:stat.size,pages:result.totalPages,hasTextLayer:!!result.text?.trim()};
    } catch { throw new Error('PDF 无法完整读取，可能已损坏或需要密码。'); }
  }
  async _importFile(source,file) {
    this.assertSource(source);
    const parentID=source.parentID||false,sourcePath=await source.getFilePathAsync();
    if(!sourcePath)throw new Error('请先下载或定位原文 PDF。');
    const selected=await this.inspect(file),original=await this.inspect(sourcePath);
    if(selected.sha256===original.sha256)throw new Error('所选文件与原文完全相同，请选择翻译后的 PDF。');
    this.assertSource(source);
    if((source.parentID||false)!==parentID)throw new Error('原文归属已变化，请重新导入。');
    let translated,created=false;
    const records=this.records();
    const previous=records.find(r=>r.libraryID===source.libraryID&&r.sourceKey===source.key&&r.sourceHash===original.sha256&&r.translatedHash===selected.sha256);
    const existing=previous&&Zotero.Items.getByLibraryAndKey(source.libraryID,previous.translatedKey);
    const candidates=parentID?Zotero.Items.get(Zotero.Items.get(parentID).getAttachments()):existing?[existing]:[];
    for(const candidate of candidates){
      if(candidate.id===source.id||candidate.deleted||!candidate.isPDFAttachment()||(candidate.parentID||false)!==parentID)continue;
      const path=await candidate.getFilePathAsync();if(!path)continue;
      const stat=await IOUtils.stat(path);if(stat.size!==selected.bytes)continue;
      if(this.hash(await IOUtils.read(path))===selected.sha256){translated=candidate;break;}
    }
    const pairPref='extensions.doubaoTranslate.pairs',recordPref='extensions.doubaoTranslate.manualImports';
    const oldPairs=Zotero.Prefs.get(pairPref,true)||'{}',oldRecords=Zotero.Prefs.get(recordPref,true)||'[]';
    try{
      this.assertSource(source);
      if(!translated){
        translated=await Zotero.Attachments.importFromFile({file:Zotero.File.pathToFile(file),libraryID:source.libraryID,
          ...(parentID?{parentItemID:parentID}:{collections:source.getCollections()}),
          title:'[译文] '+source.getDisplayTitle(),contentType:'application/pdf',moveFile:false});created=true;
        const importedPath=await translated.getFilePathAsync();
        if(!importedPath||this.hash(await IOUtils.read(importedPath))!==selected.sha256)throw new Error('复制后的文件校验失败，请重试。');
      }
      this.assertSource(source);
      if((source.parentID||false)!==parentID)throw new Error('原文归属已变化，请重新导入。');
      // Restore every open source host before replacing its paired translation.
      for(const reader of Zotero.Reader._readers.filter(r=>r.itemID===source.id))await this.addon.setMode(reader,'original');
      this.assertSource(source);
      const record={libraryID:source.libraryID,sourceKey:source.key,sourceHash:original.sha256,translatedKey:translated.key,
        translatedHash:selected.sha256,sourcePages:original.pages,translatedPages:selected.pages,hasTextLayer:selected.hasTextLayer};
      const updated=records.filter(r=>!(r.libraryID===record.libraryID&&r.sourceKey===record.sourceKey&&r.translatedHash===record.translatedHash));updated.push(record);
      Zotero.Prefs.set(recordPref,JSON.stringify(updated),true);this.addon.pair(source,translated);
      this.addon.translationPositions.delete(source.id);this.addon.refreshControls(source.id);
      return{cancelled:false,created,translated,record,pageCountMismatch:original.pages!==selected.pages};
    }catch(error){
      Zotero.Prefs.set(pairPref,oldPairs,true);Zotero.Prefs.set(recordPref,oldRecords,true);
      if(created&&translated)await translated.eraseTx();
      throw error;
    }
  }
};
