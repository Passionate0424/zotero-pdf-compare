# 安装 PDF 译文对照阅读

安装包：`zotero-pdf-compare-0.3.6.xpi`，适用于 Zotero 10.0，已验证 Windows / Zotero 10.0.7。从 [GitHub Release](https://github.com/Passionate0424/zotero-pdf-compare/releases/latest) 下载。

在 Zotero 中选择“工具 → 插件”，点击齿轮菜单，选择“从文件安装插件”，打开上述 XPI。安装后插件名称为“PDF 译文对照阅读”。插件更新通过 GitHub Release 的更新清单提供，也可以手动安装新版本。

选中原文 PDF 后使用“导入译文”选择已下载的译文文件。支持原文、译文、对照三种模式、左右互换、滚动联动和缩放查看区域同步。滚动由“联动”控制，缩放由“同步缩放”控制。原文支持原生批注，插件内译文窗格只读。配对信息保存在本机配置中。

插件包不包含本地翻译引擎或自动翻译服务。禁用或卸载会移除插件界面和联动逻辑；已导入的附件与配对设置会保留。

构建命令：`python tools/build-dev-xpi.py --release`。开发包继续使用独立测试环境保护，默认构建命令保持不变。正式包经过独立 Zotero 实际加载、原文批注 10 项和连续模式切换 8 项检查；尚未在用户正式配置内验证其他插件共存。

Release 附带同名 `.sha256` 文件供核对安装包指纹。
