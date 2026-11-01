import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {auditProtectedFiles,assessHistoricalAudit} from '../../tools/lib/protected-audit.mjs';
test('drift report preserves the original hash and records the different observed hash',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'doubao-audit-'));
  try{
    const file=path.join(dir,'owned-test-file');fs.writeFileSync(file,'baseline');
    const sha256=crypto.createHash('sha256').update('baseline').digest('hex');
    const baseline=[{path:file,exists:true,sha256}];
    assert.equal(auditProtectedFiles(baseline)[0].unchanged,true);
    fs.writeFileSync(file,'changed');const changed=auditProtectedFiles(baseline)[0];
    assert.equal(changed.unchanged,false);assert.equal(changed.baselineSha256,sha256);
    assert.notEqual(changed.observedSha256,sha256);assert.equal(baseline[0].sha256,sha256);
    fs.unlinkSync(file);const removed=auditProtectedFiles(baseline)[0];
    assert.equal(removed.unchanged,false);assert.equal(removed.observedSha256,null);
  }finally{fs.rmSync(path.join(dir,'owned-test-file'),{force:true});fs.rmdirSync(dir);}
});

test('only the named existing historical config can be accepted',()=>{
  const prefs='C:/formal/prefs.js';
  const changed={path:prefs,baselineExists:true,observedExists:true,unchanged:false};
  assert.equal(assessHistoricalAudit([changed],prefs).passed,true);
  assert.equal(assessHistoricalAudit([{...changed,path:'C:/other/prefs.js'}],prefs).passed,false);
  assert.equal(assessHistoricalAudit([{...changed,observedExists:false}],prefs).passed,false);
  assert.equal(assessHistoricalAudit([{...changed,path:'D:/Zotero/zotero.exe'}],prefs).passed,false);
  assert.equal(changed.unchanged,false);
});
