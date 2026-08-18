#!/usr/bin/env node
// ccm-token-spend / token-stats.mjs
//
// Reads Codex session rollout files (~/.codex/sessions/**/rollout-*.jsonl) and
// reports per-request / per-turn / per-conversation token consumption.
//
// Usage:
//   node token-stats.mjs                    stats for the most recent conversation
//   node token-stats.mjs --thread <id>      stats for a specific conversation
//   node token-stats.mjs --all              per-conversation totals across all sessions
//   node token-stats.mjs --detail           include per-request rows in the printed table
//   node token-stats.mjs --watch [--cdp]    watch the active conversation (push to page with --cdp)
//   node token-stats.mjs --cdp              one-shot push of a sanitized summary into the Codex page
//   node token-stats.mjs --server           run the no-Codex++ local dashboard/API server
//   node token-stats.mjs --port <port>      server port with --server (default 8766); CDP port with --cdp (default 9229)
//
// The tool only reads Codex's own session logs and never prints secrets.

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SESSIONS_DIR = path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "sessions");
const ROLLOUT_RE = /^rollout-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})-(.+)\.jsonl$/;
const STATE_DIR = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "ccm-token-spend");
const PRICE_FILE = path.join(STATE_DIR, "model-prices.json");
const COVER_FILE = path.join(STATE_DIR, "floating-cover.png");
const THEME_FILE = path.join(STATE_DIR, "ui-theme.json");
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_FILE = path.join(SCRIPT_DIR, "dashboard.html");
const DEFAULT_PRICES = [
  { id: "deepseek", name: "DeepSeek V4 Flash", region: "CN", fresh: 1.01, cached: 0.02, output: 2.02 },
  { id: "qwen", name: "Qwen 3.7 Plus", region: "CN", fresh: 2, cached: 0.2, output: 8 },
  { id: "glm", name: "GLM-5.2", region: "CN", fresh: 4, cached: 0.5, output: 16 },
  { id: "kimi", name: "Kimi K2.5", region: "CN", fresh: 4, cached: 1, output: 16 },
  { id: "gpt", name: "GPT-5.6 Sol", region: "Global", fresh: 36, cached: 3.6, output: 216 },
];

function findRolloutFiles() {
  const out = [];
  if (!fs.existsSync(SESSIONS_DIR)) return out;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && /^rollout-.*\.jsonl$/.test(entry.name)) out.push(full);
    }
  };
  walk(SESSIONS_DIR);
  return out;
}

function threadIdOf(file) {
  const m = path.basename(file).match(ROLLOUT_RE);
  return m ? m[2] : null;
}

function fileDate(file) {
  const m = path.basename(file).match(ROLLOUT_RE);
  return m ? m[1] : null;
}

function parseFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const counts = [];
  const userMessages = [];
  let modelContextWindow = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.type !== "event_msg" || !o.payload) continue;
    const p = o.payload;
    if (p.type === "token_count" && p.info) {
      const info = p.info;
      const last = info.last_token_usage || {};
      counts.push({
        ts: o.timestamp || "",
        total: info.total_token_usage && Number.isFinite(info.total_token_usage.total_tokens)
          ? info.total_token_usage.total_tokens
          : null,
        input: Number.isFinite(last.input_tokens) ? last.input_tokens : null,
        output: Number.isFinite(last.output_tokens) ? last.output_tokens : null,
        cached: Number.isFinite(last.cached_input_tokens) ? last.cached_input_tokens : 0,
        lastTotal: Number.isFinite(last.total_tokens) ? last.total_tokens : null,
        totalInfo: {
          input: info.total_token_usage && Number.isFinite(info.total_token_usage.input_tokens) ? info.total_token_usage.input_tokens : null,
          cached: info.total_token_usage && Number.isFinite(info.total_token_usage.cached_input_tokens) ? info.total_token_usage.cached_input_tokens : 0,
          output: info.total_token_usage && Number.isFinite(info.total_token_usage.output_tokens) ? info.total_token_usage.output_tokens : null,
        },
      });
      if (Number.isFinite(info.model_context_window)) modelContextWindow = info.model_context_window;
    } else if (p.type === "user_message") {
      let snippet = "";
      try {
        const raw = p.message && (p.message.text ?? p.message);
        snippet = (Array.isArray(raw) ? raw.join(" ") : typeof raw === "string" ? raw : "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 60);
      } catch {}
      userMessages.push({ ts: o.timestamp || "", snippet });
    }
  }
  if (!counts.length && !userMessages.length) return null;
  return { file, threadId: threadIdOf(file), date: fileDate(file), counts, userMessages, modelContextWindow };
}

function buildStats(parsed) {
  const counts = [...parsed.counts].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  const starts = [...parsed.userMessages].sort((a, b) => (a.ts < b.ts ? -1 : 1));
  const turns = [];
  const turnIndexFor = (ts) => {
    let idx = -1;
    for (let i = 0; i < starts.length; i += 1) {
      if (starts[i].ts <= ts) idx = i;
      else break;
    }
    return Math.max(idx, 0);
  };
  for (const c of counts) {
    const idx = turnIndexFor(c.ts);
    while (turns.length <= idx) {
      const s = starts[turns.length] || { ts: "", snippet: "" };
      turns.push({ start: s.ts, startLabel: labelOf(s.ts), snippet: s.snippet, requests: [], input: 0, output: 0, cached: 0, total: 0 });
    }
    const t = turns[idx];
    t.requests.push(c);
    if (c.input != null) t.input += c.input;
    if (c.output != null) t.output += c.output;
    if (c.cached != null) t.cached += c.cached;
    if (c.lastTotal != null) t.total += c.lastTotal;
  }
  const lastCount = counts[counts.length - 1];
  const lastTotalInfo = lastCount && lastCount.totalInfo;
  return {
    threadId: parsed.threadId,
    file: parsed.file,
    date: parsed.date,
    modelContextWindow: parsed.modelContextWindow,
    requestCount: counts.length,
    sessionTotal: lastCount && lastCount.total != null ? lastCount.total : null,
    sessionInput: lastTotalInfo && lastTotalInfo.input != null ? lastTotalInfo.input : null,
    sessionCached: lastTotalInfo && lastTotalInfo.cached != null ? lastTotalInfo.cached : null,
    sessionOutput: lastTotalInfo && lastTotalInfo.output != null ? lastTotalInfo.output : null,
    contextUsed:
      lastCount && lastCount.lastTotal != null
        ? parsed.modelContextWindow != null
          ? Math.min(lastCount.lastTotal, parsed.modelContextWindow)
          : lastCount.lastTotal
        : null,
    turns: turns.map((t) => ({
      start: t.start,
      startLabel: t.startLabel,
      snippet: t.snippet,
      requests: t.requests,
      input: t.input,
      output: t.output,
      cached: t.cached,
      total: t.total,
    })),
  };
}

