# ccm-token-spend - Agent 安装指南

> 本文件给 AI 编码助手阅读。人类用户请优先看 [README.md](README.md)。

## 0. 这是什么

- 工具名：ccm-token-spend / Token Trace。
- 目标：为 Codex / ChatGPT 桌面版提供本机 Token 统计、独立悬浮窗和浏览器统计面板。
- 新版不需要 Codex++，不使用页面注入、侧边栏或调试端口。
- 数据来源：`%USERPROFILE%\.codex\sessions\...\rollout-*.jsonl`，只做本地统计。

## 1. 前提

| # | 前提 | 检查方式 |
|---|---|---|
| 1 | Windows | `echo $env:OS` |
| 2 | Codex / ChatGPT 桌面版 | 桌面应用存在 |
| 3 | Node.js >= 22，或通过公开安装器自动下载运行时 | `node -v` |

Codex++ 不是前提。不要要求用户安装 Codex++。

## 1.1 面向普通用户的一键安装

```powershell
$u='https://raw.githubusercontent.com/THaoKun2022/ccm-token-spend/main/Install-TokenTrace.ps1'; $p=Join-Path $env:TEMP 'Install-TokenTrace.ps1'; Invoke-WebRequest $u -OutFile $p; powershell -NoProfile -ExecutionPolicy Bypass -File $p
```

安装器固定一次 GitHub 提交后下载所需文件；没有 Node.js 22+ 时才下载官方 Node 运行时。不要改为要求用户下载 ZIP 或安装 Codex++。

## 2. 手动启动

从仓库目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\start-token-trace.ps1
```

这会启动：

- 本机服务：`http://127.0.0.1:8766`
- 独立 Windows 悬浮窗：可自由拖动并记住位置，点击展开/收起；默认黑猫 Token logo，可在浏览器面板里上传圆形自定义封面

如果只想启动浏览器面板/API：

```powershell
node token-stats.mjs --server
```

## 3. 低耗启动器模式（推荐）

```powershell
powershell -ExecutionPolicy Bypass -File .\install-launcher-mode.ps1
```

这会移除登录后守护计划任务（不删除本机设置），并在桌面创建 `Codex + Token Trace.lnk`。用户从该快捷方式启动 Codex 时，Token Trace 同步启动；Codex 退出后，Token Trace 同步停止。

## 4. WMI 事件守护模式（可选）

```powershell
powershell -ExecutionPolicy Bypass -File .\install-autostart.ps1
```

作用：

- 登录 Windows 后后台等待 WMI 进程事件，不做定时轮询；
- 检测到 Codex / ChatGPT 启动事件后自动启动本机服务和悬浮窗；
- Codex 退出事件后确认全部 Codex 进程均关闭，再自动停止服务和悬浮窗；
- 崩溃后自动重启。

卸载：

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall-autostart.ps1
```

卸载不会删除 `%LOCALAPPDATA%\ccm-token-spend` 中的主题、价格或自定义封面。

## 5. 验证

```powershell
Invoke-RestMethod http://127.0.0.1:8766/api/health
Invoke-RestMethod http://127.0.0.1:8766/api/state
Invoke-RestMethod http://127.0.0.1:8766/api/pack
```

成功时：

- `/api/health` 返回 `ok: true`；
- `/api/state` 返回 `mode: local-server`；
- `/api/pack` 返回可复制给其他 AI 的提示词 + 数据包。

## 6. 排查

| 现象 | 处理 |
|---|---|
| 浏览器打不开 `127.0.0.1:8766` | 确认 `token-stats.mjs --server` 或 `start-token-trace.ps1` 正在运行 |
| 悬浮窗不出现 | 先启动 Codex 桌面版；确认本机服务正在运行；悬浮球可自由放置 |
| 不想后台常驻 | 使用 `install-launcher-mode.ps1`，然后从桌面 `Codex + Token Trace.lnk` 打开 Codex |
| 悬浮窗显示等待服务 | 检查 `%LOCALAPPDATA%\ccm-token-spend\server.log` |
| 想换悬浮球封面 | 打开浏览器大型面板后点击「悬浮封面」，图片会自动居中裁切为圆形并保存到本机 |
| 任务不是当前打开的旧任务 | 正常限制；不进入 Codex 页面时只能可靠识别“最近活动任务” |
| 数据包含任务摘要 | 这是用户确认过的默认行为；不包含完整对话、文件路径、密钥或原始日志 |

## 7. Agent 约束

- 不要读取或外传原始会话日志正文。
- 不要安装 Codex++，不要复制 `codex-token-spend-panel.js` 到用户脚本目录。
- 不要使用 `--cdp` 作为默认启动方式；新版默认是 `--server`。
- 不要主动打包 exe、提交或推送，除非用户明确要求。
