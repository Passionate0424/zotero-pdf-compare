# 隔离环境搭建步骤（P0）

状态：方案已具体化，尚未创建测试 profile/user.js、启动 Zotero 或安装插件。下面的命令是后续执行步骤，不是已运行记录。

## 1. 复用现有程序，隔离配置和文献库

默认不重装、不复制 Zotero，使用当前安装的可执行程序。另行安装只在需要测试不同版本或调试构建时才有价值，不是插件开发的前提。官方允许多配置及多实例，但要求 profile 和数据目录都独立。[官方说明](https://www.zotero.org/support/kb/multiple_instances)

2026-11-01 已通过只读文件检查取得：

| 用途 | 路径/版本 | 处理方式 |
| --- | --- | --- |
| 已安装程序 | D:\D_Applications\Zotero\zotero.exe，10.0.7 | 只用于执行；不改安装文件，不由测试实例升级 |
| 正式 profile | C:\Users\18522\AppData\Roaming\Zotero\Zotero\Profiles\jza7s4xb.default | 受保护，不改 prefs 或插件 |
| 正式文献库 | D:\Zoterodata | 从正式 prefs 的 dataDir/useDataDir 只读确认；不复制或操作 |
| Node | v24.11.1 | 已核对；worker 具体依赖后续固定 |

进程命令行的 CIM 查询在当前受限环境失败，不能据文件路径就宣称已核验运行中的进程。P0 实际启动时仍须验证测试进程身份。正式程序版本可能更新，启动前重读版本，避免把 10.0.7 当成永久固定值。

## 2. 创建空目录并写入专用配置

在项目 runtime 下创建：

```text
E:\project\zotero-doubao-translate\runtime\zotero-profile
E:\project\zotero-doubao-translate\runtime\zotero-data
E:\project\zotero-doubao-translate\runtime\browser-profile
E:\project\zotero-doubao-translate\runtime\jobs
E:\project\zotero-doubao-translate\runtime\logs
E:\project\zotero-doubao-translate\runtime\backups
```

首次创建必须确认 profile/data 为空；后续启动要求与本项目登记标记相符。路径预检检查所有祖先目录的 junction/符号链接，防止表面在 E 盘、实际指向正式库。

从空 profile 创建 `user.js`，不复制正式 prefs、账号或数据库。初始内容：

```javascript
user_pref("extensions.zotero.useDataDir", true);
user_pref("extensions.zotero.dataDir", "E:\\project\\zotero-doubao-translate\\runtime\\zotero-data");
user_pref("extensions.zotero.sync.autoSync", false);
user_pref("extensions.zotero.sync.storage.enabled", false);
user_pref("extensions.zotero.sync.storage.groups.enabled", false);
user_pref("extensions.zotero.sync.fulltext.enabled", false);
user_pref("extensions.zotero.httpServer.enabled", false);
user_pref("extensions.zotero.httpServer.localAPI.enabled", false);
user_pref("app.update.auto", false);
```

同步禁用项是额外防护，最关键的是空 profile 不登录同步账号、不带正式凭据。HTTP 服务关闭以避免测试实例被日常 Connector 选中；后续本机 worker 由插件主动连接，不依赖正式 Zotero 的 23119 服务。若测试专用 API 确有需要，再配置独立端口与实例身份检查，不修改日常 Connector。

上述 dataDir 和同步/HTTP 首选项已在本机 10.0.7 的 app/omni.ja 中做静态检查。禁止仅运行 `zotero.exe -P` 建立配置后就假定数据也已隔离；官方明确提示新配置可能仍指向原库。[多配置说明](https://www.zotero.org/support/kb/multiple_profiles)

## 3. 从固定入口启动

后续封装 `tools/start-zotero-dev.ps1`，先检查程序、目录、标记和配置，再使用完整参数启动：

```powershell
& 'D:\D_Applications\Zotero\zotero.exe' `
  -no-remote `
  -profile 'E:\project\zotero-doubao-translate\runtime\zotero-profile' `
  -datadir 'E:\project\zotero-doubao-translate\runtime\zotero-data'
```

`-profile` 选择独立配置，`-datadir` 明确指定数据库位置；本机 dataDirectory.js 已确认支持该数据目录参数。`-no-remote` 用于避免将启动请求转交给已运行实例。失败时停止，不删除参数重试，不自动打开默认配置，也不结束日常 Zotero。

此入口与 prefs 双重指定数据目录，启动后还必须核对实际使用位置，不能仅凭参数认定成功。

## 4. 首次启动只检查环境

首次不安装本插件、不登录同步、不使用 Word/LibreOffice/浏览器 Connector。核验：

1. 实际 profile、实际 dataDir 与登记值一致，“显示数据目录”打开 E 盘测试目录；新数据库也只出现在测试目录。
2. 没有正式文献、账号和已有插件。空库可能有 Zotero 自带示例，不能据此误判。
3. 测试不监听正式 Connector 服务，不向 Word 安装/更新集成，不改变默认应用关联；检查首次运行提示和集成副作用。不能控制时先调整启动方案。
4. 仅导入 fixtures/public 的论文副本，给测试库设置醒目的测试标记。
5. 正常退出、重新启动仍使用同一空测试库；正式配置与安装文件未被测试操作修改。
6. Zotero 退出且数据库连接关闭后建立第一次快照，记录 profile/data 的文件清单与哈希。

以上通过后，才向该测试 profile 加载本插件。源码直载或安装 XPI 均限测试 profile；开发入口参考[官方插件开发文档](https://www.zotero.org/support/dev/client_coding/plugin_development)。

## 5. 回退与边界

禁用/卸载时撤掉插件 UI、事件、任务和本机连接，但已保存的附件、文献改动或设置不是自动回滚的事务。需要清理时按任务记录精确识别新增项；数据库级恢复只在关闭的测试库中按快照操作。

独立配置和数据目录隔离正常开发写入，不等于操作系统限制插件的文件权限。我们仍须审查路径、限定代码行为，不能声称安装为插件就天然无法访问正式文件。

## 官方机制与本项目选择

官方提供 bootstrap.js/manifest.json 插件机制、生命周期、偏好面板、阅读器工具栏及菜单事件，并给出 [Make It Red](https://github.com/zotero/make-it-red) 示例；目标 Zotero 10 的变化以[官方版本说明](https://www.zotero.org/support/dev/zotero_10_for_developers)核对。

官方机制不自动实现双文档分屏、联动滚动或数据回滚。社区模板/Toolkit 可作为构建便利工具，实际采用前固定版本；优先用官方扩展接口，双 PDF 宿主与滚动适配集中封装，并在隔离测试库验收。