// ---- recent aggregate index (read-only, in-memory) ----
// The active-conversation parser runs every second. Daily summaries may touch
// several rollout files, so parsed files are cached by size + mtime and the
// aggregate itself is refreshed at most once every five seconds.
const parsedFileCache = new Map();
let dailySummaryCache = { dateKey: "", builtAt: 0, value: null };

function localDateKey(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function shiftLocalDate(date, days) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d;
}

function parseFileCached(file) {
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return null;
  }
  const key = `${st.size}|${st.mtimeMs}`;
  const cached = parsedFileCache.get(file);
  if (cached && cached.key === key) return cached.parsed;
  const parsed = parseFile(file);
  parsedFileCache.set(file, { key, parsed });
  return parsed;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentChange(value, baseline) {
  if (!Number.isFinite(value) || !Number.isFinite(baseline) || baseline <= 0) return null;
  return ((value - baseline) / baseline) * 100;
}

function buildRuleInsights(task, baselineCacheRate) {
  const reasons = [];
  const actions = [];
  const add = (reason, action) => {
    if (reasons.length >= 3) return;
    reasons.push(reason);
    actions.push(action);
  };

  const counts = [...task._counts].sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  const firstContext = counts.find((c) => Number.isFinite(c.lastTotal) && c.lastTotal > 0)?.lastTotal || 0;
  const lastContext = [...counts].reverse().find((c) => Number.isFinite(c.lastTotal) && c.lastTotal > 0)?.lastTotal || 0;
  const growth = firstContext > 0 ? lastContext / firstContext : 0;
  if (growth >= 2.5 && lastContext - firstContext >= 50000) {
    const historyShare = lastContext > 0 ? Math.max(0, Math.min(99, Math.round(((lastContext - firstContext) / lastContext) * 100))) : 0;
    add(
      {
        code: "context_growth",
        severity: growth >= 4 ? "high" : "medium",
        title: "上下文持续膨胀",
        evidence: `请求上下文从 ${fmtShort(firstContext)} 增至 ${fmtShort(lastContext)}，约 ${growth.toFixed(1)} 倍`,
      },
      {
        code: "start_fresh",
        title: "考虑开启新对话",
        detail: `保留结论和未解决项后重开；当前上下文约 ${historyShare}% 来自后续累积`,
      },
    );
  }

  const recent = counts.slice(-3);
  const recentInput = recent.reduce((sum, c) => sum + (c.input || 0), 0);
  const recentCached = recent.reduce((sum, c) => sum + (c.cached || 0), 0);
  const recentRate = recentInput > 0 ? recentCached / recentInput : null;
  const cacheDrop = recentRate != null && task.cacheRate != null ? task.cacheRate - recentRate : 0;
  if (recentRate != null && (recentRate < Math.max(0.35, baselineCacheRate - 0.18) || cacheDrop >= 0.2)) {
    add(
      {
        code: "cache_drop",
        severity: recentRate < 0.3 ? "high" : "medium",
        title: "近期缓存复用下降",
        evidence: `最近 3 次请求命中率 ${(recentRate * 100).toFixed(0)}%，任务均值 ${((task.cacheRate || 0) * 100).toFixed(0)}%`,
      },
      {
        code: "stabilize_input",
        title: "固定稳定提示与文件集",
        detail: "避免连续改写大段系统说明，重复资料改为稳定引用后再观察命中率",
      },
    );
  }

  const turnTotals = task._turns.map((t) => t.total || 0).filter((n) => n > 0);
  const typicalTurn = median(turnTotals);
  const maxTurn = turnTotals.length ? Math.max(...turnTotals) : 0;
  if (typicalTurn > 0 && maxTurn >= typicalTurn * 2.5 && maxTurn - typicalTurn >= 100000) {
    add(
      {
        code: "turn_spike",
        severity: maxTurn >= typicalTurn * 4 ? "high" : "medium",
        title: "存在单轮消耗峰值",
        evidence: `最高一轮 ${fmtShort(maxTurn)}，约为任务中位数 ${fmtShort(typicalTurn)} 的 ${(maxTurn / typicalTurn).toFixed(1)} 倍`,
      },
      {
        code: "inspect_spike",
        title: "定位高消耗轮次",
        detail: "检查该轮是否一次性加入大型日志、构建产物或重复文件，并缩小输入范围",
      },
    );
  }

  if (reasons.length < 3 && task.outputRate >= 0.25 && task.output >= 100000) {
    add(
      {
        code: "output_heavy",
        severity: task.outputRate >= 0.4 ? "medium" : "low",
        title: "输出占比偏高",
        evidence: `输出占任务 Token 的 ${(task.outputRate * 100).toFixed(0)}%，今日任务基准约 17%`,
      },
      {
        code: "shorter_output",
        title: "要求只返回变化和结论",
        detail: "让 Agent 优先输出补丁、差异和验证结果，避免重复生成完整文档",
      },
    );
  }

  const requestDensity = task.turnCount > 0 ? task.requestCount / task.turnCount : task.requestCount;
  if (reasons.length < 3 && (task.requestCount >= 24 || requestDensity >= 5)) {
    add(
      {
        code: "request_density",
        severity: task.requestCount >= 40 ? "high" : "medium",
        title: "请求次数偏高",
        evidence: `${task.requestCount} 次请求分布在 ${task.turnCount || 1} 轮，平均每轮 ${requestDensity.toFixed(1)} 次`,
      },
      {
        code: "check_loop",
        title: "检查重复修复循环",
        detail: "若连续多次修改仍回到同一失败，先停止重试并重新定位根因",
      },
    );
  }

  if (!reasons.length) {
    reasons.push({ code: "stable", severity: "low", title: "未检测到明显异常", evidence: "上下文、缓存、单轮峰值和请求密度均未触发规则阈值" });
    actions.push({ code: "keep", title: "保持当前任务结构", detail: "继续观察下一轮趋势；无需仅为了 Token 数强制开启新对话" });
  }

  return { reasons, actions };
}

