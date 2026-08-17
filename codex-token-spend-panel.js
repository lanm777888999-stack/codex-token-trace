(() => {
  "use strict";

  if (window.__ccmTokenSpendPanelInstalled) return;
  window.__ccmTokenSpendPanelInstalled = true;

  const ROOT_ID = "ccm-token-spend-panel";
  const MINI_ID = "ccm-token-spend-mini";
  const DASH_ID = "ccm-token-trace-dashboard";
  const STYLE_ID = "ccm-token-trace-style";
  const CLOSED_KEY = "__ccmTokenSpendPanelClosed";
  const POS_KEY = "__ccmTokenSpendPanelPos";
  const MINI_POS_KEY = "__ccmTokenSpendMiniPos";
  const SIZE_KEY = "__ccmTokenSpendPanelSize";
  const THEME_KEY = "__ccmTokenTraceTheme";
  const PRICES_KEY = "__ccmTokenTracePricesV1";

  const DEFAULT_PRICES = [
    { id: "deepseek", name: "DeepSeek V4 Flash", region: "CN", fresh: 1.01, cached: 0.02, output: 2.02 },
    { id: "qwen", name: "Qwen 3.7 Plus", region: "CN", fresh: 2, cached: 0.2, output: 8 },
    { id: "glm", name: "GLM-5.2", region: "CN", fresh: 4, cached: 0.5, output: 16 },
    { id: "kimi", name: "Kimi K2.5", region: "CN", fresh: 4, cached: 1, output: 16 },
    { id: "gpt", name: "GPT-5.6 Sol", region: "Global", fresh: 36, cached: 3.6, output: 216 },
  ];

  const state = {
    data: window.__ccmTokenSpend || null,
    root: null,
    mini: null,
    dashboard: null,
    view: "main",
    selectedTaskId: "",
    prices: loadPrices(),
    theme: loadTheme(),
    manipulating: false,
  };

  function loadJson(key, fallback) {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(key));
      return parsed == null ? fallback : parsed;
    } catch {
      return fallback;
    }
  }

  function saveJson(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function loadTheme() {
    try {
      const saved = window.localStorage.getItem(THEME_KEY);
      if (saved === "light" || saved === "dark") return saved;
    } catch {}
    try {
      const target = document.body || document.documentElement;
      const match = getComputedStyle(target).backgroundColor.match(/[\d.]+/g);
      if (match && match.length >= 3) {
        const [r, g, b] = match.slice(0, 3).map(Number);
        const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        if (luminance < 0.42) return "dark";
        if (luminance > 0.68) return "light";
      }
    } catch {}
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }

  function loadPrices() {
    const saved = loadJson(PRICES_KEY, null);
    if (!Array.isArray(saved) || !saved.length) return DEFAULT_PRICES.map((item) => ({ ...item }));
    return DEFAULT_PRICES.map((base) => {
      const match = saved.find((item) => item && item.id === base.id) || {};
      return {
        ...base,
        fresh: numberOr(match.fresh, base.fresh),
        cached: numberOr(match.cached, base.cached),
        output: numberOr(match.output, base.output),
      };
    });
  }

  function numberOr(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fmtShort(value, digits = 1) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "--";
    if (Math.abs(n) >= 1e9) return trim((n / 1e9).toFixed(digits)) + "B";
    if (Math.abs(n) >= 1e6) return trim((n / 1e6).toFixed(digits)) + "M";
    if (Math.abs(n) >= 1e3) return trim((n / 1e3).toFixed(digits)) + "k";
    return Math.round(n).toLocaleString("zh-CN");
  }

  function trim(value) {
    return String(value).replace(/\.0+$|(?<=\.[0-9])0+$/g, "");
  }

  function fmtMoney(value) {
    const n = Number(value) || 0;
    if (n >= 1000) return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
    if (n >= 10) return "$" + n.toFixed(2);
    return "$" + n.toFixed(3);
  }

  function fmtPct(value, fallback = "--") {
    const n = Number(value);
    return Number.isFinite(n) ? `${Math.round(n * 100)}%` : fallback;
  }

  function formatDelta(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "暂无基准";
    if (Math.abs(n) < 0.1) return "基本持平";
    return `${n > 0 ? "↑" : "↓"} ${Math.abs(n).toFixed(0)}%`;
  }

  function clock(iso) {
    const d = new Date(iso || "");
    if (Number.isNaN(d.getTime())) return "--:--";
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map((v) => String(v).padStart(2, "0")).join(":");
  }

  function modelCost(price, source) {
    const input = numberOr(source && source.input);
    const cached = Math.min(input, numberOr(source && source.cached));
    const output = numberOr(source && source.output);
    const uncached = Math.max(0, input - cached);
    return (uncached * price.fresh + cached * price.cached + output * price.output) / 1e6;
  }

  function costRows(source) {
    return state.prices
      .map((price) => ({ ...price, cost: modelCost(price, source) }))
      .sort((a, b) => a.cost - b.cost);
  }

  function sparkline(values, width = 260, height = 72, stroke = "#7c5cff") {
    const nums = values.map(Number).filter(Number.isFinite);
    if (!nums.length) return `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true"><path d="M0 ${height - 8}H${width}" stroke="currentColor" opacity=".12"/></svg>`;
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const spread = Math.max(1, max - min);
    const pad = 5;
    const points = nums.map((n, i) => {
      const x = nums.length === 1 ? width / 2 : pad + (i / (nums.length - 1)) * (width - pad * 2);
      const y = height - pad - ((n - min) / spread) * (height - pad * 2);
      return [x, y];
    });
    const line = points.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
    const area = `${line} L${points[points.length - 1][0].toFixed(1)} ${height} L${points[0][0].toFixed(1)} ${height} Z`;
    return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="Token 趋势"><defs><linearGradient id="ccm-spark-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${stroke}" stop-opacity=".36"/><stop offset="1" stop-color="${stroke}" stop-opacity="0"/></linearGradient></defs><path d="${area}" fill="url(#ccm-spark-fill)"/><path d="${line}" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${points.map((p, i) => i === points.length - 1 ? `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="${stroke}" stroke="var(--tt-panel)" stroke-width="2"/>` : "").join("")}</svg>`;
  }

  function timelineSvg(daily) {
    const timeline = Array.isArray(daily && daily.timeline) ? daily.timeline : [];
    const rows = costRows(daily || {}).slice(0, 3);
    const width = 760;
    const height = 205;
    const plotTop = 20;
    const plotBottom = 168;
    const left = 18;
    const right = 742;
    const colors = ["#7c5cff", "#12b886", "#ff8a3d"];
    const series = rows.map((row) => {
      let sum = 0;
      return timeline.map((bucket) => {
        sum += modelCost(row, bucket);
        return sum;
      });
    });
    const max = Math.max(1, ...series.flat());
    const paths = series.map((values, index) => {
      const points = values.map((value, i) => {
        const x = left + (i / 23) * (right - left);
        const y = plotBottom - (value / max) * (plotBottom - plotTop);
        return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
      }).join(" ");
      return `<path d="${points}" fill="none" stroke="${colors[index]}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
    }).join("");
    const grids = [0, .33, .66, 1].map((ratio) => {
      const y = plotBottom - ratio * (plotBottom - plotTop);
      return `<path d="M${left} ${y}H${right}" stroke="currentColor" opacity=".08"/><text x="${right}" y="${y - 5}" text-anchor="end" fill="currentColor" opacity=".52" font-size="11">${fmtMoney(max * ratio)}</text>`;
    }).join("");
    return `<svg class="tt-line-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="今日模型消费累计趋势">${grids}${paths}<text x="${left}" y="194" fill="currentColor" opacity=".52" font-size="11">00:00</text><text x="380" y="194" text-anchor="middle" fill="currentColor" opacity=".52" font-size="11">12:00</text><text x="${right}" y="194" text-anchor="end" fill="currentColor" opacity=".52" font-size="11">现在</text></svg><div class="tt-chart-legend">${rows.map((row, index) => `<span><i style="--legend:${colors[index]}"></i>${esc(row.name)}</span>`).join("")}</div>`;
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
#${ROOT_ID}, #${ROOT_ID} *, #${MINI_ID}, #${MINI_ID} *, #${DASH_ID}, #${DASH_ID} * { box-sizing:border-box; }
#${ROOT_ID}, #${MINI_ID}, #${DASH_ID} { --tt-bg:#0b0c11; --tt-panel:#13151d; --tt-card:#181b24; --tt-card-2:#20232d; --tt-border:rgba(255,255,255,.09); --tt-text:#f3f1ff; --tt-muted:#9b9aa8; --tt-purple:#7c5cff; --tt-purple-2:#a998ff; --tt-green:#12b886; --tt-orange:#ff8a3d; --tt-red:#ff5c72; font-family:Inter,"SF Pro Display","Segoe UI","Microsoft YaHei",sans-serif; color:var(--tt-text); }
#${ROOT_ID}[data-theme="light"], #${MINI_ID}[data-theme="light"], #${DASH_ID}[data-theme="light"] { --tt-bg:#f4f2ef; --tt-panel:#fff; --tt-card:#f7f5f2; --tt-card-2:#ede9e4; --tt-border:rgba(25,20,35,.11); --tt-text:#1d1a23; --tt-muted:#726d78; --tt-purple:#6847e8; --tt-purple-2:#8168ec; }
#${ROOT_ID} { position:fixed; z-index:2147483000; top:76px; right:18px; width:334px; height:346px; min-width:290px; min-height:310px; max-width:min(520px,calc(100vw - 8px)); max-height:calc(100vh - 48px); border:1px solid var(--tt-border); border-radius:22px; background:color-mix(in srgb,var(--tt-panel) 94%,transparent); box-shadow:0 22px 70px rgba(0,0,0,.38),0 1px 0 rgba(255,255,255,.05) inset; backdrop-filter:blur(22px); overflow:hidden; user-select:none; }
#${ROOT_ID} button, #${DASH_ID} button, #${DASH_ID} input { font:inherit; }
#${ROOT_ID} button, #${DASH_ID} button { color:inherit; }
#${ROOT_ID} .ccm-head { height:54px; display:flex; align-items:center; gap:10px; padding:0 15px 0 17px; cursor:grab; border-bottom:1px solid var(--tt-border); }
#${ROOT_ID} .ccm-head:active { cursor:grabbing; }
#${ROOT_ID} .ccm-live { width:8px;height:8px;border-radius:50%;background:var(--tt-green);box-shadow:0 0 0 5px color-mix(in srgb,var(--tt-green) 14%,transparent);flex:0 0 auto; }
#${ROOT_ID} .ccm-head-copy { min-width:0; flex:1; }
#${ROOT_ID} .ccm-kicker { font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--tt-purple-2);font-weight:800; }
#${ROOT_ID} .ccm-title { font-size:14px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px; }
#${ROOT_ID} .ccm-icon-btn { width:31px;height:31px;border:0;border-radius:10px;background:transparent;display:grid;place-items:center;cursor:pointer;font-size:18px;color:var(--tt-muted); }
#${ROOT_ID} .ccm-icon-btn:hover { background:var(--tt-card-2);color:var(--tt-text); }
#${ROOT_ID} .ccm-body { height:calc(100% - 54px);padding:17px;display:flex;flex-direction:column;overflow:auto;scrollbar-width:thin; }
#${ROOT_ID} .ccm-hero-row { display:flex;align-items:flex-start;justify-content:space-between;gap:12px; }
#${ROOT_ID} .ccm-label { font-size:12px;color:var(--tt-muted);font-weight:650; }
#${ROOT_ID} .ccm-hero { font-size:34px;line-height:1;font-weight:780;letter-spacing:-.045em;margin-top:7px;font-variant-numeric:tabular-nums; }
#${ROOT_ID} .ccm-delta { margin-top:8px;font-size:12px;color:var(--tt-green);background:color-mix(in srgb,var(--tt-green) 12%,transparent);padding:5px 8px;border-radius:999px;white-space:nowrap; }
#${ROOT_ID} .ccm-chart { height:68px;margin:10px -2px 5px;color:var(--tt-muted); }
#${ROOT_ID} .ccm-chart svg { width:100%;height:100%;overflow:visible; }
#${ROOT_ID} .ccm-stats { display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin-top:auto; }
#${ROOT_ID} .ccm-stat { border:1px solid var(--tt-border);background:color-mix(in srgb,var(--tt-card) 82%,transparent);padding:10px;border-radius:13px;min-width:0; }
#${ROOT_ID} .ccm-stat span { display:block;font-size:10px;color:var(--tt-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
#${ROOT_ID} .ccm-stat strong { display:block;margin-top:5px;font-size:15px;font-weight:740;white-space:nowrap; }
#${ROOT_ID} .ccm-foot { display:flex;align-items:center;justify-content:space-between;margin-top:13px;gap:10px; }
#${ROOT_ID} .ccm-updated { font-size:10px;color:var(--tt-muted); }
#${ROOT_ID} .ccm-open { border:0;background:transparent;padding:0;color:var(--tt-purple-2);font-weight:750;font-size:12px;cursor:pointer; }
#${ROOT_ID} .ccm-open:hover { color:var(--tt-text); }
#${ROOT_ID} .ccm-resize { position:absolute;width:18px;height:18px;z-index:5; }
#${ROOT_ID} .ccm-resize[data-corner="se"] { right:0;bottom:0;cursor:nwse-resize; }
#${ROOT_ID} .ccm-resize[data-corner="nw"] { left:0;top:0;cursor:nwse-resize; }
#${ROOT_ID} .ccm-resize[data-corner="ne"] { right:0;top:0;cursor:nesw-resize; }
#${ROOT_ID} .ccm-resize[data-corner="sw"] { left:0;bottom:0;cursor:nesw-resize; }
#${ROOT_ID} .ccm-resize[data-corner="se"]::after { content:"";position:absolute;right:4px;bottom:4px;width:7px;height:7px;border-right:2px solid var(--tt-muted);border-bottom:2px solid var(--tt-muted);opacity:.45; }
#${MINI_ID} { position:fixed;z-index:2147483000;top:76px;right:18px;height:43px;min-width:88px;padding:0 12px;border:1px solid var(--tt-border);border-radius:15px;background:var(--tt-panel);box-shadow:0 14px 44px rgba(0,0,0,.3);display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;font-size:12px;font-weight:760; }
#${MINI_ID} .ccm-mini-dot { width:8px;height:8px;border-radius:50%;background:var(--tt-purple);box-shadow:0 0 0 4px color-mix(in srgb,var(--tt-purple) 16%,transparent); }
#${DASH_ID} { position:fixed;z-index:2147483300;inset:0;background:color-mix(in srgb,#06070a 76%,transparent);backdrop-filter:blur(16px);padding:18px;overflow:auto; }
#${DASH_ID} .tt-shell { width:min(1400px,100%);min-height:calc(100vh - 36px);margin:0 auto;background:var(--tt-bg);border:1px solid var(--tt-border);border-radius:28px;box-shadow:0 35px 100px rgba(0,0,0,.48);overflow:hidden; }
#${DASH_ID} .tt-top { min-height:76px;padding:14px 22px;display:flex;align-items:center;gap:18px;border-bottom:1px solid var(--tt-border);position:sticky;top:-18px;z-index:10;background:color-mix(in srgb,var(--tt-bg) 92%,transparent);backdrop-filter:blur(20px); }
#${DASH_ID} .tt-brand { display:flex;align-items:center;gap:11px;min-width:210px; }
#${DASH_ID} .tt-logo { width:38px;height:38px;border-radius:13px;display:grid;place-items:center;background:linear-gradient(145deg,var(--tt-purple),#3b2a92);font-size:18px;font-weight:900;color:#fff;box-shadow:0 8px 26px color-mix(in srgb,var(--tt-purple) 32%,transparent); }
#${DASH_ID} .tt-brand strong { display:block;font-size:15px;letter-spacing:.04em; }
#${DASH_ID} .tt-brand span { display:block;font-size:11px;color:var(--tt-muted);margin-top:2px; }
#${DASH_ID} .tt-crumb { flex:1;font-size:13px;color:var(--tt-muted); }
#${DASH_ID} .tt-top-actions { display:flex;align-items:center;gap:8px; }
#${DASH_ID} .tt-btn { min-height:38px;padding:0 14px;border:1px solid var(--tt-border);border-radius:12px;background:var(--tt-card);font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap; }
#${DASH_ID} .tt-btn:hover { border-color:color-mix(in srgb,var(--tt-purple) 55%,var(--tt-border));transform:translateY(-1px); }
#${DASH_ID} .tt-btn.primary { background:var(--tt-purple);border-color:var(--tt-purple);color:#fff; }
#${DASH_ID} .tt-btn.icon { width:38px;padding:0;font-size:17px; }
#${DASH_ID} .tt-page { padding:24px; }
#${DASH_ID} .tt-view-head { display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin-bottom:20px; }
#${DASH_ID} .tt-eyebrow { font-size:11px;letter-spacing:.13em;text-transform:uppercase;color:var(--tt-purple-2);font-weight:850; }
#${DASH_ID} h1, #${DASH_ID} h2, #${DASH_ID} h3, #${DASH_ID} p { margin:0; }
#${DASH_ID} h1 { font-size:30px;line-height:1.12;letter-spacing:-.035em;margin-top:7px; }
#${DASH_ID} h2 { font-size:18px;letter-spacing:-.015em; }
#${DASH_ID} h3 { font-size:15px; }
#${DASH_ID} .tt-note { color:var(--tt-muted);font-size:12px;line-height:1.6; }
#${DASH_ID} .tt-hero-grid { display:grid;grid-template-columns:minmax(0,1.35fr) minmax(420px,.9fr);gap:14px; }
#${DASH_ID} .tt-card { background:var(--tt-panel);border:1px solid var(--tt-border);border-radius:20px;padding:19px; }
#${DASH_ID} .tt-today { min-height:224px;position:relative;overflow:hidden; }
#${DASH_ID} .tt-today::after { content:"";position:absolute;width:300px;height:300px;border-radius:50%;right:-110px;top:-150px;background:radial-gradient(circle,color-mix(in srgb,var(--tt-purple) 27%,transparent),transparent 68%);pointer-events:none; }
#${DASH_ID} .tt-today-value { font-size:58px;line-height:1;font-weight:800;letter-spacing:-.06em;margin:13px 0 10px;font-variant-numeric:tabular-nums; }
#${DASH_ID} .tt-chips { display:flex;gap:8px;flex-wrap:wrap; }
#${DASH_ID} .tt-chip { font-size:12px;color:var(--tt-muted);border:1px solid var(--tt-border);padding:6px 9px;border-radius:999px;background:color-mix(in srgb,var(--tt-card) 80%,transparent); }
#${DASH_ID} .tt-chip.up { color:var(--tt-orange); }
#${DASH_ID} .tt-chip.down { color:var(--tt-green); }
#${DASH_ID} .tt-composition { margin-top:22px; }
#${DASH_ID} .tt-comp-bar { height:8px;display:flex;border-radius:999px;overflow:hidden;background:var(--tt-card-2); }
#${DASH_ID} .tt-comp-bar i { display:block;height:100%; }
#${DASH_ID} .tt-comp-legend { display:flex;gap:16px;flex-wrap:wrap;margin-top:9px;color:var(--tt-muted);font-size:11px; }
#${DASH_ID} .tt-comp-legend b { width:7px;height:7px;border-radius:50%;display:inline-block;margin-right:5px; }
#${DASH_ID} .tt-kpis { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px; }
#${DASH_ID} .tt-kpi { min-height:105px;background:var(--tt-panel);border:1px solid var(--tt-border);border-radius:18px;padding:16px; }
#${DASH_ID} .tt-kpi span { color:var(--tt-muted);font-size:12px; }
#${DASH_ID} .tt-kpi strong { display:block;font-size:25px;margin-top:11px;letter-spacing:-.03em; }
#${DASH_ID} .tt-kpi small { display:block;margin-top:5px;color:var(--tt-muted);font-size:11px; }
#${DASH_ID} .tt-main-grid { display:grid;grid-template-columns:minmax(360px,.82fr) minmax(0,1.35fr);gap:14px;margin-top:14px;align-items:start; }
#${DASH_ID} .tt-card-head { display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px; }
#${DASH_ID} .tt-card-head span { color:var(--tt-muted);font-size:11px; }
#${DASH_ID} .tt-task-list { display:flex;flex-direction:column;gap:7px; }
#${DASH_ID} .tt-task { width:100%;border:1px solid transparent;border-radius:14px;background:transparent;padding:11px 12px;text-align:left;cursor:pointer;position:relative;overflow:hidden; }
#${DASH_ID} .tt-task:hover { background:var(--tt-card); }
#${DASH_ID} .tt-task.active { border-color:color-mix(in srgb,var(--tt-purple) 45%,transparent);background:color-mix(in srgb,var(--tt-purple) 9%,var(--tt-card)); }
#${DASH_ID} .tt-task-line { display:flex;justify-content:space-between;gap:12px;align-items:flex-start;position:relative;z-index:1; }
#${DASH_ID} .tt-task-name { min-width:0;font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
#${DASH_ID} .tt-task-meta { font-size:11px;color:var(--tt-muted);margin-top:5px; }
#${DASH_ID} .tt-task-value { text-align:right;white-space:nowrap;font-size:14px;font-weight:760; }
#${DASH_ID} .tt-task-value small { display:block;color:var(--tt-muted);font-size:10px;margin-top:5px;font-weight:500; }
#${DASH_ID} .tt-task-bar { height:3px;background:var(--tt-card-2);border-radius:9px;margin-top:9px;overflow:hidden; }
#${DASH_ID} .tt-task-bar i { display:block;height:100%;background:var(--tt-purple);border-radius:9px; }
#${DASH_ID} .tt-empty { padding:30px 12px;text-align:center;border:1px dashed var(--tt-border);border-radius:14px;color:var(--tt-muted);font-size:13px;line-height:1.7; }
#${DASH_ID} .tt-analysis-head { display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding-bottom:16px;border-bottom:1px solid var(--tt-border); }
#${DASH_ID} .tt-analysis-title { min-width:0; }
#${DASH_ID} .tt-analysis-title h2 { white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:620px; }
#${DASH_ID} .tt-analysis-title p { color:var(--tt-muted);font-size:11px;margin-top:6px; }
#${DASH_ID} .tt-severity { padding:6px 9px;border-radius:999px;background:color-mix(in srgb,var(--tt-orange) 13%,transparent);color:var(--tt-orange);font-size:11px;font-weight:750;white-space:nowrap; }
#${DASH_ID} .tt-insights { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:16px; }
#${DASH_ID} .tt-insight { background:var(--tt-card);border:1px solid var(--tt-border);border-radius:15px;padding:14px; }
#${DASH_ID} .tt-insight-top { display:flex;align-items:flex-start;gap:10px; }
#${DASH_ID} .tt-insight-icon { width:28px;height:28px;border-radius:9px;background:color-mix(in srgb,var(--tt-orange) 13%,transparent);color:var(--tt-orange);display:grid;place-items:center;flex:0 0 auto;font-weight:900; }
#${DASH_ID} .tt-insight h3 { margin-top:2px; }
#${DASH_ID} .tt-insight p { color:var(--tt-muted);font-size:11px;line-height:1.55;margin-top:6px; }
#${DASH_ID} .tt-action { margin-top:11px;padding-top:11px;border-top:1px solid var(--tt-border);color:var(--tt-purple-2);font-size:12px;line-height:1.5; }
#${DASH_ID} .tt-model-card { margin-top:14px; }
#${DASH_ID} .tt-models { display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px; }
#${DASH_ID} .tt-model { background:var(--tt-card);border:1px solid var(--tt-border);border-radius:14px;padding:13px;min-width:0; }
#${DASH_ID} .tt-model.best { border-color:color-mix(in srgb,var(--tt-green) 45%,transparent);background:color-mix(in srgb,var(--tt-green) 7%,var(--tt-card)); }
#${DASH_ID} .tt-model-name { color:var(--tt-muted);font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
#${DASH_ID} .tt-model strong { display:block;margin-top:9px;font-size:20px;letter-spacing:-.04em; }
#${DASH_ID} .tt-model small { display:block;margin-top:5px;color:var(--tt-muted);font-size:10px; }
#${DASH_ID} .tt-chart-wrap { margin-top:14px;background:var(--tt-card);border:1px solid var(--tt-border);border-radius:16px;padding:10px 14px 8px; }
#${DASH_ID} .tt-line-chart { display:block;width:100%;height:190px;color:var(--tt-muted);overflow:visible; }
#${DASH_ID} .tt-chart-legend { display:flex;justify-content:center;gap:18px;flex-wrap:wrap;color:var(--tt-muted);font-size:10px;margin:-2px 0 6px; }
#${DASH_ID} .tt-chart-legend i { width:16px;height:3px;background:var(--legend);display:inline-block;margin-right:5px;vertical-align:middle;border-radius:4px; }
#${DASH_ID} .tt-path { margin-top:14px;display:flex;align-items:center;justify-content:center;gap:9px;color:var(--tt-muted);font-size:11px;flex-wrap:wrap; }
#${DASH_ID} .tt-path b { color:var(--tt-text);font-weight:700; }
#${DASH_ID} .tt-path i { color:var(--tt-purple);font-style:normal; }
#${DASH_ID} .tt-table-card { max-width:1120px;margin:0 auto; }
#${DASH_ID} .tt-price-table { width:100%;border-collapse:collapse;margin-top:18px; }
#${DASH_ID} .tt-price-table th, #${DASH_ID} .tt-price-table td { padding:13px 12px;border-bottom:1px solid var(--tt-border);text-align:right;font-size:13px; }
#${DASH_ID} .tt-price-table th { color:var(--tt-muted);font-size:11px;font-weight:650; }
#${DASH_ID} .tt-price-table th:first-child, #${DASH_ID} .tt-price-table td:first-child { text-align:left; }
#${DASH_ID} .tt-price-table input { width:100px;background:var(--tt-card);border:1px solid var(--tt-border);border-radius:9px;padding:8px 9px;color:var(--tt-text);text-align:right;outline:none; }
#${DASH_ID} .tt-price-table input:focus { border-color:var(--tt-purple);box-shadow:0 0 0 3px color-mix(in srgb,var(--tt-purple) 13%,transparent); }
#${DASH_ID} .tt-price-result { color:var(--tt-purple-2);font-weight:750; }
#${DASH_ID} .tt-pack-grid { display:grid;grid-template-columns:minmax(0,1.25fr) minmax(280px,.55fr);gap:14px; }
#${DASH_ID} .tt-pack { white-space:pre-wrap;word-break:break-word;background:var(--tt-card);border:1px solid var(--tt-border);border-radius:16px;padding:18px;font:12px/1.7 "Cascadia Code",Consolas,monospace;color:var(--tt-text);max-height:68vh;overflow:auto;user-select:text; }
#${DASH_ID} .tt-privacy { display:flex;flex-direction:column;gap:10px; }
#${DASH_ID} .tt-check { display:flex;gap:10px;color:var(--tt-muted);font-size:12px;line-height:1.5;padding:12px;background:var(--tt-card);border-radius:12px; }
#${DASH_ID} .tt-check i { color:var(--tt-green);font-style:normal;font-weight:900; }
#${DASH_ID} .tt-toast { position:fixed;left:50%;bottom:32px;transform:translate(-50%,20px);background:var(--tt-text);color:var(--tt-bg);padding:10px 15px;border-radius:999px;font-size:12px;font-weight:750;opacity:0;pointer-events:none;transition:.22s ease;z-index:3; }
#${DASH_ID} .tt-toast.show { opacity:1;transform:translate(-50%,0); }
@media (max-width:1050px) { #${DASH_ID} .tt-hero-grid, #${DASH_ID} .tt-main-grid, #${DASH_ID} .tt-pack-grid { grid-template-columns:1fr; } #${DASH_ID} .tt-models { grid-template-columns:repeat(3,minmax(0,1fr)); } }
@media (max-width:700px) { #${DASH_ID} { padding:0; } #${DASH_ID} .tt-shell { border-radius:0;min-height:100vh; } #${DASH_ID} .tt-top { top:0;padding:12px; } #${DASH_ID} .tt-brand span, #${DASH_ID} .tt-crumb, #${DASH_ID} .tt-btn .wide { display:none; } #${DASH_ID} .tt-brand { min-width:0;flex:1; } #${DASH_ID} .tt-page { padding:14px; } #${DASH_ID} .tt-hero-grid { grid-template-columns:1fr; } #${DASH_ID} .tt-today-value { font-size:43px; } #${DASH_ID} .tt-models { grid-template-columns:repeat(2,minmax(0,1fr)); } #${DASH_ID} .tt-insights { grid-template-columns:1fr; } #${DASH_ID} .tt-price-table { display:block;overflow-x:auto;white-space:nowrap; } }
`;
    document.head.appendChild(style);
  }

  function minTop() {
    try {
      const el = document.elementFromPoint(Math.floor(window.innerWidth / 2), 2);
      const bottom = el && el.getBoundingClientRect ? el.getBoundingClientRect().bottom : 0;
      if (bottom >= 20 && bottom <= 100) return Math.ceil(bottom) + 4;
    } catch {}
    return 42;
  }

  function clampElement(el, x, y) {
    const w = el.offsetWidth || 200;
    const h = el.offsetHeight || 60;
    return {
      x: Math.max(4, Math.min(x, window.innerWidth - w - 4)),
      y: Math.max(minTop(), Math.min(y, window.innerHeight - h - 4)),
    };
  }

  function applySavedPos(el, key) {
    const pos = loadJson(key, null);
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return;
    const clamped = clampElement(el, pos.x, pos.y);
    el.style.left = clamped.x + "px";
    el.style.top = clamped.y + "px";
    el.style.right = "auto";
  }

  function makeDraggable(el, handle, key) {
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest("button")) return;
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      state.manipulating = true;
      const move = (ev) => {
        const next = clampElement(el, rect.left + ev.clientX - startX, rect.top + ev.clientY - startY);
        el.style.left = next.x + "px";
        el.style.top = next.y + "px";
        el.style.right = "auto";
      };
      const done = () => {
        state.manipulating = false;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", done);
        const finalRect = el.getBoundingClientRect();
        saveJson(key, { x: finalRect.left, y: finalRect.top });
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", done, { once: true });
    });
  }

  function makeResizable(el, handle, corner) {
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = el.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      state.manipulating = true;
      const move = (ev) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        let width = rect.width + (corner.includes("e") ? dx : -dx);
        let height = rect.height + (corner.includes("s") ? dy : -dy);
        width = Math.max(290, Math.min(width, window.innerWidth - 8));
        height = Math.max(310, Math.min(height, window.innerHeight - minTop() - 4));
        let left = corner.includes("w") ? rect.right - width : rect.left;
        let top = corner.includes("n") ? rect.bottom - height : rect.top;
        left = Math.max(4, Math.min(left, window.innerWidth - width - 4));
        top = Math.max(minTop(), Math.min(top, window.innerHeight - height - 4));
        el.style.width = width + "px";
        el.style.height = height + "px";
        el.style.left = left + "px";
        el.style.top = top + "px";
        el.style.right = "auto";
      };
      const done = () => {
        state.manipulating = false;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", done);
        const end = el.getBoundingClientRect();
        saveJson(SIZE_KEY, { w: end.width, h: end.height });
        saveJson(POS_KEY, { x: end.left, y: end.top });
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", done, { once: true });
    });
  }

  function isClosed() {
    try { return window.localStorage.getItem(CLOSED_KEY) === "1"; } catch { return false; }
  }

  function setClosed(value) {
    try { window.localStorage.setItem(CLOSED_KEY, value ? "1" : "0"); } catch {}
  }

  function ensurePanel() {
    ensureStyles();
    if (state.root && state.root.isConnected) return state.root;
    const root = document.createElement("section");
    root.id = ROOT_ID;
    root.dataset.theme = state.theme;
    root.setAttribute("aria-label", "Token 消耗趋势悬浮卡");
    root.innerHTML = `
      <header class="ccm-head">
        <i class="ccm-live"></i>
        <div class="ccm-head-copy"><div class="ccm-kicker">Token Trace</div><div class="ccm-title">当前对话 · 实时</div></div>
        <button class="ccm-icon-btn" data-action="dashboard" title="打开今日效率分析">↗</button>
        <button class="ccm-icon-btn" data-action="collapse" title="收起悬浮卡">−</button>
      </header>
      <div class="ccm-body">
        <div class="ccm-hero-row"><div><div class="ccm-label">本轮 Token</div><div class="ccm-hero" data-field="turn">0</div></div><div class="ccm-delta" data-field="delta">等待数据</div></div>
        <div class="ccm-chart" data-field="spark"></div>
        <div class="ccm-stats">
          <div class="ccm-stat"><span>对话累计</span><strong data-field="session">0</strong></div>
          <div class="ccm-stat"><span>上下文占用</span><strong data-field="context">0%</strong></div>
          <div class="ccm-stat"><span>缓存命中</span><strong data-field="cache">0%</strong></div>
        </div>
        <div class="ccm-foot"><span class="ccm-updated" data-field="updated">等待统计程序</span><button class="ccm-open" data-action="dashboard">查看今日分析 →</button></div>
      </div>
      ${["nw", "ne", "sw", "se"].map((corner) => `<i class="ccm-resize" data-corner="${corner}"></i>`).join("")}`;
    document.body.appendChild(root);
    state.root = root;
    const savedSize = loadJson(SIZE_KEY, null);
    if (savedSize && Number.isFinite(savedSize.w) && Number.isFinite(savedSize.h)) {
      root.style.width = Math.max(290, savedSize.w) + "px";
      root.style.height = Math.max(310, savedSize.h) + "px";
    }
    applySavedPos(root, POS_KEY);
    makeDraggable(root, root.querySelector(".ccm-head"), POS_KEY);
    root.querySelectorAll(".ccm-resize").forEach((handle) => makeResizable(root, handle, handle.dataset.corner));
    root.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      if (button.dataset.action === "dashboard") openDashboard();
      if (button.dataset.action === "collapse") collapsePanel();
    });
    return root;
  }

  function ensureMini() {
    ensureStyles();
    if (state.mini && state.mini.isConnected) return state.mini;
    const mini = document.createElement("button");
    mini.id = MINI_ID;
    mini.dataset.theme = state.theme;
    mini.innerHTML = `<i class="ccm-mini-dot"></i><span data-field="mini-total">Token</span>`;
    document.body.appendChild(mini);
    state.mini = mini;
    applySavedPos(mini, MINI_POS_KEY);
    makeDraggable(mini, mini, MINI_POS_KEY);
    let down = null;
    mini.addEventListener("pointerdown", (event) => { down = { x: event.clientX, y: event.clientY }; });
    mini.addEventListener("click", (event) => {
      if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) return;
      showPanel();
    });
    return mini;
  }

  function collapsePanel() {
    setClosed(true);
    if (state.root) state.root.remove();
    state.root = null;
    renderMini();
  }

  function showPanel() {
    setClosed(false);
    if (state.mini) state.mini.remove();
    state.mini = null;
    renderPanel();
  }

  function renderMini() {
    const mini = ensureMini();
    const data = state.data || {};
    const last = Array.isArray(data.turns) && data.turns.length ? data.turns[data.turns.length - 1].total : 0;
    mini.querySelector("[data-field='mini-total']").textContent = fmtShort(last || data.sessionTotal || 0);
  }

  function renderPanel() {
    if (isClosed()) {
      if (state.root) state.root.remove();
      state.root = null;
      renderMini();
      return;
    }
    const root = ensurePanel();
    const data = state.data || {};
    const turns = Array.isArray(data.turns) ? data.turns : [];
    const values = turns.slice(-9).map((turn) => numberOr(turn.total));
    const current = values.length ? values[values.length - 1] : 0;
    const previous = values.length > 1 ? values[values.length - 2] : null;
    const delta = previous > 0 ? ((current - previous) / previous) * 100 : null;
    const contextRate = data.modelContextWindow > 0 ? numberOr(data.contextUsed) / data.modelContextWindow : null;
    const cacheRate = data.sessionInput > 0 ? numberOr(data.sessionCached) / data.sessionInput : null;
    root.querySelector("[data-field='turn']").textContent = fmtShort(current);
    const deltaEl = root.querySelector("[data-field='delta']");
    deltaEl.textContent = delta == null ? "首轮基准" : `${delta >= 0 ? "↑" : "↓"} ${Math.abs(delta).toFixed(0)}% 较上轮`;
    deltaEl.style.color = delta != null && delta > 0 ? "var(--tt-orange)" : "var(--tt-green)";
    root.querySelector("[data-field='spark']").innerHTML = sparkline(values.length ? values : [0, 0]);
    root.querySelector("[data-field='session']").textContent = fmtShort(data.sessionTotal || 0);
    root.querySelector("[data-field='context']").textContent = fmtPct(contextRate, "--");
    root.querySelector("[data-field='cache']").textContent = fmtPct(cacheRate, "--");
    root.querySelector("[data-field='updated']").textContent = data.updatedAt ? `更新于 ${clock(data.updatedAt)}` : "等待统计程序";
    const title = root.querySelector(".ccm-title");
    title.textContent = data.threadId ? `当前对话 · ${String(data.threadId).slice(0, 8)}` : "当前对话 · 等待数据";
  }

  function openDashboard() {
    ensureStyles();
    if (!state.dashboard || !state.dashboard.isConnected) {
      const root = document.createElement("div");
      root.id = DASH_ID;
      root.dataset.theme = state.theme;
      root.setAttribute("role", "dialog");
      root.setAttribute("aria-modal", "true");
      root.setAttribute("aria-label", "Token Trace 今日效率分析");
      root.addEventListener("click", handleDashboardClick);
      root.addEventListener("input", handleDashboardInput);
      document.body.appendChild(root);
      state.dashboard = root;
    }
    state.dashboard.style.display = "block";
    renderDashboard();
  }

  function closeDashboard() {
    if (state.dashboard) state.dashboard.style.display = "none";
  }

  function selectedTask(daily) {
    const tasks = Array.isArray(daily && daily.tasks) ? daily.tasks : [];
    let task = tasks.find((item) => item.threadId === state.selectedTaskId);
    if (!task) task = tasks.find((item) => item.isActive) || tasks[0] || null;
    if (task) state.selectedTaskId = task.threadId;
    return task;
  }

  function renderDashboard() {
    if (!state.dashboard || state.dashboard.style.display === "none") return;
    state.dashboard.dataset.theme = state.theme;
    const labels = { main: "今日效率分析", prices: "模型价格表", pack: "Agent 分析包" };
    state.dashboard.innerHTML = `<div class="tt-shell"><header class="tt-top"><div class="tt-brand"><div class="tt-logo">T</div><div><strong>TOKEN TRACE</strong><span>AI 使用效率分析器</span></div></div><div class="tt-crumb">${labels[state.view] || labels.main}</div><div class="tt-top-actions"><button class="tt-btn" data-action="prices"><span class="wide">模型价格</span> ⚙</button><button class="tt-btn primary" data-action="pack"><span class="wide">导出 Agent 分析包</span> ↗</button><button class="tt-btn icon" data-action="theme" title="切换主题">${state.theme === "dark" ? "☼" : "◐"}</button><button class="tt-btn icon" data-action="close" title="关闭">×</button></div></header>${state.view === "prices" ? renderPricesView() : state.view === "pack" ? renderPackView() : renderMainView()}<div class="tt-toast" data-field="toast"></div></div>`;
  }

  function renderMainView() {
    const data = state.data || {};
    const daily = data.daily || { total: 0, input: 0, cached: 0, output: 0, taskCount: 0, requestCount: 0, tasks: [], timeline: [] };
    const task = selectedTask(daily);
    const tasks = Array.isArray(daily.tasks) ? daily.tasks : [];
    const total = numberOr(daily.total);
    const input = numberOr(daily.input);
    const cached = Math.min(input, numberOr(daily.cached));
    const output = numberOr(daily.output);
    const uncached = Math.max(0, input - cached);
    const inputShare = total > 0 ? uncached / total : 0;
    const cachedShare = total > 0 ? cached / total : 0;
    const outputShare = total > 0 ? output / total : 0;
    const ranked = costRows(daily);
    return `<main class="tt-page">
      <div class="tt-view-head"><div><div class="tt-eyebrow">Daily consumption → action</div><h1>今天的 AI 消耗，哪里最值得优化？</h1></div><p class="tt-note">数据来自本机 Codex 会话日志 · 不上传原始对话</p></div>
      <section class="tt-hero-grid">
        <article class="tt-card tt-today"><div class="tt-eyebrow">今日累计 Token</div><div class="tt-today-value">${fmtShort(total, 2)}</div><div class="tt-chips"><span class="tt-chip ${numberOr(daily.vsYesterdayPct) > 0 ? "up" : "down"}">较昨日 ${formatDelta(daily.vsYesterdayPct)}</span><span class="tt-chip ${numberOr(daily.vsSevenDayPct) > 0 ? "up" : "down"}">较 7 日均值 ${formatDelta(daily.vsSevenDayPct)}</span></div><div class="tt-composition"><div class="tt-comp-bar"><i style="width:${inputShare * 100}%;background:var(--tt-purple)"></i><i style="width:${cachedShare * 100}%;background:var(--tt-green)"></i><i style="width:${outputShare * 100}%;background:var(--tt-orange)"></i></div><div class="tt-comp-legend"><span><b style="background:var(--tt-purple)"></b>新输入 ${fmtShort(uncached)}</span><span><b style="background:var(--tt-green)"></b>缓存 ${fmtShort(cached)}</span><span><b style="background:var(--tt-orange)"></b>输出 ${fmtShort(output)}</span></div></div></article>
        <div class="tt-kpis"><article class="tt-kpi"><span>今日任务</span><strong>${daily.taskCount || tasks.length}</strong><small>按 Codex 对话归类</small></article><article class="tt-kpi"><span>Agent 请求</span><strong>${numberOr(daily.requestCount).toLocaleString("zh-CN")}</strong><small>今日模型调用次数</small></article><article class="tt-kpi"><span>缓存命中</span><strong>${fmtPct(input > 0 ? cached / input : null)}</strong><small>缓存输入 / 总输入</small></article><article class="tt-kpi"><span>最低理论消费</span><strong>${ranked.length ? fmtMoney(ranked[0].cost) : "$0"}</strong><small>按可编辑价格套算</small></article></div>
      </section>
      <section class="tt-main-grid">
        <article class="tt-card"><div class="tt-card-head"><div><div class="tt-eyebrow">Task share</div><h2>各任务 Token 占比</h2></div><span>点击任务查看原因</span></div>${renderTaskList(tasks, total)}</article>
        <article class="tt-card">${renderTaskAnalysis(task)}</article>
      </section>
      <section class="tt-card tt-model-card"><div class="tt-card-head"><div><div class="tt-eyebrow">Same tokens · different price</div><h2>按今日总 Token 的模型消费对比</h2></div><span>同量套价不代表同等任务效果 · 价格可编辑</span></div><div class="tt-models">${ranked.map((row, index) => `<article class="tt-model ${index === 0 ? "best" : ""}"><div class="tt-model-name">${esc(row.name)}</div><strong>${fmtMoney(row.cost)}</strong><small>${index === 0 ? "当前最低理论消费" : `${row.region} · / 1M Token`}</small></article>`).join("")}</div><div class="tt-chart-wrap">${timelineSvg(daily)}</div></section>
      <div class="tt-path"><b>今日累计</b><i>→</i><b>找到高消耗任务</b><i>→</i><b>查看原因</b><i>→</i><b>比较模型</b><i>→</i><b>导出行动建议</b></div>
    </main>`;
  }

  function renderTaskList(tasks, total) {
    if (!tasks.length) return `<div class="tt-empty">今天还没有可统计的任务。<br>发送一次对话后，统计程序会在这里形成任务排行。</div>`;
    return `<div class="tt-task-list">${tasks.slice(0, 8).map((task, index) => {
      const share = total > 0 ? task.total / total : 0;
      return `<button class="tt-task ${task.threadId === state.selectedTaskId ? "active" : ""}" data-action="task" data-task-id="${esc(task.threadId)}"><div class="tt-task-line"><div style="min-width:0"><div class="tt-task-name">${String(index + 1).padStart(2, "0")} · ${esc(task.label || `任务 ${task.threadId.slice(0, 8)}`)}</div><div class="tt-task-meta">${task.turnCount || 0} 轮 · ${task.requestCount || 0} 次请求${task.isActive ? " · 当前" : ""}</div></div><div class="tt-task-value">${fmtShort(task.total)}<small>${(share * 100).toFixed(1)}%</small></div></div><div class="tt-task-bar"><i style="width:${Math.max(2, share * 100)}%"></i></div></button>`;
    }).join("")}</div>`;
  }

  function renderTaskAnalysis(task) {
    if (!task) return `<div class="tt-empty">选择一个今日任务后，这里会用透明规则说明消耗原因并给出对应动作。</div>`;
    const reasons = task.insights && Array.isArray(task.insights.reasons) ? task.insights.reasons : [];
    const actions = task.insights && Array.isArray(task.insights.actions) ? task.insights.actions : [];
    const highest = reasons.some((reason) => reason.severity === "high") ? "需要关注" : reasons.some((reason) => reason.severity === "medium") ? "可优化" : "状态稳定";
    return `<div class="tt-analysis-head"><div class="tt-analysis-title"><div class="tt-eyebrow">Reason → action</div><h2>${esc(task.label || `任务 ${task.threadId.slice(0, 8)}`)}</h2><p>${fmtShort(task.total)} Token · 缓存命中 ${fmtPct(task.cacheRate)} · 输出占比 ${fmtPct(task.outputRate)}</p></div><span class="tt-severity">${highest}</span></div><div class="tt-insights">${reasons.map((reason, index) => {
      const action = actions[index] || {};
      return `<article class="tt-insight"><div class="tt-insight-top"><div class="tt-insight-icon">${reason.severity === "high" ? "!" : reason.severity === "medium" ? "↗" : "✓"}</div><div><h3>${esc(reason.title)}</h3><p>${esc(reason.evidence)}</p></div></div>${action.title ? `<div class="tt-action"><strong>${esc(action.title)}</strong><br>${esc(action.detail)}</div>` : ""}</article>`;
    }).join("")}</div>`;
  }

  function renderPricesView() {
    const daily = (state.data && state.data.daily) || {};
    return `<main class="tt-page"><div class="tt-view-head"><div><div class="tt-eyebrow">Editable price catalog</div><h1>模型价格表</h1></div><button class="tt-btn" data-action="main">← 返回今日分析</button></div><article class="tt-card tt-table-card"><div class="tt-card-head"><div><h2>按每 100 万 Token（USD）编辑</h2><p class="tt-note" style="margin-top:6px">默认值仅用于产品演示。修改后只保存在本机，并立即重算今日消费。</p></div><button class="tt-btn" data-action="reset-prices">恢复演示价格</button></div><table class="tt-price-table"><thead><tr><th>模型</th><th>地区</th><th>新输入</th><th>缓存输入</th><th>输出</th><th>今日理论消费</th></tr></thead><tbody>${state.prices.map((price) => `<tr><td><strong>${esc(price.name)}</strong></td><td>${esc(price.region)}</td>${["fresh", "cached", "output"].map((field) => `<td><input type="number" min="0" step="0.01" value="${price[field]}" data-price-id="${price.id}" data-price-field="${field}" aria-label="${esc(price.name)} ${field}"></td>`).join("")}<td class="tt-price-result" data-cost-id="${price.id}">${fmtMoney(modelCost(price, daily))}</td></tr>`).join("")}</tbody></table></article></main>`;
  }

  function buildAnalysisPack() {
    const data = state.data || {};
    const daily = data.daily || {};
    const task = selectedTask(daily);
    const safeTaskId = task && task.threadId ? task.threadId.slice(0, 8) : "未选择";
    const reasons = task && task.insights ? task.insights.reasons || [] : [];
    const actions = task && task.insights ? task.insights.actions || [] : [];
    const priceLines = costRows(daily).map((row) => `- ${row.name}: ${fmtMoney(row.cost)}（新输入 $${row.fresh} / 缓存 $${row.cached} / 输出 $${row.output}，每 1M Token）`).join("\n");
    return `# Token Trace · Agent 分析请求

你是一位 AI 使用效率分析顾问。请只依据下面的汇总指标和透明规则结果，完成分析；不要臆测未提供的对话内容。

## 你的任务
1. 判断今日最值得处理的 1–3 个消耗问题，并按影响排序。
2. 解释每个判断使用了哪些数据证据。
3. 给出今天即可执行的动作；每条动作说明预期改善指标。
4. 比较不同模型的理论消费，但明确“同量套价不代表同等任务效果”。
5. 最后给出一个 7 天追踪清单。

## 今日汇总
- 日期：${daily.date || new Date().toLocaleDateString("sv-SE")}
- 累计 Token：${numberOr(daily.total)}
- 新输入：${Math.max(0, numberOr(daily.input) - numberOr(daily.cached))}
- 缓存输入：${numberOr(daily.cached)}
- 输出：${numberOr(daily.output)}
- 任务数：${daily.taskCount || 0}
- 请求数：${daily.requestCount || 0}
- 较昨日：${formatDelta(daily.vsYesterdayPct)}
- 较近 7 日均值：${formatDelta(daily.vsSevenDayPct)}

## 选中任务（不含对话正文）
- 匿名任务 ID：${safeTaskId}
- Token：${task ? task.total : 0}
- 输入 / 缓存 / 输出：${task ? `${task.input} / ${task.cached} / ${task.output}` : "0 / 0 / 0"}
- 轮次 / 请求：${task ? `${task.turnCount} / ${task.requestCount}` : "0 / 0"}
- 缓存命中：${task ? fmtPct(task.cacheRate) : "--"}
- 输出占比：${task ? fmtPct(task.outputRate) : "--"}

## 规则发现
${reasons.length ? reasons.map((reason, index) => `${index + 1}. ${reason.title}｜${reason.evidence}`).join("\n") : "- 暂无规则结果"}

## 已匹配动作
${actions.length ? actions.map((action, index) => `${index + 1}. ${action.title}｜${action.detail}`).join("\n") : "- 暂无动作"}

## 今日总量的模型价格套算
${priceLines || "- 暂无价格"}

## 输出格式
请按“优先级判断 → 证据 → 行动 → 模型取舍 → 7 天验证”输出。若数据不足，请明确指出需要补充什么，不要编造。`;
  }

  function renderPackView() {
    return `<main class="tt-page"><div class="tt-view-head"><div><div class="tt-eyebrow">Portable analysis prompt</div><h1>Agent 分析包</h1></div><div style="display:flex;gap:8px"><button class="tt-btn" data-action="main">← 返回</button><button class="tt-btn" data-action="download-pack">下载 .md</button><button class="tt-btn primary" data-action="copy-pack">复制提示词 + 数据</button></div></div><div class="tt-pack-grid"><pre class="tt-pack" data-field="pack">${esc(buildAnalysisPack())}</pre><aside class="tt-card tt-privacy"><div><div class="tt-eyebrow">Privacy boundary</div><h2 style="margin-top:7px">可带走，且尽量克制</h2><p class="tt-note" style="margin-top:9px">把这段内容交给任意 Agent，即可获得更深入分析。</p></div><div class="tt-check"><i>✓</i><span>只包含统计指标、规则结果与价格</span></div><div class="tt-check"><i>✓</i><span>不包含本机文件路径和原始对话正文</span></div><div class="tt-check"><i>✓</i><span>价格版本可由用户修改，避免暗示官方实时价格</span></div><div class="tt-check"><i>!</i><span>匿名任务 ID 仍可能用于本机对照；分享前可手动删除</span></div></aside></div></main>`;
  }

  function handleDashboardClick(event) {
    const actionEl = event.target.closest("[data-action]");
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    if (action === "close") return closeDashboard();
    if (action === "theme") {
      state.theme = state.theme === "dark" ? "light" : "dark";
      try { window.localStorage.setItem(THEME_KEY, state.theme); } catch {}
      if (state.root) state.root.dataset.theme = state.theme;
      if (state.mini) state.mini.dataset.theme = state.theme;
      return renderDashboard();
    }
    if (["main", "prices", "pack"].includes(action)) {
      state.view = action;
      return renderDashboard();
    }
    if (action === "task") {
      state.selectedTaskId = actionEl.dataset.taskId || "";
      return renderDashboard();
    }
    if (action === "reset-prices") {
      state.prices = DEFAULT_PRICES.map((item) => ({ ...item }));
      saveJson(PRICES_KEY, state.prices);
      return renderDashboard();
    }
    if (action === "copy-pack") return copyText(buildAnalysisPack());
    if (action === "download-pack") return downloadPack(buildAnalysisPack());
  }

  function handleDashboardInput(event) {
    const input = event.target.closest("input[data-price-id]");
    if (!input) return;
    const price = state.prices.find((item) => item.id === input.dataset.priceId);
    if (!price) return;
    price[input.dataset.priceField] = numberOr(input.value);
    saveJson(PRICES_KEY, state.prices);
    const daily = (state.data && state.data.daily) || {};
    const result = state.dashboard.querySelector(`[data-cost-id="${price.id}"]`);
    if (result) result.textContent = fmtMoney(modelCost(price, daily));
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("分析包已复制，可直接发给任意 Agent");
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
      toast("分析包已复制");
    }
  }

  function downloadPack(text) {
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `token-trace-analysis-${new Date().toLocaleDateString("sv-SE")}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
    toast("分析包已下载");
  }

  function toast(message) {
    const el = state.dashboard && state.dashboard.querySelector("[data-field='toast']");
    if (!el) return;
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  function render() {
    if (!document.body) return;
    if (isClosed()) renderMini(); else renderPanel();
    if (state.dashboard && state.dashboard.style.display !== "none") renderDashboard();
  }

  window.addEventListener("ccm-token-spend", () => {
    state.data = window.__ccmTokenSpend || null;
    render();
  });
  window.addEventListener("resize", () => {
    if (state.manipulating) return;
    for (const [el, key] of [[state.root, POS_KEY], [state.mini, MINI_POS_KEY]]) {
      if (!el || !el.isConnected) continue;
      const rect = el.getBoundingClientRect();
      const pos = clampElement(el, rect.left, rect.top);
      el.style.left = pos.x + "px";
      el.style.top = pos.y + "px";
      el.style.right = "auto";
      saveJson(key, pos);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.dashboard && state.dashboard.style.display !== "none") closeDashboard();
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render, { once: true });
  else render();
})();
