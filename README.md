# Token Trace —— Codex 桌面版 Token 消耗分析

[English](README.en.md) | [简体中文](README.md)

> 🤖 如果你是 AI 编码助手（Codex / Claude / Copilot 等），请直接阅读 [README.agent.md](README.agent.md) —— 专为 Agent 编写的安装指南。

一个不依赖 Codex++ 的本机 Token 分析工具。它在 Codex / ChatGPT **桌面版**旁提供独立悬浮入口和浏览器统计页：看清今日 Token 去向、找出高消耗任务、按不同模型比较理论费用，并把可解释的数据包交给任意 AI 分析。

![Token Trace 深色总览（公开演示数据）](docs/images/dashboard-overview-demo.png)

> 上图为当前版本的真实浏览器界面，数据为公开演示数据，不包含任何用户会话内容。

## 能做什么

| 功能 | 你会看到什么 |
| --- | --- |
| 今日消耗总览 | 今日累计 Token、任务数、请求数、缓存命中率，以及新输入 / 缓存 / 输出构成。 |
| 任务占比排行 | 按 Codex 对话归类并排序；任务标题会自动压缩，避免超长对话名挤坏界面。 |
| 模型费用对比 | 使用同一份今日 Token 构成，套入 DeepSeek、Qwen、GLM、Kimi、GPT 等可编辑价格进行理论费用比较。 |
| 悬浮球与快速卡片 | 黑猫悬浮球可自由拖动、记忆位置；悬停/点击后查看最近活动任务、今日累计与缓存命中。 |
| 一键分析数据包 | 复制“提示词 + 已脱敏统计数据”，粘贴给任意 AI，让它做消耗原因和优化建议分析。 |
| 深浅主题与自定义封面 | 大型面板和悬浮卡同步切换主题；可上传图片并裁切为圆形悬浮球封面。 |

使用路径很简单：**打开 Codex → 悬浮球自动出现 → 打开统计页 → 找到高消耗任务 → 比较模型 → 复制数据包给 AI 分析。**

## 支持环境

- **操作系统：仅 Windows**（开发与测试基于 Windows 10 22H2；macOS / Linux 未支持，开机自启守护为 Windows 专属）。
- **客户端：Codex / ChatGPT 桌面版**（不支持 codex CLI）。
- 无需预先安装 Node.js：一键安装器会在需要时下载官方 Node.js 运行时到当前用户目录。
- **不需要 Codex++**，不使用页面注入、侧边栏或调试端口。

## 一键安装（推荐）

在 PowerShell 中粘贴下面这一行即可：

```powershell
$u='https://raw.githubusercontent.com/lanm777888999-stack/codex-token-trace/main/Install-TokenTrace.ps1'; $p=Join-Path $env:TEMP 'Install-TokenTrace.ps1'; Invoke-WebRequest $u -OutFile $p; powershell -NoProfile -ExecutionPolicy Bypass -File $p
```

安装器会：

- 从 GitHub 锁定一个提交版本并下载 Token Trace 源文件；
- 仅在本机缺少 Node.js 22+ 时，从 `nodejs.org` 下载官方运行时；
- 安装到 `%LOCALAPPDATA%\TokenTrace`；
- 注册 WMI 事件守护。此后用户从桌面、开始菜单或任务栏正常打开 Codex，Token Trace 都会自动出现；全部 Codex 窗口关闭后会自动停止。

该命令会先把公开安装脚本下载到临时目录，再以一次性执行策略运行；不使用 `irm | iex`。希望先审阅脚本时，可先在浏览器打开 [Install-TokenTrace.ps1](Install-TokenTrace.ps1) 再运行。

卸载自动跟随功能：

```powershell
powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\TokenTrace\uninstall-autostart.ps1"
```

卸载会保留主题、模型价格和自定义悬浮封面；如需移除程序文件，可在卸载后删除 `%LOCALAPPDATA%\TokenTrace`。

## 文件说明

- `token-stats.mjs` — 本机统计/API/浏览器面板服务
- `dashboard.html` — 浏览器大型统计界面
- `floating-panel.ps1` — 独立 Windows 悬浮入口，可自由拖动并记住位置，默认使用黑猫 Token logo
- `Install-TokenTrace.ps1` — 从 GitHub 一键下载、安装并启用 WMI 跟随的公开安装器
- `launch-codex-token-trace.ps1` / `install-launcher-mode.ps1` — 旧的低耗启动器模式；新用户优先使用一键安装
- `guardian.ps1` / `install-autostart.ps1` / `uninstall-autostart.ps1` — 可选 WMI 事件守护模式（Windows 专属；不轮询）

## 运行

**源码开发 / 手动运行：**

```powershell
node token-stats.mjs --server
```

浏览器大型界面：`http://127.0.0.1:8766`

手动调试悬浮窗可运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\floating-panel.ps1
```

## 面板说明

- 悬浮入口是可自由拖动的圆形图片球；默认封面为 `assets/token_black_cat.png`，点击展开/收起，位置会记住。
- 在浏览器大型界面点击「悬浮封面」可上传图片，工具会自动居中裁切为圆形 PNG，并保存到 `%LOCALAPPDATA%\ccm-token-spend\floating-cover.png`。
- 悬浮卡保持简洁：最近活动任务、本轮 Token、今日累计、缓存命中、打开大型界面和复制数据包。
- 大型界面支持深色 / 浅色主题切换，主题偏好保存在本机浏览器中。
- 大型界面路径为：**今日累计 → 任务占比 → Token 构成 → 模型费用对比 → 复制提示词 + 数据包**。
- 大型界面的任务排行按 Codex 对话归类；任务名称来自标题或首条用户消息摘要，方便外部 AI 分析。
- 模型对比基于**今日总 Token 构成**套用价格。内置价格是可编辑演示值，不代表官方实时价格；修改后只保存在本机浏览器存储中。
- 「提示词 + 数据包」包含今日全部任务汇总、任务占比、Token 构成和模型价格表；包含任务摘要，但不包含完整对话、文件路径、密钥或原始日志。

## 截图与演示数据

仓库提供安全的演示模式，便于试用或制作截图，不会读取真实 Codex 会话：

```powershell
node token-stats.mjs --server --demo --port 8767
```

然后打开 `http://127.0.0.1:8767`。演示模式只使用内置的虚构任务与固定 Token 数字。