function buildDailySummary(activeThreadId, now = new Date()) {
  const todayKey = localDateKey(now);
  if (dailySummaryCache.value && dailySummaryCache.dateKey === todayKey && Date.now() - dailySummaryCache.builtAt < 5000) {
    return {
      ...dailySummaryCache.value,
      tasks: dailySummaryCache.value.tasks.map((task) => ({ ...task, isActive: task.threadId === activeThreadId })),
    };
  }

  const dayKeys = [];
  for (let i = 0; i <= 7; i += 1) dayKeys.push(localDateKey(shiftLocalDate(now, -i)));
  const wantedDays = new Set(dayKeys);
  const windowStart = shiftLocalDate(now, -7).getTime();
  const dayTotals = new Map(dayKeys.map((key) => [key, { total: 0, input: 0, cached: 0, output: 0, requests: 0 }]));
  const taskMap = new Map();
  const timeline = Array.from({ length: 24 }, (_, hour) => ({ hour, total: 0, input: 0, cached: 0, output: 0 }));

  for (const file of findRolloutFiles()) {
    try {
      if (fs.statSync(file).mtimeMs < windowStart) continue;
    } catch {
      continue;
    }
    const parsed = parseFileCached(file);
    if (!parsed) continue;
    const threadId = parsed.threadId || threadIdOf(file) || "unknown";
    const built = buildStats(parsed);
    let task = taskMap.get(threadId);
    if (!task) {
      const firstTitle = parsed.userMessages.find((message) => message.snippet)?.snippet || "";
      task = {
        threadId,
        label: firstTitle || `任务 ${threadId.slice(0, 8)}`,
        total: 0,
        input: 0,
        cached: 0,
        output: 0,
        requestCount: 0,
        contextPeak: 0,
        modelContextWindow: parsed.modelContextWindow || null,
        updatedAt: "",
        _counts: [],
        _turns: [],
      };
      taskMap.set(threadId, task);
    }

    for (const count of parsed.counts) {
      const key = localDateKey(count.ts);
      if (!wantedDays.has(key)) continue;
      const input = Number.isFinite(count.input) ? count.input : 0;
      const cached = Number.isFinite(count.cached) ? count.cached : 0;
      const output = Number.isFinite(count.output) ? count.output : 0;
      const total = Number.isFinite(count.lastTotal) ? count.lastTotal : input + output;
      const day = dayTotals.get(key);
      day.total += total;
      day.input += input;
      day.cached += cached;
      day.output += output;
      day.requests += 1;
      if (key !== todayKey) continue;

      task.total += total;
      task.input += input;
      task.cached += cached;
      task.output += output;
      task.requestCount += 1;
      task.contextPeak = Math.max(task.contextPeak, total);
      task.updatedAt = count.ts > task.updatedAt ? count.ts : task.updatedAt;
      task._counts.push(count);
      const d = new Date(count.ts);
      if (!Number.isNaN(d.getTime())) {
        const bucket = timeline[d.getHours()];
        bucket.total += total;
        bucket.input += input;
        bucket.cached += cached;
        bucket.output += output;
      }
    }

    for (const turn of built.turns) {
      if (turn.requests.some((request) => localDateKey(request.ts) === todayKey)) task._turns.push(turn);
    }
  }

  let tasks = [...taskMap.values()].filter((task) => task.total > 0);
  const cacheRates = tasks.map((task) => (task.input > 0 ? task.cached / task.input : 0));
  const baselineCacheRate = median(cacheRates);
  tasks = tasks
    .map((task) => {
      const cacheRate = task.input > 0 ? task.cached / task.input : null;
      const outputRate = task.total > 0 ? task.output / task.total : 0;
      const prepared = { ...task, cacheRate, outputRate, turnCount: task._turns.length };
      const insights = buildRuleInsights(prepared, baselineCacheRate);
      return {
        threadId: task.threadId,
        label: task.label,
        total: task.total,
        input: task.input,
        cached: task.cached,
        output: task.output,
        requestCount: task.requestCount,
        turnCount: task._turns.length,
        contextPeak: task.contextPeak,
        modelContextWindow: task.modelContextWindow,
        cacheRate,
        outputRate,
        updatedAt: task.updatedAt,
        insights,
      };
    })
    .sort((a, b) => b.total - a.total);

  const today = dayTotals.get(todayKey);
  const yesterday = dayTotals.get(dayKeys[1]);
  const previous = dayKeys.slice(1).map((key) => dayTotals.get(key).total);
  const sevenDayAverage = previous.length ? previous.reduce((sum, value) => sum + value, 0) / previous.length : 0;
  const value = {
    date: todayKey,
    total: today.total,
    input: today.input,
    cached: today.cached,
    output: today.output,
    uncached: Math.max(0, today.input - today.cached),
    requestCount: today.requests,
    taskCount: tasks.length,
    yesterdayTotal: yesterday.total,
    sevenDayAverage,
    vsYesterdayPct: percentChange(today.total, yesterday.total),
    vsSevenDayPct: percentChange(today.total, sevenDayAverage),
    timeline,
    tasks,
  };
  dailySummaryCache = { dateKey: todayKey, builtAt: Date.now(), value };
  return { ...value, tasks: tasks.map((task) => ({ ...task, isActive: task.threadId === activeThreadId })) };
}

