# P3 真实发送验证：人机验证阻断

2026-11-02。用户要求继续解决专用 Chrome 的纯脚本流程。本轮只操作项目专用浏览器，没有 Computer Use、日常 Chrome 接管或正式 Zotero 写入。

## 问题现象

用户在专用窗口登录并保持窗口打开。脚本持续观察到 chat_header_avatar_button，loginVisible=false；上传附件 data-available=true。随后发送的公开 PDF 对话出现可见 message_box_failed_icon，地址停留 local_ 会话，原 provider 最终报 UI_CHANGED。

一次失败消息重试的实际 /chat/completion 响应为 HTTP 200、text/event-stream，错误码 710022004。后续脚本检查到可见的 https://rmc.bytedance.com 验证 iframe。没有有效译文下载。

## 根因与证据边界

本次同一浏览器进程内的发送受到人机验证阻断，不能归因为本次登录丢失。原脚本只等待正式会话地址，没有识别这个服务状态，所以把发送阻断误报为控件变化。

这不解释此前跨进程重启后显示登录的全部现象：此前的登录复用问题仍独立保留为未定位，不能据本轮结果宣称已解决。

本轮只记录错误码、固定 UI 标记、来源域名与控件状态，没有保存 Cookie 值、请求头、验证码内容、验证签名或原始响应体。另发现已登录网页有两个 file input；单纯断言全页面只有一个上传框不可靠。

关键实测摘录：

```json
{
  "signedInMarker": "chat_header_avatar_button",
  "loginVisible": false,
  "attachmentAvailable": true,
  "visibleFailedMessage": true,
  "completion": {
    "route": "/chat/completion",
    "httpStatus": 200,
    "contentType": "text/event-stream",
    "errorCode": 710022004
  },
  "visibleVerificationFrameOrigin": "https://rmc.bytedance.com",
  "newTranslatedPDFs": 0
}
```

响应与控件的原始脱敏记录在本机 runtime/p3-retry-trace.json、p3-send-error.json、p3-session-state.json，未纳入 Git。上述 iframe 来源来自脚本 DOM 检查返回值，不是从第三方文章推断。

## 产品判定与处理

用户指出需要人机验证就不能满足自动化目标。因此停止重试，关闭本轮专用窗口和诊断进程；没有代做、规避或绕过验证。没有修改生产 provider 或把验证机制隐藏为已解决。

豆包网页路线目前只能作为可能需要用户参与的可选方案，不能作为已验收的无人值守翻译后端。P3 保持未完成，三次独立真实下载仍为 0/3。桌面版是否存在同类限制、是否可程序化导出，尚未验证；不能因它已登录就宣称更可靠。

阅读器、原文原生批注、附件配对及任务队列的已有工作可保留，翻译 provider 后续可以替换。要满足无人值守要求，需要另行核实具有明确程序接口的 PDF 翻译/导出方案及其版面质量，不把通用模型对话 API 当作等价 PDF 导出能力。
