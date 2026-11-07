import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { assertWritableTarget, rejectLinks } from './lib/path-guard.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtime=path.join(root,'runtime'),backupRoot=path.join(runtime,'backups');
const source=assertWritableTarget(process.argv[2]||'',backupRoot);
const manifestPath=path.join(source,'snapshot-manifest.json');rejectLinks(manifestPath);
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
if(!Array.isArray(manifest.files)||!manifest.files.length)throw new Error('Invalid snapshot manifest');
const target=assertWritableTarget(path.join(runtime,'restore-drills',crypto.randomUUID()),runtime);
fs.mkdirSync(target,{recursive:true});
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
for(const item of manifest.files){
  if(!['profile','data'].includes(item.path.split(/[\\/]/)[0]))throw new Error(`Unexpected snapshot path: ${item.path}`);
  const from=assertWritableTarget(path.join(source,item.path),source);
  const to=assertWritableTarget(path.join(target,item.path),target);
  if(hash(from)!==item.sha256)throw new Error(`Backup hash mismatch: ${item.path}`);
  fs.mkdirSync(path.dirname(to),{recursive:true});
  fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL);
  if(fs.statSync(to).size!==item.bytes||hash(to)!==item.sha256)throw new Error(`Restored file mismatch: ${item.path}`);
}
const db=path.join(target,'data','zotero.sqlite');rejectLinks(db);
const fixture=JSON.parse(fs.readFileSync(path.join(runtime,'manual-fixture.json'),'utf8'));
if(![fixture.libraryID,fixture.sourceKey,fixture.translatedKey,fixture.annotationKey].every(Boolean))throw new Error('Incomplete test fixture identity');
const query="import sqlite3,sys,json,pathlib; c=sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri()+'?mode=ro',uri=True); integrity=c.execute('pragma integrity_check').fetchall(); items=c.execute('select count(*) from items').fetchone()[0]; annotations=c.execute('select count(*) from itemAnnotations').fetchone()[0]; sql='select count(*) from items s join itemAttachments sa on sa.itemID=s.itemID join items t on t.libraryID=s.libraryID join itemAttachments ta on ta.itemID=t.itemID and ta.parentItemID=sa.parentItemID join items a on a.libraryID=s.libraryID join itemAnnotations aa on aa.itemID=a.itemID and aa.parentItemID=s.itemID where s.libraryID=? and s.key=? and t.key=? and a.key=?'; matched=c.execute(sql,(int(sys.argv[2]),*sys.argv[3:6])).fetchone()[0]; print(json.dumps({'integrity':integrity,'items':items,'annotations':annotations,'fixtureRelationship':matched})); sys.exit(0 if integrity==[('ok',)] and matched==1 else 1)";
const checked=spawnSync('python',['-c',query,db,String(fixture.libraryID),fixture.sourceKey,fixture.translatedKey,fixture.annotationKey],{encoding:'utf8'});
if(checked.error||checked.status!==0)throw checked.error||new Error(`Restored database check failed: ${checked.stderr||checked.stdout}`);
console.log(JSON.stringify({passed:true,source,target,filesVerified:manifest.files.length,database:JSON.parse(checked.stdout)},null,2));