function labelOf(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(11, 16);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function fmtInt(n) {
  if (n == null || !Number.isFinite(n)) return "--";
  return n.toLocaleString("en-US");
}

function fmtShort(n) {
  if (n == null || !Number.isFinite(n)) return "--";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(Math.round(n));
}

function printStats(stats, { detail = false } = {}) {
  console.log("会话: " + (stats.threadId || "?"));
  console.log("文件: " + stats.file);
  if (stats.modelContextWindow) console.log("上下文窗口: " + fmtInt(stats.modelContextWindow) + " tokens");
  console.log("请求次数: " + fmtInt(stats.requestCount));
  const sCached = stats.sessionCached != null ? stats.sessionCached : null;
  console.log(
    "会话累计消耗: " + fmtInt(stats.sessionTotal) + " tokens (" + fmtShort(stats.sessionTotal) + ")" +
      (stats.sessionInput != null
        ? "  输入 " + fmtShort(stats.sessionInput) +
          (sCached != null ? "（缓存命中 " + fmtShort(sCached) + "，未命中 " + fmtShort(Math.max(0, stats.sessionInput - sCached)) + "）" : "") +
          " + 输出 " + fmtShort(stats.sessionOutput)
        : ""),
  );
  console.log("");
  console.log("每轮对话消耗:");
  let i = 1;
  for (const t of stats.turns) {
    console.log(
      `  T${i}  ${t.startLabel || "??:??"}  ${fmtShort(t.total)} tokens (输入 ${fmtShort(t.input)} + 输出 ${fmtShort(t.output)}), ${t.requests.length} 次请求${t.snippet ? "  「" + t.snippet + "」" : ""}`,
    );
    if (detail) {
      t.requests.forEach((r, j) => {
        console.log(`      #${j + 1} ${(r.ts || "").slice(11, 19)}  in ${fmtShort(r.input)}  out ${fmtShort(r.output)}  total ${fmtShort(r.lastTotal)}`);
      });
    }
    i += 1;
  }
}

function payloadFor(stats, daily = null) {
  return {
    threadId: stats.threadId,
    modelContextWindow: stats.modelContextWindow,
    requestCount: stats.requestCount,
    sessionTotal: stats.sessionTotal,
    sessionInput: stats.sessionInput,
    sessionCached: stats.sessionCached,
    sessionOutput: stats.sessionOutput,
    contextUsed: stats.contextUsed,
    turns: stats.turns.map((t) => ({
      startLabel: t.startLabel,
      snippet: t.snippet,
      requests: t.requests.length,
      input: t.input,
      output: t.output,
      cached: t.cached,
      total: t.total,
    })),
    daily,
    updatedAt: new Date().toISOString(),
  };
}

function normalizePrices(value) {
  const incoming = Array.isArray(value) ? value : [];
  return DEFAULT_PRICES.map((base) => {
    const match = incoming.find((item) => item && item.id === base.id) || {};
    return {
      ...base,
      fresh: Math.max(0, Number.isFinite(Number(match.fresh)) ? Number(match.fresh) : base.fresh),
      cached: Math.max(0, Number.isFinite(Number(match.cached)) ? Number(match.cached) : base.cached),
      output: Math.max(0, Number.isFinite(Number(match.output)) ? Number(match.output) : base.output),
    };
  });
}

function loadPrices() {
  try {
    return normalizePrices(JSON.parse(fs.readFileSync(PRICE_FILE, "utf8")));
  } catch {
    return normalizePrices(DEFAULT_PRICES);
  }
}

function savePrices(prices) {
  const normalized = normalizePrices(prices);
  fs.mkdirSync(path.dirname(PRICE_FILE), { recursive: true });
  fs.writeFileSync(PRICE_FILE, JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}

function normalizeTheme(value) {
  return value === "light" ? "light" : "dark";
}

function loadTheme() {
  try {
    const parsed = JSON.parse(fs.readFileSync(THEME_FILE, "utf8"));
    return normalizeTheme(parsed.theme);
  } catch {
    return "dark";
  }
}

function saveTheme(theme) {
  const normalized = normalizeTheme(theme);
  fs.mkdirSync(path.dirname(THEME_FILE), { recursive: true });
  fs.writeFileSync(THEME_FILE, JSON.stringify({ theme: normalized, updatedAt: new Date().toISOString() }, null, 2), "utf8");
  return normalized;
}

function modelCost(price, source) {
  const input = Math.max(0, Number(source?.input) || 0);
  const cached = Math.min(input, Math.max(0, Number(source?.cached) || 0));
  const output = Math.max(0, Number(source?.output) || 0);
  const uncached = Math.max(0, input - cached);
  return (uncached * price.fresh + cached * price.cached + output * price.output) / 1e6;
}

function newestStats() {
  const file = resolveAnyFile();
  if (!file) return emptyStats("", "");
  const parsed = parseFileCached(file);
  return parsed ? buildStats(parsed) : emptyStats(threadIdOf(file), file);
}

function publicDaily(daily) {
  if (!daily) return null;
  return {
    ...daily,
    tasks: (daily.tasks || []).map(({ insights, ...task }) => task),
  };
}

function publicPayload() {
  const stats = newestStats();
  const daily = publicDaily(buildDailySummary(stats.threadId || null));
  const prices = loadPrices();
  return {
    ...payloadFor(stats, daily),
    mode: "local-server",
    activeLabel: "最近活动任务",
    theme: loadTheme(),
    prices,
    modelCosts: prices.map((price) => ({ ...price, cost: modelCost(price, daily) })).sort((a, b) => a.cost - b.cost),
  };
}

function analysisPack(payload = publicPayload()) {
  const daily = payload.daily || {};
  const prices = payload.prices || [];
  const tasks = Array.isArray(daily.tasks) ? daily.tasks : [];
  const total = Number(daily.total) || 0;
  const taskLines = tasks.map((task, index) => {
    const share = total > 0 ? ((task.total / total) * 100).toFixed(1) : "0.0";
    return `${index + 1}. ${task.label || `任务 ${String(task.threadId || "").slice(0, 8)}`} | Token ${task.total || 0} | 占比 ${share}% | 输入 ${task.input || 0} | 缓存 ${task.cached || 0} | 输出 ${task.output || 0} | 请求 ${task.requestCount || 0} | 轮次 ${task.turnCount || 0}`;
  });
  const priceLines = prices.map((price) => {
    return `- ${price.name} (${price.region}): 新输入 $${price.fresh}/1M, 缓存 $${price.cached}/1M, 输出 $${price.output}/1M, 今日理论消费 $${modelCost(price, daily).toFixed(4)}`;
  });
  return `# Token Trace 数据分析包

请你作为 AI 使用效率分析顾问，只根据下面的 Token 统计数据进行分析。数据来自本机统计，不包含文件路径、密钥或原始日志。

## 分析目标

1. 找出今日 Token 主要花在哪里。
2. 判断哪些任务类型最值得优化。
3. 根据输入、缓存、输出构成，给出减少 Token 消耗的可执行做法。
4. 基于模型价格表做成本对比，但必须说明“同量套价不代表同等任务效果”。
5. 给出接下来 7 天应该追踪的指标。

## 今日总览

- 日期：${daily.date || localDateKey(new Date())}
- 今日累计 Token：${daily.total || 0}
- 输入 Token：${daily.input || 0}
- 缓存 Token：${daily.cached || 0}
- 未缓存输入 Token：${daily.uncached || Math.max(0, (daily.input || 0) - (daily.cached || 0))}
- 输出 Token：${daily.output || 0}
- 任务数：${daily.taskCount || tasks.length}
- 请求数：${daily.requestCount || 0}
- 较昨日变化：${daily.vsYesterdayPct == null ? "无基准" : `${daily.vsYesterdayPct.toFixed(1)}%`}
- 较近 7 日均值变化：${daily.vsSevenDayPct == null ? "无基准" : `${daily.vsSevenDayPct.toFixed(1)}%`}

## 各任务 Token 占比

${taskLines.length ? taskLines.join("\n") : "- 暂无今日任务数据"}

## 模型价格表与今日理论消费

${priceLines.length ? priceLines.join("\n") : "- 暂无模型价格数据"}

## 输出要求

请按“主要消耗来源 -> 可优化任务 -> 具体动作 -> 模型成本对比 -> 7 天追踪指标”的结构输出。不要编造未提供的对话内容。`;
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 5 * 1024 * 1024) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function startServer({ host = "127.0.0.1", port = 8766 } = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${host}:${port}`);
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "content-type",
        });
        res.end();
        return;
      }
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/dashboard.html")) {
        const html = fs.readFileSync(DASHBOARD_FILE, "utf8");
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(html);
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/state") return sendJson(res, 200, publicPayload());
      if (req.method === "GET" && url.pathname === "/api/pack") return sendJson(res, 200, { text: analysisPack(publicPayload()) });
      if (req.method === "GET" && url.pathname === "/api/prices") return sendJson(res, 200, { prices: loadPrices() });
      if (req.method === "POST" && url.pathname === "/api/prices") {
        const raw = await readRequestBody(req);
        const parsed = raw ? JSON.parse(raw) : {};
        return sendJson(res, 200, { prices: savePrices(parsed.prices || parsed) });
      }
      if (req.method === "POST" && url.pathname === "/api/prices/reset") return sendJson(res, 200, { prices: savePrices(DEFAULT_PRICES) });
      if (req.method === "GET" && url.pathname === "/api/theme") return sendJson(res, 200, { theme: loadTheme() });
      if (req.method === "POST" && url.pathname === "/api/theme") {
        const raw = await readRequestBody(req);
        const parsed = raw ? JSON.parse(raw) : {};
        return sendJson(res, 200, { theme: saveTheme(parsed.theme) });
      }
      if (req.method === "POST" && url.pathname === "/api/cover") {
        const raw = await readRequestBody(req);
        const parsed = raw ? JSON.parse(raw) : {};
        const match = String(parsed.dataUrl || "").match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
        if (!match) return sendJson(res, 400, { error: "expected png dataUrl" });
        const buffer = Buffer.from(match[1], "base64");
        if (!buffer.length || buffer.length > 2 * 1024 * 1024) return sendJson(res, 400, { error: "cover image is empty or too large" });
        fs.mkdirSync(STATE_DIR, { recursive: true });
        fs.writeFileSync(COVER_FILE, buffer);
        return sendJson(res, 200, { ok: true, savedTo: COVER_FILE });
      }
      if (req.method === "GET" && url.pathname === "/api/health") return sendJson(res, 200, { ok: true, mode: "local-server", updatedAt: new Date().toISOString() });
      sendJson(res, 404, { error: "not found" });
    } catch (e) {
      sendJson(res, 500, { error: e && e.message ? e.message : String(e) });
    }
  });
  server.on("error", (e) => {
    const message = e && e.code === "EADDRINUSE"
      ? `端口 ${port} 已被占用，请用 --port 指定其他端口`
      : (e && e.message ? e.message : String(e));
    console.error("Token Trace 本机服务启动失败: " + message);
    if (!process.env.CCM_TOKENS_AS_MODULE) process.exit(1);
  });
  server.listen(port, host, () => {
    console.log(`Token Trace 本机服务已启动: http://${host}:${port}`);
    console.log("无需 Codex++；数据来自 Codex 本地会话日志。");
  });
  return server;
}

