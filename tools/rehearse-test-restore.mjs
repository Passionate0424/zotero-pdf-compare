import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { assertWritableTarget, rejectLinks } from './lib/path-guard.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtime=path.join(root,'runtime'),statePath=path.join(runtime,'restore-drill-state.json');
const targets={profile:path.join(runtime,'zotero-profile'),data:path.join(runtime,'zotero-data')};
for(const target of Object.values(targets))assertWritableTarget(target,runtime);
rejectLinks(statePath);
const environment=JSON.parse(fs.readFileSync(path.join(runtime,'environment.local.json'),'utf8'));
if(environment.projectId!=='zotero-doubao-translate-dev-v1'||environment.root.toLowerCase()!==root.toLowerCase()||Object.entries(targets).some(([key,value])=>environment[key].toLowerCase()!==value.toLowerCase()))throw new Error('Test environment ownership mismatch');
const processes=execFileSync('powershell.exe',['-NoProfile','-Command',"@(Get-CimInstance Win32_Process -Filter \"Name='zotero.exe'\" | Select-Object CommandLine)|ConvertTo-Json -Compress"],{encoding:'utf8',windowsHide:true});
const parsed=processes.trim()?JSON.parse(processes):[];
const running=Array.isArray(parsed)?parsed:[parsed];
if(running.some(process=>Object.values(targets).some(target=>process.CommandLine?.toLowerCase().includes(target.toLowerCase()))))throw new Error('Close the isolated test instance before restoring');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const write=state=>fs.writeFileSync(statePath,JSON.stringify(state,null,2)+'\n');
if(process.argv[2]==='swap-in'){
  if(fs.existsSync(statePath)&&JSON.parse(fs.readFileSync(statePath,'utf8')).active)throw new Error('An active recovery exercise already exists');
  const snapshot=assertWritableTarget(process.argv[3]||'',path.join(runtime,'backups'));
  const manifestFile=path.join(snapshot,'snapshot-manifest.json');rejectLinks(manifestFile);
  const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
  if(!Array.isArray(manifest.files)||!manifest.files.length||manifest.files.some(file=>!['profile','data'].includes(file.path.split(/[\\/]/)[0])))throw new Error('Invalid backup manifest');
  for(const file of manifest.files){const from=assertWritableTarget(path.join(snapshot,file.path),snapshot);if(hash(from)!==file.sha256)throw new Error(`Backup hash mismatch: ${file.path}`);}
  const saved=assertWritableTarget(path.join(runtime,'restore-originals',crypto.randomUUID()),runtime);
  fs.mkdirSync(saved,{recursive:true});
  const state={active:true,snapshot,saved,moved:[],copied:[]};write(state);
  for(const [kind,target] of Object.entries(targets)){
    const preserved=assertWritableTarget(path.join(saved,kind),runtime);
    fs.renameSync(target,preserved);state.moved.push(kind);write(state);
    const from=assertWritableTarget(path.join(snapshot,kind),snapshot);
    fs.cpSync(from,target,{recursive:true,force:false,errorOnExist:true,filter:file=>{rejectLinks(file);return true;}});
    state.copied.push(kind);write(state);
  }
  for(const file of manifest.files){const restored=assertWritableTarget(path.join(runtime,file.path.replace(/^profile[\\/]/,'zotero-profile/').replace(/^data[\\/]/,'zotero-data/')),runtime);if(hash(restored)!==file.sha256)throw new Error(`Restored hash mismatch: ${file.path}`);}
  console.log(JSON.stringify({...state,filesVerified:manifest.files.length},null,2));
}else if(process.argv[2]==='swap-back'){
  const state=JSON.parse(fs.readFileSync(statePath,'utf8'));if(!state.active)throw new Error('No active recovery exercise');
  const saved=assertWritableTarget(state.saved,path.join(runtime,'restore-originals'));
  const used=assertWritableTarget(path.join(runtime,'restore-used',crypto.randomUUID()),runtime);fs.mkdirSync(used,{recursive:true});
  for(const kind of state.moved){
    const target=targets[kind];if(!target)throw new Error('Invalid recovery component');
    const preserved=assertWritableTarget(path.join(saved,kind),runtime),destination=assertWritableTarget(path.join(used,kind),runtime);
    assertWritableTarget(target,runtime);
    if(fs.existsSync(target))fs.renameSync(target,destination);
    fs.renameSync(preserved,target);
  }
  write({...state,active:false,used,completedAt:new Date().toISOString()});
  console.log(JSON.stringify({restoredOriginalTestEnvironment:true,used},null,2));
}else throw new Error('Use swap-in <snapshot> or swap-back');
