# 豆包辅助程序（P3 开发版）

此模块可独立运行，尚未接入 Zotero 的翻译入口和自动附件导入；这些属于 P4。线上当前停在等待登录，3 次真实豆包下载未通过验收。默认无界面运行，无需接管鼠标键盘。

## 环境与专用登录

本机已测试 Node 24.11.1、Chrome 156、Playwright 1.65.0-alpha-2026-10-30、Python/PyMuPDF。依赖精确锁定在 package-lock.json，可用 npm ci 重建。Playwright 是此前验证环境的预发行版本，不能据此宣称任意浏览器版本兼容。

所有命令在项目根目录运行。默认 Python 为本机 D:/anaconda3/python.exe，可通过 DOUBAO_PYTHON 指定。专用浏览器仅使用 runtime/browser-profile，不读取日常 Chrome 或复制 Cookie。

```powershell
npm run worker:login
```

这条显式命令打开专用窗口，由用户手动登录，完成后关闭窗口。夜间测试没有执行此命令或要求用户登录。晨间实际发现关闭再开后登录状态未稳定复用，故此命令尚不能作为可靠认证方案；没有宣称登录目录持久化就能保证认证。此前另一个工作目录中的测试 profile 仅复查状态，没有迁移至项目。

三次验收器另有 `node tools/accept-p3-live.mjs --login` 交互会话选项：保持同一专用浏览器上下文、每任务单独页签，等待匹配本轮 nonce 的本地确认后才执行。该选项的真实登录恢复仍待验收；不要关闭该会话窗口后宣称它保持了内存会话。用户提出的日常 Chrome 配套扩展、桌面版接入另行验证。

## 运行与恢复

```powershell
npm run worker -- run fixtures/public/doubao-19p/world-action-models.original.pdf
npm run worker -- status
npm run worker -- retry <任务编号>
npm run worker -- cancel <任务编号>
npm run test:p3:live
```

run 和 retry 完成时退出；成功为退出码 0，未成功为 2，启动/协议错误为 1。一次只有一个进程持有任务库；独立 status/cancel 命令用于辅助程序已经停止的场合。持续运行时使用同一 stdio 连接发送查询或取消，避免另一个进程争用浏览器和任务库。

默认仅接受 fixtures/public 和 runtime/worker/inputs 中的 PDF。队列复制到按 SHA-256 命名的独立输入文件，之后原路径变化不会改变任务内容。原文复制供测试使用；P4 将负责把选中 Zotero 附件安全送入暂存区。

普通提交按内容指纹、引擎和请求目标语言去重；失败或等待登录的重复提交返回原任务，需要显式 retry。重启时活动任务标为 interrupted，防止静默重复上传；排队任务等待后续提交/重试触发执行。登录等待会暂停整个串行队列。完成文件丢失或指纹变化会撤销成功结果。

test:p3:live 使用专用 profile 创建三次独立任务，记录每次耗时、状态、PDF 指纹和会话路径的不可逆摘要；只有 3 次真实下载、各 19 页逐页有效且会话摘要各异才通过。遇到登录或其他错误即停止。详细记录与文件保留在 runtime/p3-live-*/ 中，不写入正式 Zotero。

## stdio 协议 v1

`npm run worker -- serve` 启动本地逐行 JSON 接口，无 HTTP 服务。请求与回复各占一行，id 用于关联，protocol 固定为 1。

```json
{"protocol":1,"id":"a1","action":"submit","task":{"source":"E:/project/zotero-doubao-translate/fixtures/public/doubao-19p/world-action-models.original.pdf","targetLanguage":"zh-CN"}}
{"protocol":1,"id":"a2","action":"status"}
{"protocol":1,"id":"a3","action":"cancel","taskId":"任务 UUID"}
{"protocol":1,"id":"a4","action":"retry","taskId":"任务 UUID"}
```

成功回复包括 ok=true 与 data，失败包括 ok=false 与固定错误 code/message。status 返回当前快照；没有声明实现推送式进度通知。当前仅接受请求中文，网页语言控件和实际译文语种仍需恢复登录后线上验证。

| 状态 | 含义 |
| --- | --- |
| queued | 等待执行 |
| opening / uploading / sending | 打开专用网页、上传、发送 |
| previewing / translating | 打开附件预览、触发网页翻译 |
| downloading / validating | 等待真实下载完成、逐页解析校验 |
| succeeded | 完整文件已通过检查，可交由后续归档阶段处理 |
| waiting_login | 需要用户在专用浏览器登录，再显式重试 |
| failed / cancelled / interrupted | 已停止；错误码解释原因，可显式重试 |

取消关闭该任务自己的浏览器上下文并清除部分文件；不会自动删除豆包会话。它中止本机后续处理，不能撤回已经发送给豆包的内容。

## 文件与凭据

队列在 runtime/worker/tasks.json 中，用排他锁、临时文件、fsync 和同目录重命名保存。pending 仅用于未完成下载，结果只有逐页验证后才出现在 results。下载事件在点击前注册，saveAs 完成并确认 failure 为空后才关闭浏览器，依据 [Playwright 官方下载接口](https://playwright.dev/docs/downloads)。

验证包括 PDF 头、大小边界、可解密打开、每页尺寸/文字解析和小比例实际渲染、页数与原文一致、结果指纹不同于原文。它保证文件结构可读，不保证翻译语义、公式或排版保真。图片型 PDF 会标记无文字层。

登录状态只由专用 Chrome 本地保存。任务记录不保存 Cookie、令牌、请求头、签名下载地址或原始浏览器错误。公开错误采用固定枚举，回复保留任务编号、内容摘要、计数和相对结果路径。XPI 采用 6 文件白名单构建，不携带 worker 登录状态；node_modules、runtime 和 PDF 样本不进入 Git。

## 验证入口

```powershell
npm test
npm run test:p3:local
npm run test:p3:live
```

local 是本机临时 HTTP 测试网页，覆盖真实浏览器下载、缺登录、控件变化、超时、断网和取消；**不计入豆包线上下载次数**。临时目录只清理已验证的项目内专属目标。线上状态和未完成事项见 [P3 报告](reports/P3.md)。
