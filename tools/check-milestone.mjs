import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateMilestone } from './lib/milestone-gate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = process.argv[2];
try {
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'milestones.json'), 'utf8').replace(/^\uFEFF/, ''));
  const stage = registry.milestones.find(stage => stage.id === id);
  if (!stage?.report) throw new Error(`${id} has no completed acceptance report.`);
  const report = JSON.parse(fs.readFileSync(path.join(root, stage.report), 'utf8').replace(/^\uFEFF/, ''));
  const errors = validateMilestone(report, id);
  for (const screenshot of report.visualReview?.screenshots || []) {
    const file = path.resolve(root, screenshot.path);
    if (!fs.existsSync(file)) errors.push(`Missing screenshot: ${screenshot.path}`);
    else if (crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== screenshot.sha256) errors.push(`Screenshot hash mismatch: ${screenshot.path}`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`${id}: all required functional and visual gates passed.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
