# 参考项目与既有证据

核查时间：2026-11-01。源码分析与真实集成验证分别标记。

## 官方开发依据

- [插件开发与源码加载](https://www.zotero.org/support/dev/client_coding/plugin_development)。
- [官方 Make It Red 示例](https://github.com/zotero/make-it-red)：官方最小示例，不是本项目完整功能模板。
- [插件生命周期与阅读器扩展接口](https://www.zotero.org/support/dev/zotero_7_for_developers)：manifest.json、bootstrap.js 和阅读器事件。
- [Zotero 10 开发者说明](https://www.zotero.org/support/dev/zotero_10_for_developers)：目标版本的 API 与数据变化。
- [多实例](https://www.zotero.org/support/kb/multiple_instances)及[多配置](https://www.zotero.org/support/kb/multiple_profiles)：profile 与数据目录均须独立，新配置不应假定自动隔离了数据目录。

本项目优先遵循官方插件机制，按需要选择第三方构建工具。windingwind 的模板和 Toolkit 属于社区工具，不等同官方框架；双 PDF 与滚动联动仍需专项实现和验证。

## 开源候选

| 项目 | 固定提交 | 声明范围/许可证 | 作用 |
| --- | --- | --- | --- |
| [ZTransplit](https://github.com/Liozhang/z-transplit/tree/36e884f615d4a05bc9adfd18db99e109034e729e) | 36e884f615d4a05bc9adfd18db99e109034e729e | Zotero 10.* / AGPL-3.0-only | 同步、译文窗格、导入和清理参考；只读原文配置不可照搬 |
| [Split View Reader](https://github.com/zerolfl/zotero-split-view-reader/tree/600f1bd99d9a52a99683702f6681bf34b83bfec3) | 600f1bd99d9a52a99683702f6681bf34b83bfec3 | Zotero 8–9 / AGPL-3.0-or-later | 批注加载保存参考；加入笔记、标签与拖拽等回调未完整实现 |
| [Zotero PDF2zh](https://github.com/guaguastandup/zotero-pdf2zh/tree/5dd2eaf019f71266764c269bbd2104b559ae95cf) | 5dd2eaf019f71266764c269bbd2104b559ae95cf | 声明至 11.* / AGPL-3.0-or-later | 任务进度、插件与本机服务分工 |
| [Zotero Plugin Template](https://github.com/windingwind/zotero-plugin-template/tree/306d4e2a0959a7b2f5e44bb38169fb25f841dbaf) | 306d4e2a0959a7b2f5e44bb38169fb25f841dbaf | 声明至 8.* / AGPL-3.0-or-later | 构建与项目结构参考 |

版本声明不是本项目兼容性验收。实际采用模块前需复核依赖、许可证和文件头注明的 leadero 等来源链。当前尚未复制这些上游实现到 addon 或 worker 源码。

## 已有豆包验证

公开论文：[World-Action Models for Robot Learning and Control: A Survey](https://arxiv.org/abs/2609.16074)。原文为 19 页，4,531,144 字节。实际豆包导出为 19 页，16,091,295 字节，逐页尺寸与原文一致，均为 612×792pt。

译文可提取文字为 0，19 页均含图片；第 3 页部分公式截断。故可作为阅读器和下载链路测试样本，不可作为翻译保真金标准。

已有完整下载成功 1 次；尚未完成本插件的原生批注、模式切换、同步或自动归档验收。已对未修改的候选同步核心做 6 项模拟测试，6/6 通过；不等同真实 Zotero 集成验证。

资料位置：

- `docs/research/豆包PDF翻译脚本探查记录.md`
- `docs/research/开源复用与插件实现方案.md`
- `fixtures/public/doubao-19p/` 中的公开原文、豆包译文、PDF 校验结果与公式对照图。
- `fixtures/public/manifest.json` 记录复制入项目的样本指纹；不包含登录状态。

旧浏览器 profile 与 Cookie 不迁移。旧源码下载与脚本仍保留在原工作区，新项目后续只提取需要、可审计且不含凭据的实现。

## 2026-11-02：手动译文对照候选复核

- [Z-Transplit 中文说明](https://github.com/Liozhang/z-transplit/blob/main/README.zh-CN.md)：面向 Zotero 10，可直接对比同一父条目下另一 PDF，声明滚动、翻页、缩放双向同步。[当前分屏配置](https://github.com/Liozhang/z-transplit/blob/main/src/core/pdf/splitview/readerConfig.ts) 使用空 annotations 和 readOnly:true，并注明原文可在未来开放编辑。因此存在现成对照方案，但不能据此保证用户要求的对照中原文完整批注。
- [Split-View Reader](https://github.com/zerolfl/zotero-split-view-reader)：支持不同 PDF 同标签对照、主视图滚动缩放同步；当前 manifest 限制 Zotero 8–9，不可直接认为兼容本机 10.0.7。

以上为当日 README/源码核对，没有在正式库安装这两个项目。当前手动导入模块自行实现，没有新增复制上游代码。
