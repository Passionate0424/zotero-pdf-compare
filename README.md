# Zotero Doubao Translate

为原文和译文 PDF 提供原文、译文、左右对照三种阅读模式，双向联动滚动，原文保留 Zotero 原生批注。当前可手动导入已下载的译文；豆包网页自动翻译路线受人机验证阻断。

## 当前状态

2026-11-02：P0/P1 已验收完成。P2 已实现双向联动，38 次页位置检查、120 次内部滚动采样通过（P95 49ms，最大非夹取误差约 0.0023），7 张真实 UI 截图已复核；键盘和实际滚动条输入仍待补验。

P3 已实现独立辅助程序、持久串行队列、取消/超时/去重和逐页 PDF 检查。本机浏览器 6 场景通过；真实发送触发人机验证，当前网页方案不满足无人值守要求，下载仍为 0/3，见 [阻断报告](docs/reports/P3-verification-blocker.md)。已停止重试，桌面版接入也尚未验证。

手动入口已加入独立测试版：打开原文点击“导入译文”，或右键原文 PDF 选择“导入已有译文 PDF…”。选择手动下载的文件后复制为独立附件、配对并打开对照。支持重复文件去重、更换译文、重启找回配对；原文及批注不替换。对照初始均分、拖动不跳变、直接切译文与密集联动已有回归，见 [使用说明](docs/MANUAL_IMPORT.md) 和 [测试报告](docs/reports/MANUAL_IMPORT.md)。完整自动归档 P4 和交付 P5 尚未完成。

最新测试版 0.3.1 新增“互换”和“同步缩放”：原译文可左右互换，同步倍率/适应模式和当前页内的二维查看区域；滚动联动独立控制，原文原生批注保留。41 项单元、21 项组合检查和实际重启保留设置通过，见 [更新报告](docs/reports/SWAP_ZOOM.md)。

详见 [P2 报告](docs/reports/P2.md)、[P3 报告](docs/reports/P3.md) 和 [辅助程序用法](docs/WORKER.md)。P2/P3 保留进行中，没有完成标签；main 保持已验收的 P1。开发使用独立测试库，没有系统级鼠标键盘控制。

## 项目文件

- [开发计划](docs/PLAN.md)：阶段、依赖、交付和进入下一阶段的条件。
- [Git 与里程碑](docs/MILESTONES.md)：本地分支、标签、证据和完成判定。
- [P0 验收报告](docs/reports/P0.md)：实际隔离验证、截图、快照和边界。
- [隔离环境搭建步骤](docs/ENVIRONMENT_SETUP.md)：复用现有 Zotero 程序，显式指定独立配置与数据目录。
- [架构](docs/ARCHITECTURE.md)：插件、本机辅助程序、原生阅读器与任务模型。
- [验收清单](docs/ACCEPTANCE.md)：批注、模式切换、联动、自动下载与回退。
- [隔离与回退](docs/SAFETY_AND_ROLLBACK.md)：正式库保护边界和故障处理。
- [参考与证据](docs/REFERENCES.md)：上游来源、固定提交和既有验证边界。
- [工程日志](docs/WORKLOG.md)：后续开发按时间追加，采用 engineering-worklog 格式。
- [既有开源审查](docs/research/开源复用与插件实现方案.md)。

## 目录

```text
addon/src/               Zotero 插件：入口、阅读器扩展、附件归档
worker/src/              豆包浏览器任务辅助程序
shared/                  插件与辅助程序之间的数据协议
tools/                   构建、隔离启动、备份校验与诊断
tests/unit/              纯逻辑测试
tests/integration/       阅读器及任务集成测试
tests/acceptance/        真实 Zotero 人工/自动验收记录
fixtures/public/         公开论文与本次豆包导出样本
docs/                    计划、架构、验收与工程日志
runtime/                 独立配置、测试库、浏览器状态、任务与日志；不提交
artifacts/               测试报告、构建结果；不提交
```

addon/src 和 worker/src 均为开发原型。开发工具使用 Node 24；恢复测试继续使用独立 profile/data，并比较每次运行前后的保护文件：

```powershell
npm test
npm run dev:prepare
npm run dev:stop
npm run dev:snapshot
npm run milestone:check -- P0
node tools/dev-env.mjs protected-audit
```

首次准备创建空配置；启动入口只连接归属已核实的测试进程，临时加载诊断探针并校验实际路径。默认运行环境路径已登记在开发工具中，不适用于其他电脑直接照搬；详见搭建说明。运行数据与凭据不纳入 Git。

项目根目录：`E:\project\zotero-doubao-translate`。不修改 Zotero 本体，不在日常 Zotero 中安装开发版，不共用正式配置、数据库、附件目录或同步状态。具体约束见 AGENTS.md。
