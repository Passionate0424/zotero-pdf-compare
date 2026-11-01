import fs from 'node:fs';
import crypto from 'node:crypto';
export function auditProtectedFiles(baseline) {
  return baseline.map(file=>{
    const observedExists=fs.existsSync(file.path);
    const observedSha256=observedExists?crypto.createHash('sha256').update(fs.readFileSync(file.path)).digest('hex'):null;
    return {path:file.path,baselineExists:file.exists,baselineSha256:file.sha256,
      observedExists,observedSha256,
      unchanged:observedExists===file.exists&&(!file.exists||observedSha256===file.sha256)};
  });
}

// An accepted historical config change never waives an in-run comparison.
export function assessHistoricalAudit(files, acceptedConfigPath) {
  const normalize=value=>String(value).replaceAll('\\','/').toLowerCase();
  const acceptedHistoricalDrift=[],blockingDrift=[];
  for (const file of files) {
    if (file.unchanged) continue;
    const accepted=normalize(file.path)===normalize(acceptedConfigPath)&&file.baselineExists&&file.observedExists;
    (accepted?acceptedHistoricalDrift:blockingDrift).push(file);
  }
  return {passed:blockingDrift.length===0,acceptedHistoricalDrift,blockingDrift};
}
