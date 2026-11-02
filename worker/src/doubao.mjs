/* SPDX-License-Identifier: AGPL-3.0-only */
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { rejectLinks } from '../../tools/lib/path-guard.mjs';
import { TaskError } from './errors.mjs';

// Semantic labels plus the three test IDs observed on the live page. Missing or
// ambiguous controls stop the task instead of guessing coordinates/private APIs.
export class DoubaoProvider {
  constructor({ profile, headless = true, launch = chromium.launchPersistentContext.bind(chromium),
    entry = 'https://www.doubao.com/chat/', sharedContext = null, stepTimeoutMs = 30000, uploadTimeoutMs = 120000, translationTimeoutMs = 600000 }) {
    rejectLinks(profile);
    this.profile = path.resolve(profile); this.headless = headless; this.launch = launch;
    this.sharedContext=sharedContext;
    this.entry = entry; this.stepTimeoutMs = stepTimeoutMs; this.uploadTimeoutMs=uploadTimeoutMs; this.translationTimeoutMs = translationTimeoutMs;
  }
  async loggedOut(page) {
    return page.evaluate(() => [...document.querySelectorAll('button,[role=button],a,div,span')].some(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && el.children.length === 0
        && /^(登录|登录注册|扫码登录|手机号登录|请先登录)$/.test((el.textContent || '').trim());
    }));
  }
  async check(page, signal) {
    signal.throwIfAborted();
    if (await this.loggedOut(page)) throw new TaskError('LOGIN_REQUIRED');
    const origin = new URL(page.url()).origin;
    if (origin !== new URL(this.entry).origin) throw new TaskError('UI_CHANGED');
  }
  async wait(page, signal, predicate, timeout = this.stepTimeoutMs, errorCode='UI_CHANGED') {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      await this.check(page, signal);
      if (await predicate()) return;
      await page.waitForTimeout(200);
    }
    throw new TaskError(errorCode);
  }
  async oneVisible(locator) {
    const visible = [];
    for (let i = 0; i < await locator.count(); i++) if (await locator.nth(i).isVisible()) visible.push(locator.nth(i));
    if (visible.length !== 1) throw new TaskError('UI_CHANGED');
    return visible[0];
  }
  async translatePage(page, { source, output, signal, phase }) {
    page.setDefaultTimeout(this.stepTimeoutMs);
    await page.goto(this.entry, { waitUntil: 'domcontentloaded', timeout: this.stepTimeoutMs });
    // Wait for a hydrated composer or visible login UI before making any upload.
    await this.wait(page, signal, async () => (await page.locator('[contenteditable=true],textarea').count()) > 0);
    await this.check(page, signal);
    const input = page.locator('input[type=file]');
    await this.wait(page,signal,async()=>await input.count()>0);
    if (await input.count() !== 1) throw new TaskError('UI_CHANGED');
    phase('uploading');
    await input.setInputFiles(source);
    const filename = path.basename(source);
    const uploadName = page.getByTestId('message_nested_content_file_name').filter({ hasText: filename });
    await this.wait(page, signal, async () => (await uploadName.count()) === 1);
    await this.wait(page,signal,async()=>{
      const card=page.getByTestId('attachment_file_item').filter({has:uploadName});
      if(await card.count()!==1)throw new TaskError('UI_CHANGED');
      const available=await card.getAttribute('data-available');
      return available==='true'||(available===null&&!/上传中|解析中/.test(await card.innerText()));
    },this.uploadTimeoutMs,'TIMEOUT');
    const editor = await this.oneVisible(page.locator('[contenteditable=true],textarea'));
    await editor.fill('请简要概括这篇公开论文。');
    const send = page.getByTestId('chat_input_send_button');
    await this.wait(page, signal, async () => (await send.count()) === 1 && await send.isEnabled());
    phase('sending'); await send.click();
    // A local_ URL is only optimistic UI. Require a server conversation and a
    // newly resolved sent-message card, never retain the pre-navigation element.
    await this.wait(page, signal, async () => {
      const match = new URL(page.url()).pathname.match(/^\/chat\/([^/]+)$/);
      return !!match && !match[1].startsWith('local_');
    });
    const card = page.getByText(filename, { exact: true });
    await this.wait(page, signal, async () => (await card.count()) > 0);
    phase('previewing'); await (await this.oneVisible(card)).click();
    const start = page.getByText(/^(开始翻译|全文翻译|翻译全文)$/);
    const translating = page.getByText(/^关闭翻译$/);
    await this.wait(page, signal, async () => await start.count() > 0 || await translating.count() > 0);
    phase('translating');
    if (await start.count() > 0) await (await this.oneVisible(start)).click();
    // Do not infer export readiness from Chinese preview text. Require the
    // translated-download menu control; disabled menu items do not qualify.
    const menu = page.getByRole('menuitem', { name: '下载翻译版', exact: true });
    await this.wait(page, signal, async () => {
      if (await menu.count() && await menu.isVisible() && await menu.isEnabled()) return true;
      const downloadControl = page.getByRole('button', { name: /^下载$/ }).or(page.locator('[aria-label="下载"],[title="下载"]'));
      if (await downloadControl.count()) {
        const control = await this.oneVisible(downloadControl);
        await control.hover();
        if (!(await menu.isVisible().catch(() => false))) await control.click();
      }
      return await menu.isVisible().catch(() => false) && await menu.isEnabled().catch(() => false);
    }, this.translationTimeoutMs,'TIMEOUT');
    phase('downloading');
    // Register before clicking, await completion before closing the context.
    const downloadPromise = page.waitForEvent('download', { timeout: this.translationTimeoutMs });
    downloadPromise.catch(() => {});
    await menu.click(); const download = await downloadPromise;
    const abortDownload = () => { download.cancel().catch(() => {}); };
    signal.addEventListener('abort', abortDownload, { once: true });
    try {
      signal.throwIfAborted();
      try { await download.saveAs(output); }
      catch (error) { if (signal.aborted) throw signal.reason; throw new TaskError('DOWNLOAD_FAILED'); }
      signal.throwIfAborted();
      if (await download.failure()) throw new TaskError('DOWNLOAD_FAILED');
    } finally { signal.removeEventListener('abort', abortDownload); }
    return { conversationHash: crypto.createHash('sha256').update(new URL(page.url()).pathname).digest('hex') };
  }
  async run(task) {
    let context, page, closing;
    const close = () => {
      const target=this.sharedContext?page:context;
      return target?(closing ||= target.close().catch(()=>{})):Promise.resolve();
    };
    const abort = () => { void close(); };
    task.signal.addEventListener('abort', abort, { once: true });
    try {
      task.signal.throwIfAborted();
      try {
        context = this.sharedContext || await this.launch(this.profile, { channel: 'chrome', headless: this.headless,
          acceptDownloads: true, viewport: { width: 1500, height: 950 } });
      } catch (error) {
        if (/Lock file.*(?:拒绝访问|Access is denied)|EACCES/.test(String(error))) throw new TaskError('PROFILE_ACCESS');
        if (/ProcessSingleton|already in use|SingletonLock/.test(String(error))) throw new TaskError('PROFILE_BUSY');
        throw error;
      }
      task.signal.throwIfAborted();
      page = await context.newPage();
      return await this.translatePage(page, task);
    } finally {
      task.signal.removeEventListener('abort', abort);
      await close();
    }
  }
}