async function cdpEval(port, expression) {
  const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
  const page = targets.find((t) => t.url === "app://-/index.html" && !t.url.includes("avatar-overlay"));
  if (!page) throw new Error("Codex page target not found on CDP port " + port);
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error("CDP timeout on port " + port));
    }, 8000);
    ws.onopen = () => {
      ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === 1) {
        clearTimeout(timer);
        try { ws.close(); } catch {}
        if (msg.result && msg.result.exceptionDetails) reject(new Error("page error: " + JSON.stringify(msg.result.exceptionDetails).slice(0, 200)));
        else resolve(msg.result && msg.result.result ? msg.result.result.value : undefined);
      }
    };
    ws.onerror = (e) => {
      clearTimeout(timer);
      reject(new Error("WebSocket error: " + (e && e.message ? e.message : "unknown")));
    };
  });
}

// A2: 内置会话 ID 检测，完全自研，不依赖任何外部脚本。
// 从页面 DOM / React fiber 读取当前会话 ID；侧边栏收起时沿用最后确认的 ID。
// 逻辑参考开源实现（MIT）的 readActiveConversationId。
// Sentinel returned when the user is on a brand-new blank conversation that has
// no messages yet: the panel should show zeros instead of the previous data.
const NEW_THREAD = "__new_blank__";

