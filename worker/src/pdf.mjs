/* SPDX-License-Identifier: AGPL-3.0-only */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { TaskError } from './errors.mjs';
const execute = promisify(execFile);
const script = fileURLToPath(new URL('../validate_pdf.py', import.meta.url));
export const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export async function validatePdf(file, { python = 'python', expectedPages, signal } = {}) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size < 128 || stat.size > 512 * 1024 * 1024) throw new TaskError('PDF_INVALID');
  const fd = fs.openSync(file, 'r');
  const header = Buffer.alloc(5);
  try { fs.readSync(fd, header, 0, 5, 0); } finally { fs.closeSync(fd); }
  if (header.toString() !== '%PDF-') throw new TaskError('PDF_INVALID');
  let report;
  try {
    const { stdout } = await execute(python, ['-I', script, file], { signal, timeout: 60000, maxBuffer: 1024 * 1024, windowsHide: true });
    report = JSON.parse(stdout);
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    throw new TaskError('PDF_INVALID');
  }
  if (!report.valid || report.pages < 1 || report.checkedPages !== report.pages) throw new TaskError('PDF_INVALID');
  if (expectedPages !== undefined && report.pages !== expectedPages) throw new TaskError('PAGE_COUNT');
  return { ...report, bytes: stat.size, sha256: sha256(file) };
}
