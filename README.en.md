# Token Trace for Codex Desktop

[简体中文](README.md) | [English](README.en.md)

Token Trace is a Windows companion for Codex / ChatGPT Desktop. It shows a draggable floating entry and a local browser dashboard for today's Token usage, per-task share, model-cost comparison, and a copyable AI analysis pack.

![Token Trace dashboard with public demo data](docs/images/dashboard-overview-demo.png)

> This is the current product UI. The screenshot uses built-in fictional demo data, never a user's session data.

## What it does

- Summarizes today's total Token use, requests, cache-hit rate, and input/cache/output composition.
- Ranks Codex conversations by Token share with compact task titles.
- Compares theoretical cost for the same daily Token composition across editable model price entries.
- Provides a draggable floating ball/card, synchronized dark/light themes, and a custom cover image.
- Copies a prompt plus sanitized statistics for analysis in any AI assistant.

Run the safe demo dashboard without reading local sessions:

```powershell
node token-stats.mjs --server --demo --port 8767
```

Codex++ is not required. The default mode does not inject scripts into Codex, does not add a sidebar, and does not use debug port `9229`.

## Requirements

- Windows.
- Codex / ChatGPT desktop app.
- Node.js >= 22, or use the one-command installer which downloads an official runtime when needed.

## One-command install

Run this in PowerShell:

```powershell
$u='https://raw.githubusercontent.com/lanm777888999-stack/codex-token-trace/main/Install-TokenTrace.ps1'; $p=Join-Path $env:TEMP 'Install-TokenTrace.ps1'; Invoke-WebRequest $u -OutFile $p; powershell -NoProfile -ExecutionPolicy Bypass -File $p
```

It pins one GitHub commit, downloads the required source files, obtains the official Node.js runtime only when needed, and enables WMI follow mode. Open Codex normally from any entry afterwards.

To inspect the installer before execution, open [Install-TokenTrace.ps1](Install-TokenTrace.ps1). To disable automatic following, run:

```powershell
powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\TokenTrace\uninstall-autostart.ps1"
```

## Run

Manual start:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-token-trace.ps1
```

Server only:

```powershell
node token-stats.mjs --server
```

Dashboard:

```text
http://127.0.0.1:8766
```

## Files

- `token-stats.mjs` - local stats/API/dashboard server.
- `dashboard.html` - browser dashboard.
- `floating-panel.ps1` - independent Windows floating panel, freely draggable, remembers its position, and uses the black-cat Token logo by default.
- `start-token-trace.ps1` - starts the server and floating panel manually.
- `Install-TokenTrace.ps1` - public one-command installer.
- `launch-codex-token-trace.ps1` / `install-launcher-mode.ps1` - low-resource launcher mode: starts Token Trace with Codex and stops it when Codex exits.
- `guardian.ps1` - optional WMI event guardian that reacts to Codex process start/stop events without polling.
- `install-autostart.ps1` / `uninstall-autostart.ps1` - install/uninstall the scheduled task.
- `codex-token-spend-panel.js` - legacy Codex++ injected panel, kept for compatibility only.

## Dashboard

The browser dashboard focuses on:

- today's total token usage;
- per-task token share;
- input / cached input / output composition;
- editable model price comparison;
- one-click prompt + data pack for analysis in another AI.
- dark / light theme switching.

The floating ball uses `assets/token_black_cat.png` by default. In the browser dashboard, use "悬浮封面" to upload an image; it is center-cropped into a circular PNG and saved locally at `%LOCALAPPDATA%\ccm-token-spend\floating-cover.png`.

The data pack includes task summaries and numeric metrics. It does not include full conversations, file paths, secrets, or raw logs.

## Low-resource launcher mode

```powershell
powershell -ExecutionPolicy Bypass -File .\install-launcher-mode.ps1
```

This creates a desktop shortcut named `Codex + Token Trace.lnk`. Use that shortcut to launch Codex with Token Trace. When Codex exits, Token Trace exits too. No logon guardian stays running in the background.

## Optional guardian mode

```powershell
powershell -ExecutionPolicy Bypass -File .\install-autostart.ps1
```

After installation, the guardian waits for filtered Windows WMI process events (no two-second polling). When Codex starts, it launches the local server and floating panel. When a Codex process exits, it confirms all Codex processes are closed before stopping them.

Uninstall:

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall-autostart.ps1
```

Logs:

- `%LOCALAPPDATA%\ccm-token-spend\guardian.log`
- `%LOCALAPPDATA%\ccm-token-spend\server.log`

Uninstalling preserves local theme, price and custom-cover settings.

## Data Notes

- Only local Codex session logs are read: `%USERPROFILE%\.codex\sessions\...\rollout-*.jsonl`.
- The tool cannot reliably know which old task is selected in Codex if that task has not produced new token requests. The UI therefore uses "recent active task" wording.
- Model prices are editable demo values saved locally.

## Developer Commands

```powershell
node token-stats.mjs                  # most recent thread
node token-stats.mjs --thread <id>    # specific thread
node token-stats.mjs --detail         # include per-request details
node token-stats.mjs --all            # cumulative usage across all threads
node token-stats.mjs --server         # local dashboard/API server
```