## 旧版：低耗启动器模式

如果希望“打开 Codex 时自动启动，关闭 Codex 时一起关闭”，且不想登录 Windows 后常驻守护进程，使用启动器模式：

```powershell
powershell -ExecutionPolicy Bypass -File .\install-launcher-mode.ps1
```

它会在桌面创建 `Codex + Token Trace.lnk`。以后从这个快捷方式打开 Codex，即可同步启动本机服务和悬浮窗；关闭 Codex 后，启动器会停止 Token Trace。

> 这个模式最省资源：不点快捷方式时，没有后台守护进程常驻。

## 可选：登录后守护模式

如果希望无论从哪里打开 Codex 都自动拉起 Token Trace，可以安装 WMI 事件守护进程：登录 Windows 后它只订阅 Codex / ChatGPT 的进程启动和退出事件；收到启动事件才启动本机服务和悬浮窗，收到退出事件后确认全部 Codex 进程已关闭才停止。**不再使用每 2 秒一次的轮询。**

1. 在 PowerShell 中进入本工具目录，运行：

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install-autostart.ps1
   ```

2. 安装后立即生效（无需重启 Codex）。卸载时运行：

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\uninstall-autostart.ps1
   ```

> 守护模式会注册「计划任务」（登录触发）自动运行；守护进程内置单实例锁，不会重复运行。它是一个极轻量的 WMI 事件等待进程，而不是周期性检查器。
>
> 运行日志：`%LOCALAPPDATA%\ccm-token-spend\guardian.log` 和 `server.log`。
>
> 卸载只会停止守护进程、服务与悬浮窗；本机主题、价格和自定义封面会保留。

## 数据说明

- 只读取 Codex 自己的本地会话日志（`%USERPROFILE%\.codex\sessions\...\rollout-*.jsonl`），**不涉及任何密钥**，面板只显示数字摘要。
- 「会话累计」= 该对话所有请求的 billed token 之和（含每轮重复发送的上下文）。
- 「上下文窗口（已用/总量）」= 已用为当前对话最新一次请求的上下文占用，总量为模型上下文窗口大小。
- 「每轮」= 一次用户消息到下一次用户消息之间发生的所有请求。
- 「今日任务」= 今日发生 Token 请求的 Codex 对话；今日总量按本机时区聚合最近会话日志。
- 输入缓存拆分：`输入 X（缓存命中 Y，未命中 Z）`，其中未命中 = 输入 − 缓存命中；旧日志没有缓存字段时自动显示为 `输入 X + 输出 W`。
- 不进入 Codex 页面时，无法可靠判断“用户刚切换但尚未产生请求的旧任务”；悬浮卡使用“最近活动任务”措辞。
- 工具不做内置异常诊断，分析由用户复制数据包后交给任意 AI 完成。

## 开发者：命令行直接查看（无需面板）

```powershell
node token-stats.mjs                  # 最近一个对话
node token-stats.mjs --thread <id>    # 指定对话
node token-stats.mjs --detail         # 附带每次请求明细
node token-stats.mjs --all            # 所有对话的累计消耗
```

## 开发者：重新打包 exe（可选）

```powershell
cd build
npm install          # 首次需要：安装 @yao-pkg/pkg
.\node_modules\.bin\pkg ..\token-stats.mjs --target node22-win-x64 --output ..\release\exe-version\ccm-token-spend.exe
```

## 更新记录（Changelog）

版本更新说明见 [CHANGELOG.md](CHANGELOG.md)。

## 测试环境

- Windows 10 22H2（build 19045）
- Codex 桌面版 26.727.6591.0
- Node.js v24.14.1
- 目前接入的是**第三方 API**，测试时固定单一模型；**未测试切换模型**（同一对话中更换模型）的效果。
- 已实测：命令行统计输出、本机服务 `/api/state`、`/api/pack`、浏览器大型界面、悬浮窗脚本自检、守护脚本语法检查。
- macOS / Linux 未测试。

## 📝 环境测试报告（欢迎参与）

欢迎大家测试后分享自己的运行环境，帮助项目收集更多兼容性数据。请在 [GitHub Discussions](https://github.com/lanm777888999-stack/codex-token-trace/discussions) 的 **General** 分类新建讨论，按模板填写即可（会自动带上「测试报告」标签）：

- **Release 版本号**：如 `v1.2-node`（Node 版）/ `v1.2-exe`（内置 Node 版）
- **操作系统**：如 Windows 10 / Windows 11
- **Codex 桌面版版本号**：如 `26.727.6591.0`
- **是否成功运行**：成功 / 部分功能异常 / 失败

## 致谢

内置的「当前对话 ID」检测逻辑参考了开源项目 [codex-context-used-meter](https://github.com/Minghou-Lei/codex-context-used-meter)（MIT License），已完全自研集成，不依赖任何外部脚本、无需额外安装。
