# 项目交接

<!-- project-archive-sync:start -->
> 更新时间：2026-08-19 19:03（Asia/Shanghai）
> 同步目标：public/main（lanm777888999-stack/codex-token-trace）

## 一句话说明

Token Trace 是 Codex / ChatGPT Windows 桌面版的本机 Token 分析伴生工具：圆形悬浮入口配合浏览器统计页，不依赖 Codex++。

## 本次完成

- 大型界面移除重复顶部导航，将总览、使用对比、模型价格、数据包和快捷操作统一放入左侧栏。
- 新增今日 / 近 7 天 / 近 30 天阶段对比 API 与界面；同时展示总量、日均、单任务平均、任务数和 Token 构成变化。
- 悬浮球改为 WPF 原生拖动与圆形裁切，悬停展开侧边卡片，并支持左右边缘吸附、箭头收纳和恢复。
- 修复 Windows PowerShell 5.1 下圆形裁切构造失败、浅色主题文字继承、无历史基准渲染中断等问题。
- 更新中英文 README、Agent 指南、更新记录和两张公开 demo 截图；安装器与便携包版本更新到 `v1.1.0`。

## 当前状态

- 分支：`codex/token-trace-dashboard`
- 工作树：v1.1.0 功能与文档已同步至 `public/main`，GitHub Release 与便携包已发布。
- 运行状态：本机服务、浏览器界面、阶段对比 API 和悬浮窗均可运行；尚未在干净 Windows 用户环境执行 v1.1.0 真实安装。

## 启动与测试

```text
powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-Release.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\Install-TokenTrace.ps1 -SelfTest
powershell -NoProfile -ExecutionPolicy Bypass -File .\Build-Portable.ps1 -ReleaseVersion v1.1.0
powershell -NoProfile -ExecutionPolicy Bypass -File .\floating-panel.ps1 -SelfTest
node --check token-stats.mjs
Invoke-RestMethod 'http://127.0.0.1:8766/api/comparison?period=7'
```

- 验证结果：Node / 页面脚本语法、PowerShell 语法与悬浮窗自检、发布前检查、三档阶段对比 API 和浏览器无报错检查均通过；悬浮窗进程响应正常且错误日志为空。

## 重要位置

- `Install-TokenTrace.ps1`：面向公开用户的单命令安装器。
- `Build-Portable.ps1`：构建 Release 便携 ZIP 与校验文件。
- `guardian.ps1`：WMI 启动/退出事件守护与服务生命周期。
- `dashboard.html`：浏览器大型统计界面。
- `token-stats.mjs`：统计核心、本机 API 和阶段对比聚合。
- `floating-panel.ps1`：Windows 圆形悬浮入口、悬停卡片和边缘收纳。
- `Test-Release.ps1`：公开发布前的文件、语法与路径检查。
- `docs/images/dashboard-overview-demo.png` / `dashboard-comparison-demo.png`：公开 README demo 截图。

## 本地配置

- 需要的本地服务或工具：Windows、Codex / ChatGPT 桌面版；安装器会处理 Node.js 运行时。
- 本机用户设置保存在 `%LOCALAPPDATA%\ccm-token-spend`：主题、模型价格和自定义悬浮封面。

## 已知问题

- `Win32_ProcessStartTrace` 在部分普通用户 Windows 会被系统拒绝；守护会回退到 WMI 实例事件，启动/退出感知约为秒级。
- 透明 Topmost 悬浮窗不会被普通窗口自动化接口可靠捕获；边缘拖动手感仍应在不同 DPI / 多显示器环境手动验证。
- v1.1.0 首次真实安装仍应使用干净 Windows 用户环境验证命令行和便携包两条路径。

## 下一步

1. 在干净 Windows 用户环境运行 v1.1.0 命令行和便携包两条安装路径。
2. 收集不同 DPI / 多显示器下悬浮球拖动与边缘收纳反馈。
<!-- project-archive-sync:end -->
