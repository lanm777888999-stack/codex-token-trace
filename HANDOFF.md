# 项目交接

<!-- project-archive-sync:start -->
> 更新时间：2026-08-17 18:04（Asia/Shanghai）
> 同步目标：archive/codex/token-trace-dashboard（私有归档仓库）

## 一句话说明

这是一个读取 Codex 本地 rollout 日志的 Token 统计工具；本次已完成 Codex++ 版的 Token Trace 双层分析界面，但用户已确认下一阶段要彻底去除 Codex++，改成独立 Windows 悬浮入口与本机浏览器大界面。

## 本次完成

- 悬浮卡改为本轮趋势、对话累计、上下文占用和缓存命中的简洁视图，并保留拖动、四角缩放、收起和位置记忆。
- 新增今日累计、24 小时分桶、昨日与近 7 日对比，以及按 Codex 对话归类的任务 Token 占比排行。
- 新增透明规则分析：上下文膨胀、缓存下降、单轮峰值、输出偏高和请求密度，并为每条原因匹配可执行建议。
- 新增基于今日总 Token 构成的模型理论消费对比、可编辑演示价格表和本机持久化。
- 新增可复制/下载的 Agent Markdown 分析包；CDP 载荷移除绝对日志路径，分析包默认不含原始对话正文。
- 修复占位新任务兜底检测使用未定义 `port` 变量的问题，并更新中文 README、Changelog 与重构说明。
- 记录已确认的去 Codex++ 产品方向：后台自动检测 Codex、悬浮入口吸附窗口右侧、悬停展开、点击后在浏览器打开本机统计页。

## 当前状态

- 分支：`codex/token-trace-dashboard`
- 工作树：干净（以本次交接提交为准）
- 运行状态：统计与界面源码验证通过；当前 Codex++ 运行链路未在本机联调，因为调试端口 9229 未开启。

## 启动与测试

```text
# 查看最近会话统计
node token-stats.mjs

# 现有 Codex++ 架构的实时监控
node token-stats.mjs --watch --cdp

# 本次实际运行的验证
git diff --check
node --check codex-token-spend-panel.js
node --check token-stats.mjs
$env:CCM_TOKENS_AS_MODULE='1'; node -e "导入模块并断言 daily、24 小时分桶、任务 insights 与无 file 路径载荷"; Remove-Item Env:CCM_TOKENS_AS_MODULE
node token-stats.mjs | Out-Null
```

- 验证结果：以上命令通过；真实日志生成 4 个今日任务和规则结果，载荷未包含 `file` 字段。浏览器测试页已验证悬浮卡、大界面、任务切换、价格实时重算和 Agent 分析包隐私边界。

## 重要位置

- `token-stats.mjs`：rollout 解析、今日聚合、规则分析和当前 CDP 推送。
- `codex-token-spend-panel.js`：当前 Codex++ 注入版悬浮卡与大型分析界面。
- `TOKEN-TRACE-REDESIGN.md`：数据契约、隐私边界，以及下一阶段去 Codex++ 的已确认方向。
- `guardian.ps1`：现有 Codex 进程检测与监控进程守护，可复用其进程检测思路。
- `README.md` / `CHANGELOG.md`：用户说明与未发布变更。

## 本地配置

- 需要的变量名：`CCM_TOKENS_AS_MODULE`
- 现有版本需要的本地服务或工具：Windows、Node.js ≥ 22、Codex 桌面版；Codex++ 与 CDP 9229 仅为旧运行链路依赖。
- 下一阶段应提供单独的 Windows 悬浮程序和本机 HTTP 服务，不再要求 Codex++。

## 已知问题

- 当前已实现代码仍依赖 Codex++ 注入和 CDP，尚不是用户最终要求的无 Codex++ 版本。
- 不注入 Codex 页面后，只能从日志可靠判断“最近活动任务”，无法确定刚切换但尚未产生请求的旧任务；需要任务选择/固定能力，并避免错误使用“当前对话”措辞。
- 内置模型价格是可编辑演示值，不是联网获取的官方实时价格。
- 尚未确认 Codex 最大化且右侧没有空间时，悬浮入口的降级位置。

## 下一步

1. 确认 Codex 最大化时悬浮入口应缩进右侧内部、移动到左侧还是隐藏。
2. 选定 Windows 桌面实现技术，拆分为后台日志监听/本机 API 与吸附 Codex 窗口的悬浮入口，移除 CDP 和页面注入依赖。
3. 将大型分析界面迁移为浏览器本机页面，并通过 WebSocket 或 SSE 接收约 0.5～1 秒延迟的增量更新。
<!-- project-archive-sync:end -->
