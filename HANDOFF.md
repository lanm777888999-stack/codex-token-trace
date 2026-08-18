# 项目交接

<!-- project-archive-sync:start -->
> 更新时间：2026-08-18 17:20（Asia/Shanghai）
> 同步目标：public/main（lanm777888999-stack/codex-token-trace）

## 一句话说明

Token Trace 是 Codex / ChatGPT Windows 桌面版的本机 Token 分析伴生工具：独立悬浮入口配合浏览器统计页，不依赖 Codex++。

## 本次完成

- 完成无 Codex++ 的悬浮球、浏览器统计页、主题/价格/封面本机持久化与提示词数据包。
- 将自动跟随从 PowerShell 两秒轮询改为 WMI 进程事件守护；在受限 Windows 上自动使用 WMI 实例事件降级方案。
- 新增公开一键安装器 `Install-TokenTrace.ps1`：从 GitHub 固定提交下载文件，缺少 Node.js 22+ 时下载官方运行时。
- 新增 MIT 许可证、安全与第三方说明、发布前自检，并更新中英文 README。

## 当前状态

- 分支：`codex/token-trace-dashboard`
- 工作树：包含待提交的公开发布改动。
- 运行状态：本机服务、WMI 守护和悬浮窗已验证；公开 GitHub 一键安装命令需在提交推送到 `main` 后首次外部验证。

## 启动与测试

```text
powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-Release.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\floating-panel.ps1 -SelfTest
node --check token-stats.mjs
```

- 验证结果：以上命令通过；`/api/health` 已在本机验证。远端下载安装器尚未运行，因为本次改动尚未推送。

## 重要位置

- `Install-TokenTrace.ps1`：面向公开用户的单命令安装器。
- `guardian.ps1`：WMI 启动/退出事件守护与服务生命周期。
- `dashboard.html`：浏览器大型统计界面。
- `floating-panel.ps1`：Windows 悬浮入口。
- `Test-Release.ps1`：公开发布前的文件、语法与路径检查。

## 本地配置

- 需要的本地服务或工具：Windows、Codex / ChatGPT 桌面版；安装器会处理 Node.js 运行时。
- 本机用户设置保存在 `%LOCALAPPDATA%\ccm-token-spend`：主题、模型价格和自定义悬浮封面。

## 已知问题

- `Win32_ProcessStartTrace` 在部分普通用户 Windows 会被系统拒绝；守护会回退到 WMI 实例事件，启动/退出感知约为秒级。
- 一键安装器引用公开仓库 `lanm777888999-stack/codex-token-trace` 的 `main` 分支，必须在推送后才可被外部用户使用。

## 下一步

1. 推送当前分支到公开仓库 `public/main` 后，在干净 Windows 用户环境运行 README 的一行安装命令。
2. 根据首次外部测试结果补充兼容性说明或故障排查。
<!-- project-archive-sync:end -->
