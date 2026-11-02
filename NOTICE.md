# 来源与许可

本项目源码按 AGPL-3.0-only 提供，完整条款见 LICENSE。

阅读器架构参考：

- Zotero 10.0.7 内置 reader.js：保留原生 ReaderTab、批注宿主和官方阅读器事件接口。
- ZTransplit，提交 36e884f615d4a05bc9adfd18db99e109034e729e：译文 browser/createReader、跨域配置及资源清理的接口模式参考。
- Split View Reader，提交 600f1bd99d9a52a99683702f6681bf34b83bfec3：批注回调差异核查。

P1 使用独立实现的宿主保留布局，未整体复制上述项目的双阅读器实现或替换原文批注回调。以后实际移植上游模块时，继续保留原文件作者、来源链及许可声明。

P3 的外部运行依赖为 Microsoft Playwright / playwright-core 1.65.0-alpha-2026-10-30，精确版本与下载完整性见 package-lock.json，其包内 LICENSE 为 Apache-2.0。依赖不打入当前 XPI；未来分发辅助程序及依赖时须随附各依赖许可和通知。
