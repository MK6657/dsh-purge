# Windows 桌面兼容对照版：1.1.72-dsh021.2

记录日期：2026-10-24。

## 来源和分支

- 仓库：[MK6657/dsh-purge](https://github.com/MK6657/dsh-purge)。
- 分支：`compat/dsh-0.2.1-rc.3-windows`。
- 基线：原 fork 的 **1.1.72**，提交 [`ec69166706bed95efb6c35e225b01588f3cd9b72`](https://github.com/MK6657/dsh-purge/commit/ec69166706bed95efb6c35e225b01588f3cd9b72)。
- [查看本分支与基线的差异](https://github.com/MK6657/dsh-purge/compare/ec69166706bed95efb6c35e225b01588f3cd9b72...compat/dsh-0.2.1-rc.3-windows)。
- 原始项目和作者：[YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge)。同步备份及新版组装匹配参考上游 [1.1.78 的 core.js](https://github.com/YuJunZhiXue/dsh-purge/blob/fd109e106ce5818b3c00524123a3431e4afc0e81/lib/core.js)，本分支保留 MK6657 fork 已有的 folded-complete 行为。

本次仅推送此分支，不合并 `master`，不发布 npm 包或修改上游仓库。版本后缀 `dsh021.N` 用于区分这份兼容代码及其后续补修。

**补修记录：**`dsh021.1` 的验证遗漏了自定义红队预设；它仍会因新版移除 `toolFilter` 而显示“加载失败”。`dsh021.2` 同时修复随包模板和已有用户预设的局部迁移，重启后已确认注册成功。

## 适配和验证范围

| 项目 | 本次范围 |
| --- | --- |
| DSH | 官方 DeepSeek Harness **0.2.1-rc.3** |
| 平台 | **Windows x64 官方桌面 EXE** |
| Profile | `desktop` |
| 插件基线 | MK6657 fork **1.1.72** |
| 分支包版本 | **1.1.72-dsh021.2** |
| 回归测试 Node | **22.23.1**；无需启动 DSH 或请求模型 |
| 实机验证 | 桌面启动、插件就绪、补丁检测、CLI `--version`；红队预设运行时注册和设置页状态 |

首次启动链路修复验证时插件仍显示原版本号 `1.1.72`；此次预设补修后，本机已运行 `1.1.72-dsh021.2`。分支修复代码与本机验证的代码一致。

Web、macOS、Linux、社区桌面端及其他 DSH 版本没有做本次实机验证。旧版组装匹配规则保留，并有最小结构回归测试；这不等于这些平台或版本已经完整验证。

## 修复对照

| 问题 | 原行为 | 本分支改动 |
| --- | --- | --- |
| CLI 备份异步异常 | 同步的 `repairOfficialCliAfterUnpack()` 调用异步 `atomicCopyFile()`，`try/catch` 捕获不到后续拒绝；曾出现 `.copytmp` 重命名的 `ENOENT` 崩溃 | 新增 `atomicCopyFileSync()`，让备份在返回前完成，错误在同步调用栈中处理；重命名失败清理临时文件 |
| Windows 启动脚本被占用 | 原子重命名覆盖 `dsh.cmd` 遇到 `EPERM`，启动入口未修复 | 仅 Windows 的 `EPERM` / `EBUSY` / `EACCES` 且原始备份存在时，尝试原位写入并精确读回校验；其他错误继续报告失败 |
| DSH 0.2.1 的补丁 #40 匹配失败 | 新版组装尾部增加 `requiredContexts`，原匹配不命中，宿主完整性检查失败，界面提示“清洗没有写进全部宿主” | 新增对应结构的匹配；保留 transformed persona、工具表、此 fork 的注入排序；抑制运行时上下文时保留 `required === true` 的条目 |
| 宿主校验标记不完整 | 没识别此 fork 的 `fold-complete inject first` 标记，旧的 complete 覆盖结构也可能漏检 | 识别 folded 标记，并检测遗留的 `: [completeSection]` 结构 |
| 红队模式加载失败（dsh021.2） | 随包模板及旧用户预设含 `toolFilter`；新版 subagent 插件加载时直接拒绝此字段 | 模板移除废弃字段；启动时只迁移 subagent 行的该配置，保留用户正文、其他插件配置、`maxDepth` 和自定义 `agentPreset` |

启动链路改动位于 `lib/core.js`、`lib/desktop.js` 和 `lib/host-clean.js`。红队预设补修位于 `lib/redteam/index.js`、`lib/redteam/subagent-config.js` 和 `presets/redteam/agent.cordis.yml`。没有整份覆盖用户预设。

`toolFilter` 的旧 deny 列表不再生效。本分支保留 `maxDepth: 1` 限制此 spawn 工具的递归深度，没有把自定义 deny 列表转换成独立的子级工具集；需要定制子级工具集时，应按新版 DSH 使用独立 Agent Preset 并通过 `agentPreset` 选择。

## 安装此分支

先保留现有配置备份。在有 `dsh` 命令的终端执行：

```powershell
dsh plugin --profile desktop add "https://github.com/MK6657/dsh-purge/archive/refs/heads/compat/dsh-0.2.1-rc.3-windows.tar.gz"
```

`dsh` 不在 PATH 时，用当前 DSH 安装目录下 `resources/runtime/cli/bin/dsh.cmd` 的完整路径调用相同参数。

分支地址会随后续提交变化。需要固定版本时，将上述 URL 中的 `refs/heads/compat/dsh-0.2.1-rc.3-windows` 换为 GitHub 上本次修复提交的完整 SHA。

安装到 profile 之后，按插件原有“应用”流程写入宿主。首次解包后的程序包切换仍有下面的已知限制。

**更新来源：**内置“检查更新”仍使用原项目的 `YuJunZhiXue/dsh-purge`，没有改为本分支。通过该功能升级可能覆盖这里的兼容代码；要复现本分支，请使用此分支或固定提交 SHA 安装。

## 自动 ASAR 切换的已知限制

本机旧 helper 曾先尝试 WScript，再回退 PowerShell；宿主退出后没有完成 `app.asar` 切换。因此本分支**没有将“一键应用后自动切换并重启”标为已修复**。

本次验证是在补丁写入并通过宿主检查后，正常退出所有 DSH 进程，保留原包并手动完成一次切换，再启动 EXE。若遇到相同问题：

1. 正常退出 DSH，确认对应安装路径的 EXE 进程全部结束。
2. 确认 `resources/app` 已完整解包，包含 `package.json`、宿主代码、原包的 unpacked 原生模块，以及正确的 runtime 入口。仅有空目录不算完成。
3. 保留原始 `resources/app.asar`，移到未占用的备份名。不要覆盖已有备份；不要在 DSH 仍运行时操作。
4. 启动原来的 EXE，确认宿主使用 `resources/app`。若启动失败，正常退出后恢复原始 `app.asar`；保留诊断日志再排查。

这段操作是实机恢复记录，不是本分支新增的自动修复功能。已经完成切换且启动正常的机器无需重复操作。

## 验证结果和边界

实机验证观察到：

- `ready: true`，`surface: desktop`。
- 宿主路径已指向解包后的 `resources/app/dsh/node_modules/@deepseek-ai`。
- `asar_still_sealed: false`。
- **66 项已应用、0 项待处理、6 项跳过**；补丁 #40 已应用，宿主完整性检查通过。
- 插件面板可打开，没有再次出现“清洗没有写进全部宿主”的提示。
- `dsh.cmd --version` 返回 **0.2.1-rc.3**，新启动后没有新增崩溃日志。
- 原始程序包、CLI 备份和既有配置已保留。
- dsh021.2 重启后，红队预设状态为 **`ok: true`、`phase: registered`、`broken: null`**；设置页中红队模式卡片的红框及“加载失败”标记已消失。旧用户预设在启动时完成迁移。

上述 6 项仍标记为跳过（#32、#53、#71、#77、#80、#88），本分支没有声称它们已应用，也没有声称 72 项全部完成。它们没有被当前插件报告为待处理项。

没有发送模型测试对话，因此本记录只确认安装、补丁加载和启动链路，不保证任何模型的回复效果。

## 回归测试

在仓库根目录运行：

```powershell
npm test
```

测试直接使用 Node 内置 `node:test`，无需额外安装测试依赖。测试只创建并清理自己创建的临时目录，使用最小 CMD/组装结构样本，不读取本机账号、个人提示词或实际 DSH 安装。

本次运行结果：**24 项通过，0 项失败，0 项跳过**（Windows x64 / Node 22.23.1）；包含 7 项新增的红队预设兼容测试。

覆盖同步备份、复制失败清理、失败备份不产生未处理拒绝、重复修复保留原备份、Windows 锁文件回退及其限制、写后读回校验、0.2.1 四种 complete/context 组合、旧组装规则和宿主校验。Windows 专属回退测试在其他系统明确跳过。

红队预设测试覆盖模板解析、旧配置局部迁移、空行和注释、CRLF、重复迁移、内联 filter、其他插件同名字段、用户正文保留，以及自定义 `agentPreset` 与深度设置保留。测试不会执行子智能体或模型请求。

## 回到原 fork 版本

如需重新安装此分支之前的插件代码，可固定安装原基线提交：

```powershell
dsh plugin --profile desktop add "https://github.com/MK6657/dsh-purge/archive/ec69166706bed95efb6c35e225b01588f3cd9b72.tar.gz"
```

更换插件包不会自动还原已经写入宿主的补丁。宿主还原需使用插件原有“还原”流程或已保留的原始程序包，并在正常退出 DSH 后处理程序包文件。
