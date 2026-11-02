/* SPDX-License-Identifier: AGPL-3.0-only */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { assertWritableTarget, isInside, rejectLinks } from '../../tools/lib/path-guard.mjs';
import { TaskError, publicError } from './errors.mjs';
import { sha256 } from './pdf.mjs';

export const activeStates = new Set(['opening','uploading','sending','previewing','translating','downloading','validating']);
const phaseOrder = ['opening','uploading','sending','previewing','translating','downloading','validating'];
export class TaskQueue {
  constructor({ directory, inputRoots, provider, validate, timeoutMs = 15 * 60 * 1000 }) {
    this.directory = path.resolve(directory); rejectLinks(this.directory);
    this.inputRoots = inputRoots.map(p => path.resolve(p));
    this.provider = provider; this.validate = validate; this.timeoutMs = timeoutMs;
    this.current = null; this.closed = false; this.lockToken = crypto.randomUUID();
    fs.mkdirSync(this.directory, { recursive: true });
    this.lockPath = path.join(this.directory, 'worker.lock');
    rejectLinks(this.lockPath);
    this.storeFile = path.join(this.directory, 'tasks.json'); rejectLinks(this.storeFile);
    try {
      this.lockFd = fs.openSync(this.lockPath, 'wx');
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const owner = JSON.parse(fs.readFileSync(this.lockPath, 'utf8'));
      if (!Number.isInteger(owner.pid) || owner.pid < 1) throw new Error('Queue lock needs inspection');
      try { process.kill(owner.pid, 0); throw new TaskError('WORKER_BUSY'); }
      catch (failure) { if (failure.code !== 'ESRCH') throw failure; }
      // Only remove this registered lock after proving its owner has exited.
      if (fs.readFileSync(this.lockPath, 'utf8') !== JSON.stringify(owner)) throw new Error('Queue lock changed');
      fs.unlinkSync(this.lockPath); this.lockFd = fs.openSync(this.lockPath, 'wx');
    }
    fs.writeFileSync(this.lockFd, JSON.stringify({ pid: process.pid, token: this.lockToken }));
    try {
      const store = fs.existsSync(this.storeFile) ? JSON.parse(fs.readFileSync(this.storeFile, 'utf8')) : { schemaVersion: 1, jobs: [] };
      if (store.schemaVersion !== 1 || !Array.isArray(store.jobs)) throw new Error('Unsupported queue store');
      this.jobs = store.jobs;
      for (const job of this.jobs) {
        if (!/^[0-9a-f-]{36}$/.test(job.id)) throw new Error('Invalid task identity');
        if (activeStates.has(job.state)) this.transition(job, 'interrupted', publicError(new TaskError('INTERRUPTED')), false);
        if (job.state === 'succeeded') this.checkResult(job, false);
      }
      this.save();
    } catch (error) { this.release(); throw error; }
  }
  file(relative) { return assertWritableTarget(path.join(this.directory, relative), this.directory); }
  save() {
    const temp = this.file('tasks.json.new');
    const fd = fs.openSync(temp, 'w');
    try { fs.writeFileSync(fd, JSON.stringify({ schemaVersion: 1, jobs: this.jobs }, null, 2)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temp, this.storeFile);
  }
  transition(job, state, error, save = true) {
    job.state = state; job.updatedAt = new Date().toISOString();
    job.error = error || null;
    job.history.push({ state, at: job.updatedAt, ...(error ? { code: error.code } : {}) });
    if (save) this.save();
  }
  checkResult(job, save = true) {
    try {
      const file = this.file(job.result.file);
      if (!fs.statSync(file).isFile() || sha256(file) !== job.result.sha256) throw new Error('Changed result');
    } catch {
      job.result = null; this.transition(job, 'failed', publicError(new TaskError('DOWNLOAD_FAILED')), save);
    }
  }
  submit({ source, targetLanguage = 'zh-CN', independent = false }) {
    if (this.closed) throw new Error('Queue closed');
    source = path.resolve(source); rejectLinks(source);
    const sourceStat = fs.statSync(source);
    if (!this.inputRoots.some(root => isInside(source, root)) || !sourceStat.isFile() || sourceStat.size > 512 * 1024 * 1024
        || path.extname(source).toLowerCase() !== '.pdf' || targetLanguage !== 'zh-CN') throw new TaskError('INPUT_INVALID');
    const sourceHash = sha256(source);
    const key = 'doubao-web-v1:' + targetLanguage + ':' + sourceHash;
    const existing = !independent && [...this.jobs].reverse().find(j => j.key === key && j.state !== 'cancelled');
    if (existing) {
      if (existing.state === 'succeeded') this.checkResult(existing);
      return { job: this.publicJob(existing), deduplicated: true };
    }
    // Keep an immutable owned copy. No later source overwrite can retarget a task.
    const input = this.file('inputs/' + sourceHash + '.pdf'); fs.mkdirSync(path.dirname(input), { recursive: true });
    if (!fs.existsSync(input)) fs.copyFileSync(source, input, fs.constants.COPYFILE_EXCL);
    if (sha256(input) !== sourceHash) throw new TaskError('INPUT_INVALID');
    const now = new Date().toISOString();
    const job = { id: crypto.randomUUID(), key, input: path.relative(this.directory, input), sourceHash,
      targetLanguage, state: 'queued', attempt: 0, createdAt: now, updatedAt: now, history: [{ state: 'queued', at: now }], result: null, error: null };
    this.jobs.push(job); this.save();
    return { job: this.publicJob(job), deduplicated: false };
  }
  find(id) { const job = this.jobs.find(j => j.id === id); if (!job) throw new Error('Unknown task'); return job; }
  publicJob(job) {
    return JSON.parse(JSON.stringify({ id: job.id, state: job.state, attempt: job.attempt,
      createdAt: job.createdAt, updatedAt: job.updatedAt, sourceHash: job.sourceHash,
      targetLanguage: job.targetLanguage, history: job.history, error: job.error, result: job.result }));
  }
  list() { return this.jobs.map(j => this.publicJob(j)); }
  retry(id) {
    const job = this.find(id);
    if (!['failed','waiting_login','interrupted','cancelled'].includes(job.state)) throw new Error('Task cannot be retried');
    job.result = null; this.transition(job, 'queued'); return this.publicJob(job);
  }
  cancel(id) {
    const job = this.find(id);
    if (job.state === 'succeeded') return this.publicJob(job);
    if (this.current?.job.id === id) this.current.controller.abort(new TaskError('CANCELLED'));
    else this.transition(job, 'cancelled', publicError(new TaskError('CANCELLED')));
    return this.publicJob(job);
  }
  async drain() {
    if (this.running) return this.running;
    this.running = this.run();
    try { await this.running; } finally { this.running = null; }
  }
  async run() {
    while (!this.closed) {
      if (this.jobs.some(j => j.state === 'waiting_login')) break;
      const job = this.jobs.find(j => j.state === 'queued'); if (!job) break;
      await this.execute(job);
      // Login is shared by this serial provider. Do not open more chats while logged out.
      if (job.state === 'waiting_login') break;
    }
  }
  async execute(job) {
    const controller = new AbortController(), signal = controller.signal;
    this.current = { job, controller }; job.attempt++; job.result = null;
    const timeout = setTimeout(() => controller.abort(new TaskError('TIMEOUT')), this.timeoutMs);
    const aborted = new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    aborted.catch(() => {});
    let work, output, pending;
    try {
      output = this.file('results/' + job.id + '.pdf');
      pending = this.file('pending/' + job.id + '.pdf.part');
      fs.mkdirSync(path.dirname(output), { recursive: true }); fs.mkdirSync(path.dirname(pending), { recursive: true });
      const source = this.file(job.input);
      if (sha256(source) !== job.sourceHash) throw new TaskError('INPUT_INVALID');
      const original = await this.validate(source, { signal });
      signal.throwIfAborted(); this.transition(job, 'opening');
      work = this.provider.run({ source, targetLanguage: job.targetLanguage, output: pending, signal,
        phase: state => {
          signal.throwIfAborted();
          if (!activeStates.has(state) || phaseOrder.indexOf(state) < phaseOrder.indexOf(job.state)) throw new TaskError('INTERNAL_ERROR');
          this.transition(job, state);
        } });
      const receipt = await Promise.race([work, aborted]); signal.throwIfAborted();
      this.transition(job, 'validating');
      const result = await this.validate(pending, { expectedPages: original.pages, signal }); signal.throwIfAborted();
      if (result.sha256 === job.sourceHash) throw new TaskError('SOURCE_UNCHANGED');
      // Only expose a final filename after complete download and every-page validation.
      fs.renameSync(pending, output);
      job.result = { file: path.relative(this.directory, output), ...result,
        ...(typeof receipt?.conversationHash === 'string' && /^[a-f0-9]{64}$/.test(receipt.conversationHash)
          ? { conversationHash: receipt.conversationHash } : {}) };
      this.transition(job, 'succeeded');
    } catch (error) {
      const safe = publicError(signal.aborted ? signal.reason : error);
      const state = safe.code === 'CANCELLED' ? 'cancelled' : safe.code === 'LOGIN_REQUIRED' ? 'waiting_login'
        : safe.code === 'INTERRUPTED' ? 'interrupted' : 'failed';
      this.transition(job, state, safe);
    } finally {
      clearTimeout(timeout);
      // Provider contract: abort closes its own context and settles. Never start
      // another browser session while cleanup of the preceding one is pending.
      if (signal.aborted && work) await work.catch(() => {});
      if (pending && fs.existsSync(pending)) fs.unlinkSync(this.file(path.relative(this.directory, pending)));
      this.current = null;
    }
  }
  release() {
    if (this.lockFd !== undefined) { fs.closeSync(this.lockFd); this.lockFd = undefined; }
    if (fs.existsSync(this.lockPath)) {
      rejectLinks(this.lockPath);
      const owner = JSON.parse(fs.readFileSync(this.lockPath, 'utf8'));
      if (owner.token === this.lockToken) fs.unlinkSync(this.lockPath);
    }
  }
  async close() {
    this.closed = true; this.current?.controller.abort(new TaskError('INTERRUPTED'));
    try { if (this.running) await this.running; } finally { this.release(); }
  }
}