async function activeThreadId(port) {
  try {
    const id = await cdpEval(
      port,
      `(function () {
        function norm(v) {
          if (v == null) return null;
          if (typeof v !== "string" && typeof v !== "number") return null;
          var text = String(v).trim();
          if (!text) return null;
          var cn = /client-new-thread:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(text);
          if (cn) return "client-new-thread:" + cn[1].toLowerCase();
          var m = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(text);
          if (m) return m[0].toLowerCase();
          return text.replace(/^[a-z]+:/i, "").toLowerCase();
        }
        function elConv(el) {
          if (!el || el.nodeType !== 1) return null;
          for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
            var v = n.getAttribute("data-app-action-sidebar-thread-id") || n.getAttribute("data-thread-id") || n.getAttribute("data-conversation-id");
            var c = norm(v);
            if (c) return c;
          }
          return null;
        }
        function hasConversationSurface() {
          return !!(document.querySelector('[data-thread-find-target="conversation"]') ||
                    document.querySelector('[data-thread-find-composer="true"]') ||
                    document.querySelector('[data-codex-composer="true"]') ||
                    document.querySelector('[data-app-shell-main-content-layout*="thread"]'));
        }
        function confirm(id) {
          window.__ccmTokenSpendActiveId = { id: id, at: Date.now() };
          return id;
        }
        var activeSels = [
          '[aria-current="page"][data-app-action-sidebar-thread-id]',
          '[data-app-action-sidebar-thread-active="true"][data-app-action-sidebar-thread-id]',
          '[aria-selected="true"][data-app-action-sidebar-thread-id]',
          '[aria-current="page"]',
          '[data-app-action-sidebar-thread-active="true"]',
          '[aria-selected="true"]'
        ];
        // Brand-new blank conversation (no messages yet): no active sidebar
        // thread and the main conversation area is gone. Return the NEW_THREAD
        // sentinel so the watcher shows zeros instead of the previous data.
        // Note: only a sidebar *thread* with active state counts — other
        // elements (e.g. folders) may also carry aria-current="page".
        try {
          var activeThreadNow = document.querySelector(
            '[aria-current="page"][data-app-action-sidebar-thread-id],' +
            '[data-app-action-sidebar-thread-active="true"][data-app-action-sidebar-thread-id],' +
            '[aria-selected="true"][data-app-action-sidebar-thread-id]'
          );
          if (!activeThreadNow && !document.querySelector('main [data-thread-find-target="conversation"]') && hasConversationSurface()) {
            return "${NEW_THREAD}";
          }
        } catch (e) {}
        try {
          var sels = activeSels;
          for (var i = 0; i < sels.length; i++) {
            var c = elConv(document.querySelector(sels[i]));
            if (c) return confirm(c);
          }
        } catch (e) {}
        try {
          // React fiber 兜底扫描较慢，最多每 2 秒做一次。
          var now = Date.now();
          var cache = window.__ccmTokenSpendActiveIdCache;
          if (cache && cache.id && now - cache.at < 2000) {
            // The main conversation area must still be present, otherwise the
            // cached id is stale (user moved to a new blank conversation).
            if (document.querySelector('main [data-thread-find-target="conversation"]')) return cache.id;
          }
          var seen = new WeakSet();
          function scan(value, depth) {
            if (!value || typeof value !== "object" || depth < 0) return null;
            if (seen.has(value)) return null;
            seen.add(value);
            var idKeys = ["conversationId", "localConversationId", "threadId", "id", "key"];
            for (var k = 0; k < idKeys.length; k++) {
              try {
                var cand = value[idKeys[k]];
                var nm = norm(cand);
                if (nm && /[0-9a-f]{8}-/.test(nm)) return nm;
              } catch (e) {}
            }
            if (value.nodeType === 1) {
              var ec = elConv(value);
              if (ec) return ec;
            }
            if (Array.isArray(value)) {
              var lim = Math.min(value.length, 40);
              for (var i2 = 0; i2 < lim; i2++) {
                var r2 = scan(value[i2], depth - 1);
                if (r2) return r2;
              }
              return null;
            }
            if (value instanceof Map) {
              var i3 = 0;
              for (var pair of value) {
                if (i3 >= 40) break;
                var r3 = scan(pair[1], depth - 1);
                if (r3) return r3;
                i3 += 1;
              }
              return null;
            }
            var keyRe = /^(?:props|children|memoizedProps|pendingProps|memoizedState|stateNode|child|sibling|return|alternate|value|current|context|node|chain|conversationId|localConversationId|threadId|id|key|params|thread|conversation)$/;
            for (var key in value) {
              if (!keyRe.test(key)) continue;
              try {
                var child = value[key];
                if (child === value) continue;
                var r4 = scan(child, depth - 1);
                if (r4) return r4;
              } catch (e) {}
            }
            return null;
          }
          var anchors = [
            document.querySelector("main"),
            document.querySelector('[data-thread-find-target="conversation"]'),
            document.querySelector('[data-thread-find-composer="true"]'),
            document.querySelector('[data-codex-composer="true"]'),
            document.getElementById("root")
          ];
          for (var a = 0; a < anchors.length; a++) {
            var anchor = anchors[a];
            if (!anchor) continue;
            var direct = elConv(anchor);
            if (direct) { window.__ccmTokenSpendActiveIdCache = { id: direct, at: now }; return confirm(direct); }
            for (var pk in anchor) {
              if (!/^__react(?:Props|Fiber|Container)\$/.test(pk)) continue;
              try {
                var r5 = scan(anchor[pk], 14);
                if (r5) { window.__ccmTokenSpendActiveIdCache = { id: r5, at: now }; return confirm(r5); }
              } catch (e) {}
            }
          }
          window.__ccmTokenSpendActiveIdCache = { id: null, at: now };
        } catch (e) {}
        // 侧边栏收起时 active/current 节点会消失；主会话区仍在时沿用最后确认的 ID。
        try {
          var last = window.__ccmTokenSpendActiveId;
          if (last && last.id && document.querySelector('main [data-thread-find-target="conversation"]') && hasConversationSurface()) return last.id;
        } catch (e) {}
        return null;
      })()`,
    );
    if (id) return id;
  } catch {}
  return null;
}

