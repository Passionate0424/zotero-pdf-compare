/* SPDX-License-Identifier: AGPL-3.0-only */
export class TaskError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export const messages = {
  LOGIN_REQUIRED: '请在专用浏览器中登录豆包，再重试任务。',
  UI_CHANGED: '网页控件发生变化，已停止操作。',
  NETWORK_ERROR: '网络连接失败，请检查网络后重试。',
  TIMEOUT: '任务超过等待时间，已停止。',
  CANCELLED: '任务已取消。',
  INTERRUPTED: '辅助程序曾中断，请手动重试。',
  PDF_INVALID: '下载文件不是可完整读取的 PDF。',
  PAGE_COUNT: '下载 PDF 页数与原文不一致。',
  SOURCE_UNCHANGED: '下载文件与原文完全相同，未确认得到译文。',
  DOWNLOAD_FAILED: '译文下载未完成。',
  PROFILE_BUSY: '专用浏览器正在使用中，请关闭后重试。',
  PROFILE_ACCESS: '专用浏览器目录无法访问，请检查辅助程序的运行权限。',
  WORKER_BUSY: '辅助程序正在运行，请通过当前连接查询或取消任务。',
  INPUT_INVALID: '输入文件或目标语言无效。',
  INTERNAL_ERROR: '任务未完成，可查看任务编号后重试。',
};
// Persist only allowlisted codes/messages. Browser errors can include signed URLs,
// request headers, document text, or local paths and must not reach task logs.
export function publicError(error) {
  let code = error?.code;
  if (!Object.hasOwn(messages, code)) {
    const text = String(error?.message || '');
    code = /Lock file.*(?:拒绝访问|Access is denied)|EACCES/.test(text) ? 'PROFILE_ACCESS'
      : /ProcessSingleton|SingletonLock|profile.*already in use/.test(text) ? 'PROFILE_BUSY'
      : /net::ERR_|ENET|ECONN/.test(text) ? 'NETWORK_ERROR'
      : error?.name === 'TimeoutError' ? 'TIMEOUT' : 'INTERNAL_ERROR';
  }
  return { code, message: messages[code] };
}
