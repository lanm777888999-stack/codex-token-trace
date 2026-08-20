# 项目交接

<!-- project-archive-sync:start -->
> 更新时间：2026-08-20 13:53（Asia/Shanghai）
> 同步目标：origin/main（lanm777888999-stack/codex-token-trace）

## 一句话说明

Token Trace 是 Codex / ChatGPT Windows 桌面版的本机 Token 分析伴生工具：圆形悬浮入口配合浏览器统计页，不依赖 Codex++；当前准备发布 `v1.1.1` 边缘收纳修复。

## 本次完成

- 修复边缘收纳后仍露出部分黑猫悬浮球的问题；收纳态现在只显示一个独立的 `36 × 52` 箭头标签。
- 收纳箭头支持原生拖动、最近边缘吸附和点击恢复，拖动时不会逐渐偏离鼠标。
- 完整球态继续保持圆形裁切、悬停展开快速卡片、自由拖动和位置记忆。
- 更新中英文 README、Agent 指南和更新记录；安装器与便携包默认版本更新到 `v1.1.1`。

## 当前状态

- 分支：`codex/floating-edge-tab`
- 工作树：`v1.1.1` 源码与文档准备发布到 `origin/main`。
- 运行状态：本机服务与悬浮窗可运行；实际桌面截图已确认收纳后只有边缘箭头、没有黑猫球残留。

## 启动与测试

```text
powershell -NoProfile -ExecutionPolicy Bypass -File .\Test-Release.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\Install-TokenTrace.ps1 -SelfTest
powershell -NoProfile -ExecutionPolicy Bypass -File .\Build-Portable.ps1 -ReleaseVersion v1.1.1
powershell -NoProfile -ExecutionPolicy Bypass -File .\floating-panel.ps1 -SelfTest
node --check token-stats.mjs
Invoke-RestMethod 'http://127.0.0.1:8766/api/comparison?period=7'
```

- 验证结果：PowerShell 语法、Node 与 Dashboard JavaScript 语法、悬浮窗自检、安装器 URL 自检、`Test-Release.ps1` 均通过；`v1.1.1` 便携包包含 17 个条目与 Node.js `v24.14.0`，SHA-256 校验一致；本机悬浮窗进程响应正常且错误日志为空。

## 重要位置

- `Install-TokenTrace.ps1`：面向公开用户的单命令安装器。
- `Build-Portable.ps1`：构建 Release 便携 ZIP 与校验文件。
- `guardian.ps1`：WMI 启动/退出事件守护与服务生命周期。
- `dashboard.html`：浏览器大型统计界面。
- `token-stats.mjs`：统计核心、本机 API 和阶段对比聚合。
- `floating-panel.ps1`：Windows 圆形悬浮入口、悬停卡片、完整球态与独立边缘箭头态。
- `Test-Release.ps1`：公开发布前的文件、语法与路径检查。
- `docs/images/dashboard-overview-demo.png` / `dashboard-comparison-demo.png`：公开 README demo 截图。

## 本地配置

- 需要的本地服务或工具：Windows、Codex / ChatGPT 桌面版；安装器会处理 Node.js 运行时。
- 本机用户设置保存在 `%LOCALAPPDATA%\ccm-token-spend`：主题、模型价格和自定义悬浮封面。

## 已知问题

- `Win32_ProcessStartTrace` 在部分普通用户 Windows 会被系统拒绝；守护会回退到 WMI 实例事件，启动/退出感知约为秒级。
- 透明 Topmost 悬浮窗不会被普通窗口自动化接口可靠捕获；本次已通过真实桌面截图验证箭头视觉，但多显示器边缘拖动仍建议扩大用户测试。
- `v1.1.1` 首次真实安装仍应使用干净 Windows 用户环境验证命令行和便携包两条路径。

## 下一步

1. 在干净 Windows 用户环境运行 v1.1.1 命令行和便携包两条安装路径。
2. 收集不同 DPI / 多显示器下悬浮球拖动与边缘收纳反馈。
<!-- project-archive-sync:end -->