async function cdpPush(port, payload) {
  const expr = `window.__ccmTokenSpend = ${JSON.stringify(payload)}; window.dispatchEvent(new Event("ccm-token-spend")); "ok"`;
  return cdpEval(port, expr);
}

function resolveFile(threadId) {
  const files = findRolloutFiles().sort((a, b) => {
    const am = fs.statSync(a).mtimeMs;
    const bm = fs.statSync(b).mtimeMs;
    return bm - am;
  });
  if (threadId) return files.find((f) => threadIdOf(f) === threadId) || null;
  return files[0] || null;
}

// Newest session file that actually contains data (skips empty/broken files).
function resolveAnyFile() {
  const files = findRolloutFiles().sort((a, b) => {
    const am = fs.statSync(a).mtimeMs;
    const bm = fs.statSync(b).mtimeMs;
    return bm - am;
  });
  for (const f of files) {
    if (parseFile(f)) return f;
  }
  return null;
}

// Stats for a conversation that exists but has no data yet (shows zeros).
function emptyStats(threadId, file) {
  return {
    threadId: threadId || "",
    file: file || "",
    date: file ? fileDate(file) : "",
    modelContextWindow: null,
    requestCount: 0,
    sessionTotal: 0,
    sessionInput: 0,
    sessionCached: 0,
    sessionOutput: 0,
    contextUsed: 0,
    turns: [],
  };
}

// ---- client-new-thread 占位 ID 映射 ----
// 新建对话在侧边栏里是 local:client-new-thread:<uuid> 占位 ID，而会话文件用的是真实 ID。
// 遇到占位 ID 时，把「占位 ID 首次出现之后新建的会话文件」学习为该对话的真实 ID，
// 并持久化到本地，避免监控进程重启后丢失映射。
const CLIENT_MAP_DIR = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
const CLIENT_MAP_FILE = path.join(CLIENT_MAP_DIR, "ccm-token-spend", "client-thread-map.json");

let clientState = { clientMap: {}, activatedAt: {} };
try {
  const raw = fs.readFileSync(CLIENT_MAP_FILE, "utf8");
  const o = JSON.parse(raw);
  clientState = {
    clientMap: o && typeof o.clientMap === "object" ? o.clientMap : {},
    activatedAt: o && typeof o.activatedAt === "object" ? o.activatedAt : {},
  };
} catch {}

function saveClientState() {
  try {
    fs.mkdirSync(path.dirname(CLIENT_MAP_FILE), { recursive: true });
    fs.writeFileSync(CLIENT_MAP_FILE, JSON.stringify(clientState));
  } catch {}
}

function isClientNewThread(id) {
  return typeof id === "string" && id.indexOf("client-new-thread:") === 0;
}

function clientThreadUuid(id) {
  const m = /^client-new-thread:([0-9a-f-]+)$/i.exec(id);
  return m ? m[1] : id;
}

// 占位对话首次出现之后新建（首次提交）的会话文件，用来学习 占位ID -> 真实ID。
function findNewestClientFileSince(ts, excludeThreadId) {
  const files = findRolloutFiles();
  let best = null;
  let bestTime = -1;
  const slack = 1000;
  for (const f of files) {
    if (excludeThreadId && threadIdOf(f) === excludeThreadId) continue;
    try {
      const st = fs.statSync(f);
      const created = st.birthtimeMs && st.birthtimeMs > 0 ? st.birthtimeMs : st.ctimeMs;
      if (created >= ts - slack && st.mtimeMs > bestTime) {
        bestTime = st.mtimeMs;
        best = f;
      }
    } catch {}
  }
  return best ? threadIdOf(best) : null;
}

// 兜底：修复前已存在、已有内容的占位对话，其文件创建时间早于激活时间。
// 这时学习「最新且未被其他占位对话认领」的会话文件。
function findNewestUnclaimedFile(excludeThreadId, claimedSet) {
  const files = findRolloutFiles();
  let best = null;
  let bestTime = -1;
  for (const f of files) {
    const tid = threadIdOf(f);
    if (!tid) continue;
    if (excludeThreadId && tid === excludeThreadId) continue;
    if (claimedSet && claimedSet.has(tid)) continue;
    try {
      const st = fs.statSync(f);
      if (st.mtimeMs > bestTime) {
        bestTime = st.mtimeMs;
        best = f;
      }
    } catch {}
  }
  return best ? threadIdOf(best) : null;
}

