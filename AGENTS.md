# AGENTS.md

## 项目定位

- 工具：Codex / ChatGPT 桌面版 Token Trace 伴生工具。
- 仅针对 Codex / ChatGPT 桌面版，不针对 codex CLI。
- 新版不依赖 Codex++，不使用页面注入、侧边栏或调试端口作为默认链路。
- 默认体验：后台本机服务 + 独立 Windows 悬浮入口 + 浏览器大型统计页面。

## 目录结构

- `token-stats.mjs`：核心统计、本机 HTTP API 和浏览器页面服务。
- `dashboard.html`：大型统计界面，展示今日累计、任务占比、Token 构成、模型消费对比和数据包复制。
- `floating-panel.ps1`：Windows 无边框悬浮入口，可自由拖动并记住位置，点击展开/收起；默认使用 `assets/token_black_cat.png`，并支持用户上传圆形自定义封面。
- `start-token-trace.ps1`：手动启动本机服务和悬浮入口。
- `launch-codex-token-trace.ps1` / `install-launcher-mode.ps1`：低耗启动器模式，用户从桌面快捷方式打开 Codex 时同步启动 Token Trace，Codex 退出后同步停止。
- `guardian.ps1`：可选 WMI 事件守护进程；订阅 Codex / ChatGPT 进程启停事件，不使用定时轮询。
- `install-autostart.ps1` / `uninstall-autostart.ps1`：守护模式安装/卸载。
- `codex-token-spend-panel.js`：旧 Codex++ 注入面板，保留兼容，不作为新版默认路径。

## 工作原理

- `token-stats.mjs --server` 读取 Codex 本地 rollout 日志，并提供：
  - `GET /`：浏览器大型界面；
  - `GET /api/state`：今日汇总、最近活动任务、价格表和模型消费；
  - `GET /api/pack`：提示词 + 数据包；
  - `POST /api/prices`：保存本机模型价格；
  - `POST /api/prices/reset`：恢复演示价格。
- 悬浮窗不进入 Codex 页面；悬浮球位置由用户拖动决定并本机记忆。
- 悬浮球必须保持图片化品牌入口，不要退回纯文字按钮；用户自定义封面保存在 `%LOCALAPPDATA%\ccm-token-spend\floating-cover.png`。
- 不进入 Codex 页面时，无法可靠识别“用户刚切换但尚未产生请求的旧任务”，因此 UI 使用“最近活动任务”措辞。
- 大型界面不做内置异常诊断；用户通过复制数据包交给任意 AI 分析。

## 修改约定

- 全程使用中文沟通。
- 改完不主动重新打包 exe；用户说需要打包时才打包。
- 重大改动先记录下来再动手改。
- 不主动 git commit / push，除非用户明确要求。
- 提交/发布前检查是否包含隐私或本机敏感信息。
- 新版默认不要要求用户安装 Codex++，不要把 `--cdp` 写成默认运行方式。

## 运行 / 测试

- 手动启动：`powershell -ExecutionPolicy Bypass -File .\start-token-trace.ps1`
- 低耗启动器：`powershell -ExecutionPolicy Bypass -File .\install-launcher-mode.ps1`
- 无论从哪里打开 Codex 都自动跟随：`powershell -ExecutionPolicy Bypass -File .\install-autostart.ps1`（WMI 事件监听，无 2 秒轮询）
- 仅启动服务：`node token-stats.mjs --server`
- 浏览器界面：`http://127.0.0.1:8766`
- API 自检：
  - `Invoke-RestMethod http://127.0.0.1:8766/api/health`
  - `Invoke-RestMethod http://127.0.0.1:8766/api/state`
  - `Invoke-RestMethod http://127.0.0.1:8766/api/pack`
- 代码检查：
  - `node --check token-stats.mjs`
  - `powershell -NoProfile -ExecutionPolicy Bypass -File .\floating-panel.ps1 -SelfTest`

## 兼容说明

- PowerShell 脚本尽量保持 ASCII 文案，避免 Windows PowerShell 5.1 读取无 BOM UTF-8 时破坏中文字符串。
