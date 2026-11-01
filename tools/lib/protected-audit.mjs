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