// 页面里是否有真实会话内容（空白新对话没有 conversation surface）。
async function hasConversationContent(port) {
  try {
    const v = await cdpEval(port, `!!document.querySelector('main [data-thread-find-target="conversation"]')`);
    return v === true || v === "true";
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  const args = { thread: null, all: false, detail: false, watch: false, cdp: false, server: false, host: "127.0.0.1", port: 9229, portSet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--thread") args.thread = argv[i + 1];
    else if (a === "--all") args.all = true;
    else if (a === "--detail") args.detail = true;
    else if (a === "--watch") args.watch = true;
    else if (a === "--cdp") args.cdp = true;
    else if (a === "--server") args.server = true;
    else if (a === "--host") args.host = argv[i + 1] || args.host;
    else if (a === "--port") {
      args.port = Number(argv[i + 1]);
      args.portSet = true;
    }
  }
  if (args.server && !args.portSet) args.port = 8766;
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.server) {
    startServer({ host: args.host, port: args.port });
    return;
  }

  if (args.all) {
    const files = findRolloutFiles().sort((a, b) => b.localeCompare(a));
    if (!files.length) {
      console.log("未找到任何会话记录: " + SESSIONS_DIR);
      return;
    }
    console.log("=== 每个对话的 token 消耗量 ===");
    for (const f of files) {
      const parsed = parseFile(f);
      if (!parsed) continue;
      const stats = buildStats(parsed);
      const last = stats.turns[stats.turns.length - 1];
      console.log(
        `${stats.date || ""}  ${(stats.threadId || "?").slice(0, 8)}…  ${fmtShort(stats.sessionTotal)} tokens (${stats.requestCount} 次请求, ${stats.turns.length} 轮)` +
          (last && last.snippet ? `  「${last.snippet}」` : ""),
      );
    }
    return;
  }

  if (args.watch) {
    let lastKey = "";
    let lastPushAt = 0;
    let lastRealThreadId = "";
    console.log("监控中… 每 1 秒刷新" + (args.cdp ? "，并通过调试端口写入 Codex 页面" : "") + " (Ctrl+C 退出)");
    for (;;) {
      try {
        const rawThread = args.thread || (await activeThreadId(args.port));
        let thread = rawThread;
        let threadIsClientNew = false;
        if (isClientNewThread(rawThread)) {
          threadIsClientNew = true;
          const ph = clientThreadUuid(rawThread);
          if (!(ph in clientState.activatedAt)) {
            clientState.activatedAt[ph] = Date.now();
            saveClientState();
          }
          const learned = clientState.clientMap[ph];
          if (learned) {
            thread = learned;
          } else {
            // 排除上一个真实对话的文件，避免刚离开旧对话的瞬间误关联。
            const cand = findNewestClientFileSince(clientState.activatedAt[ph], lastRealThreadId);
            if (cand) {
              clientState.clientMap[ph] = cand;
              saveClientState();
              thread = cand;
            } else if (await hasConversationContent(args.port)) {
              // 修复前已存在、已有内容的占位对话：文件创建时间早于激活时间，
              // 用「最新且未被认领的会话文件」兜底学习。
              const claimed = new Set(Object.values(clientState.clientMap));
              const fb = findNewestUnclaimedFile(lastRealThreadId, claimed);
              if (fb) {
                clientState.clientMap[ph] = fb;
                saveClientState();
                thread = fb;
              } else {
                thread = null;
              }
            } else {
              thread = null; // 仍是空白新对话 -> 显示 0
            }
          }
        }
        let file = null;
        let parsed = null;
        let stats = null;
        if (thread && thread !== NEW_THREAD) {
          file = resolveFile(thread);
          parsed = file ? parseFile(file) : null;
          if (parsed) {
            stats = buildStats(parsed);
          } else {
            // Active conversation exists but has no data yet -> show zeros.
            stats = emptyStats(thread, file);
          }
        } else if (thread === NEW_THREAD) {
          // Brand-new blank conversation, nothing sent yet -> show zeros.
          stats = emptyStats(null, null);
        } else if (threadIsClientNew) {
          // 占位对话还没有对应文件（仍是空白）-> 显示 0，不回退到上一个对话。
          stats = emptyStats(null, null);
        } else {
          // 启动加载期（页面还没加载完、读不到对话 ID）：显示 0，
          // 等加载完成识别出当前对话后再显示真实数据，不回退到上一个对话。
          stats = emptyStats(null, null);
        }
        if (stats) {
          if (thread && thread !== NEW_THREAD && stats.threadId) lastRealThreadId = stats.threadId;
          const key = `${stats.threadId}|${stats.requestCount}|${stats.sessionTotal}`;
          const changed = key !== lastKey;
          const heartbeat = args.cdp && Date.now() - lastPushAt > 1000;
          if (changed || heartbeat) {
            if (changed) lastKey = key;
            if (args.cdp) {
              const daily = buildDailySummary(stats.threadId);
              await cdpPush(args.port, payloadFor(stats, daily));
              lastPushAt = Date.now();
              if (changed) {
                console.log(`[${new Date().toLocaleTimeString()}] 已推送: ${stats.threadId?.slice(0, 8)}… 累计 ${fmtShort(stats.sessionTotal)} tokens`);
              }
            } else if (changed) {
              console.log(`[${new Date().toLocaleTimeString()}] 会话 ${stats.threadId?.slice(0, 8)}… 累计 ${fmtShort(stats.sessionTotal)} tokens / ${stats.requestCount} 次请求`);
            }
          }
        }
      } catch (e) {
        if (args.cdp) console.log("推送失败: " + (e && e.message ? e.message : e));
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const file = resolveFile(args.thread);
  if (!file) {
    console.log("未找到会话记录: " + SESSIONS_DIR);
    process.exit(1);
  }
  const parsed = parseFile(file);
  if (!parsed) {
    console.log("会话文件为空或格式无法解析: " + file);
    process.exit(1);
  }
  const stats = buildStats(parsed);
  printStats(stats, { detail: args.detail });

  if (args.cdp) {
    await cdpPush(args.port, payloadFor(stats, buildDailySummary(stats.threadId)));
    console.log("");
    console.log("已写入 Codex 页面 (port " + args.port + ")");
  }
}

if (!process.env.CCM_TOKENS_AS_MODULE) {
  main().catch((e) => {
    console.error("错误: " + (e && e.message ? e.message : e));
    process.exit(1);
  });
}

export {
  SESSIONS_DIR,
  CLIENT_MAP_FILE,
  clientState,
  saveClientState,
  isClientNewThread,
  clientThreadUuid,
  findNewestClientFileSince,
  findNewestUnclaimedFile,
  hasConversationContent,
  findRolloutFiles,
  threadIdOf,
  resolveFile,
  resolveAnyFile,
  emptyStats,
  parseFile,
  buildStats,
  localDateKey,
  parseFileCached,
  median,
  buildRuleInsights,
  buildDailySummary,
  payloadFor,
  DEFAULT_PRICES,
  loadPrices,
  savePrices,
  modelCost,
  newestStats,
  publicPayload,
  analysisPack,
  startServer,
};
