# 项目交接

<!-- project-archive-sync:start -->
> 更新时间：2026-08-18 18:02（Asia/Shanghai）
> 同步目标：public/main（lanm777888999-stack/codex-token-trace）

## 一句话说明

Token Trace 是 Codex / ChatGPT Windows 桌面版的本机 Token 分析伴生工具：独立悬浮入口配合浏览器统计页，不依赖 Codex++。

## 本次完成

- 完成无 Codex++ 的悬浮球、浏览器统计页、主题/价格/封面本机持久化与提示词数据包。
- 将自动跟随从 PowerShell 两秒轮询改为 WMI 进程事件守护；在受限 Windows 上自动使用 WMI 实例事件降级方案。
- 新增公开一键安装器 `Install-TokenTrace.ps1`：从 GitHub 固定提交下载文件，缺少 Node.js 22+ 时下载官方运行时。
- 新增 MIT 许可证、安全与第三方说明、发布前自检，并更新中英文 README。
- 安装器改为发布标签 + jsDelivr 主源 + GitHub Raw 回退，完全移除 GitHub API、登录和 Token 依赖。
- 新增 `Build-Portable.ps1`，生成带 Node.js 运行时、可双击 `Install.cmd` 的便携 ZIP 与 SHA-256 文件。
- 移除旧 Codex++ 注入脚本、旧启动器和过期预览图。

## 当前状态

- 分支：`codex/token-trace-dashboard`
- 工作树：安装器限流修复已推送至 `public/main`，`v1.0.0` GitHub Release 已发布。
- 运行状态：离线安装器/URL 构造自检、远端 jsDelivr 与 Raw 标签版脚本读取、便携 ZIP 构建均已验证；尚未在干净 Windows 用户环境执行真实安装。

## 启动与测试

```text
powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-Release.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\Install-TokenTrace.ps1 -SelfTest
powershell -NoProfile -ExecutionPolicy Bypass -File .\Build-Portable.ps1 -ReleaseVersion v1.0.0
powershell -NoProfile -ExecutionPolicy Bypass -File .\floating-panel.ps1 -SelfTest
node --check token-stats.mjs
```

- 验证结果：安装器语法与 URL 自检、无 GitHub API 主机检查、项目发布自检、Node 语法、悬浮窗自检、便携 ZIP 内容检查均通过；jsDelivr 与 GitHub Raw 标签版安装脚本均可读取；未运行真实安装。

## 重要位置

- `Install-TokenTrace.ps1`：面向公开用户的单命令安装器。
- `Build-Portable.ps1`：构建 Release 便携 ZIP 与校验文件。
- `guardian.ps1`：WMI 启动/退出事件守护与服务生命周期。
- `dashboard.html`：浏览器大型统计界面。
- `floating-panel.ps1`：Windows 悬浮入口。
- `Test-Release.ps1`：公开发布前的文件、语法与路径检查。

## 本地配置

- 需要的本地服务或工具：Windows、Codex / ChatGPT 桌面版；安装器会处理 Node.js 运行时。
- 本机用户设置保存在 `%LOCALAPPDATA%\ccm-token-spend`：主题、模型价格和自定义悬浮封面。

## 已知问题

- `Win32_ProcessStartTrace` 在部分普通用户 Windows 会被系统拒绝；守护会回退到 WMI 实例事件，启动/退出感知约为秒级。
- 首次真实安装仍应使用干净 Windows 用户环境验证命令行和便携包两条路径。

## 下一步

1. 在干净 Windows 用户环境运行 README 的命令行和便携包两条安装路径。
2. 根据首次外部测试结果补充兼容性说明或故障排查。
<!-- project-archive-sync:end -->
