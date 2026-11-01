# Zotero Doubao Translate

通过豆包网页版翻译 PDF，自动保存为 Zotero 附件，并提供原文、译文、左右对照三种阅读模式。对照模式要求双向联动滚动，原文保留 Zotero 原生批注功能。

## 当前状态

2026-11-01：P0 隔离环境已完成真实启动、重启、截图和关闭状态快照验证；产品插件尚未实现。开发配置仅加载身份/截图测试探针，正式 Zotero 保持运行。此前豆包单次真实下载与候选同步核心模拟测试，不代表 P1–P5 已通过。

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

addon/src 与 worker/src 尚无产品实现。开发工具已落地，使用 Node 24：

```powershell
npm test
npm run dev:prepare
npm run dev:start
npm run dev:stop
npm run dev:snapshot
npm run milestone:check -- P0
```

首次准备创建空配置；启动入口只连接归属已核实的测试进程，临时加载诊断探针并校验实际路径。默认运行环境路径已登记在开发工具中，不适用于其他电脑直接照搬；详见搭建说明。运行数据与凭据不纳入 Git。

项目根目录：`E:\project\zotero-doubao-translate`。不修改 Zotero 本体，不在日常 Zotero 中安装开发版，不共用正式配置、数据库、附件目录或同步状态。具体约束见 AGENTS.md。
