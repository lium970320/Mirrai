"use strict";

const $ = (id) => document.getElementById(id);
const HISTORY_KEY = "voxcpm_studio_history_v1";

let CONFIG = null;
let selectedProfileId = "calm";
let referenceAudioId = "";
let busy = false;

// ── 启动 ────────────────────────────────────────────────
async function boot() {
  try {
    CONFIG = await fetch("/api/config").then((r) => r.json());
  } catch (e) {
    toast("无法加载配置：" + e.message);
    return;
  }
  renderProfiles();
  applyDefaults();
  bindEvents();
  renderControlChips();
  applyEnrichAvailability();
  initSegments();
  renderHistory();
  pollHealth();
  setInterval(pollHealth, 15000);
}

// ── 健康状态 ────────────────────────────────────────────
async function pollHealth() {
  const dot = $("statusDot");
  const txt = $("statusText");
  try {
    const h = await fetch("/api/health").then((r) => r.json());
    if (h.connected) {
      dot.className = "dot ok";
      txt.textContent = h.modelLoaded
        ? `已连接 · 模型就绪`
        : "已连接 · 模型未加载（首次生成会自动加载）";
    } else {
      dot.className = "dot bad";
      txt.textContent = "未连接 VoxCPM 服务";
    }
  } catch {
    dot.className = "dot bad";
    txt.textContent = "状态检测失败";
  }
}

// ── profile 卡片 ────────────────────────────────────────
function renderProfiles() {
  const grid = $("profileGrid");
  grid.innerHTML = "";
  for (const p of CONFIG.profiles) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "profile-card";
    card.dataset.id = p.id;
    card.innerHTML =
      `<span class="pc-label">${escapeHtml(p.label)}${p.hasReference ? '<span class="pc-clone" title="克隆音色">🎙</span>' : ""}</span>` +
      `<span class="pc-moods">${escapeHtml(p.moods.slice(0, 3).join(" · "))}</span>`;
    card.addEventListener("click", () => selectProfile(p.id));
    grid.appendChild(card);
  }
  const custom = document.createElement("button");
  custom.type = "button";
  custom.className = "profile-card custom";
  custom.dataset.id = "custom";
  custom.innerHTML =
    `<span class="pc-label">自定义</span>` +
    `<span class="pc-moods">自己写控制提示</span>`;
  custom.addEventListener("click", () => selectProfile("custom"));
  grid.appendChild(custom);

  const badge = $("voiceBadge");
  if (CONFIG.voiceName) {
    badge.textContent = "🎙 " + CONFIG.voiceName + " · 克隆音色";
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }

  selectProfile("calm");
}

function selectProfile(id) {
  selectedProfileId = id;
  document.querySelectorAll(".profile-card").forEach((c) => {
    c.classList.toggle("active", c.dataset.id === id);
  });
  if (id !== "custom") {
    const p = CONFIG.profiles.find((x) => x.id === id);
    $("control").value = p ? p.control : CONFIG.baseControl;
  }
}

function currentProfileLabel() {
  if (selectedProfileId === "custom") return "自定义";
  const p = CONFIG.profiles.find((x) => x.id === selectedProfileId);
  return p ? p.label : selectedProfileId;
}

// ── 默认参数 ────────────────────────────────────────────
function applyDefaults() {
  const d = CONFIG.defaults;
  $("cfg").value = d.cfgValue;
  $("cfgVal").textContent = Number(d.cfgValue).toFixed(1);
  $("steps").value = d.inferenceTimesteps;
  $("stepsVal").textContent = d.inferenceTimesteps;
  $("normalize").checked = !!d.normalize;
  $("denoise").checked = !!d.denoise;
  setCloneMode(d.cloneMode || "controllable");
}

const CLONE_HINTS = {
  controllable: "用控制提示决定音色与语气；可选上传参考音频做音色克隆。",
  hifi: "高保真克隆：需要参考音频 + 对应转录文本，此模式会忽略控制提示。",
  design: "音色设计：仅凭控制提示生成一个新音色，无需参考音频。",
};

function setCloneMode(mode) {
  document.querySelectorAll("#cloneMode button").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === mode);
  });
  $("cloneModeHint").textContent = CLONE_HINTS[mode] || "";
  $("control").classList.toggle("disabled-look", mode === "hifi");
}

function getCloneMode() {
  const el = document.querySelector("#cloneMode button.active");
  return el ? el.dataset.mode : "controllable";
}

// ── 事件绑定 ────────────────────────────────────────────
function bindEvents() {
  $("text").addEventListener("input", (e) => {
    $("charCount").textContent = `${e.target.value.length} 字`;
  });
  $("control").addEventListener("input", () => {
    // 手动改控制提示即视为自定义
    if (selectedProfileId !== "custom") selectProfile("custom");
  });
  $("cfg").addEventListener("input", (e) => {
    $("cfgVal").textContent = Number(e.target.value).toFixed(1);
  });
  $("steps").addEventListener("input", (e) => {
    $("stepsVal").textContent = e.target.value;
  });
  document.querySelectorAll("#cloneMode button").forEach((b) => {
    b.addEventListener("click", () => setCloneMode(b.dataset.mode));
  });

  $("refPick").addEventListener("click", () => $("refFile").click());
  $("refFile").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) uploadReference(file);
  });
  $("refClear").addEventListener("click", clearReference);

  $("generate").addEventListener("click", onGenerate);
  $("compare").addEventListener("click", onCompare);

  $("onlyStar").addEventListener("change", renderHistory);
  $("clearHistory").addEventListener("click", () => {
    if (confirm("确定清空全部历史记录？")) {
      localStorage.removeItem(HISTORY_KEY);
      renderHistory();
    }
  });

  document.querySelectorAll(".text-tools [data-insert]").forEach((b) => {
    b.addEventListener("click", () => insertAtCursor($("text"), b.dataset.insert));
  });
  $("enrichBtn").addEventListener("click", onEnrich);

  document.querySelectorAll("#modeSwitch button").forEach((b) => {
    b.addEventListener("click", () => setMode(b.dataset.mode));
  });
  $("addSegment").addEventListener("click", addSegment);
  $("generateMulti").addEventListener("click", onGenerateMulti);
}

// ── 参考音频上传 ────────────────────────────────────────
async function uploadReference(file) {
  $("refName").textContent = "上传中…";
  const fd = new FormData();
  fd.append("referenceAudio", file);
  try {
    const res = await fetch("/api/upload-reference", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.detail || "上传失败");
    referenceAudioId = data.referenceAudioId;
    $("refName").textContent = data.filename || "已上传";
    $("refClear").classList.remove("hidden");
  } catch (e) {
    referenceAudioId = "";
    $("refName").textContent = "上传失败：" + e.message;
  }
}

function clearReference() {
  referenceAudioId = "";
  $("refFile").value = "";
  $("refName").textContent = "未选择";
  $("refClear").classList.add("hidden");
}

// ── 收集参数 + 请求 ────────────────────────────────────
function collectParams() {
  return {
    text: $("text").value.trim(),
    control: $("control").value,
    cloneMode: getCloneMode(),
    cfgValue: $("cfg").value,
    inferenceTimesteps: $("steps").value,
    normalize: $("normalize").checked,
    denoise: $("denoise").checked,
    promptText: $("promptText").value,
    referenceAudioId: referenceAudioId,
    profileId: selectedProfileId === "custom" ? "" : selectedProfileId,
    profileLabel: currentProfileLabel(),
  };
}

async function ttsRequest(params) {
  const fd = new FormData();
  fd.append("text", params.text);
  fd.append("control", params.control || "");
  fd.append("cloneMode", params.cloneMode);
  fd.append("cfgValue", params.cfgValue);
  fd.append("inferenceTimesteps", params.inferenceTimesteps);
  fd.append("normalize", params.normalize ? "true" : "false");
  fd.append("denoise", params.denoise ? "true" : "false");
  fd.append("promptText", params.promptText || "");
  fd.append("referenceAudioId", params.referenceAudioId || "");
  fd.append("profileId", params.profileId || "");
  const res = await fetch("/api/tts", { method: "POST", body: fd });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.detail || data.error || "生成失败");
  return data;
}

function setBusy(on) {
  busy = on;
  $("generate").disabled = on;
  $("compare").disabled = on;
  const gm = $("generateMulti");
  if (gm) gm.disabled = on;
}

// ── 生成 ────────────────────────────────────────────────
async function onGenerate() {
  if (busy) return;
  const params = collectParams();
  if (!params.text) return toast("请先输入文本");
  if (params.cloneMode === "hifi" && (!params.referenceAudioId || !params.promptText.trim())) {
    return toast("Hi-Fi 模式需要上传参考音频并填写转录文本");
  }

  setBusy(true);
  const stopTimer = renderBusy($("currentResult"));
  try {
    const data = await ttsRequest(params);
    renderCurrentResult(data, params);
    addHistory(data, params);
  } catch (e) {
    renderError($("currentResult"), e.message);
  } finally {
    stopTimer();
    setBusy(false);
  }
}

// ── A/B 对比 ────────────────────────────────────────────
async function onCompare() {
  if (busy) return;
  const base = collectParams();
  if (!base.text) return toast("请先输入文本");

  let mode = base.cloneMode;
  if (mode === "hifi") {
    mode = "controllable";
    toast("Hi-Fi 会忽略控制提示，对比已改用「控制合成」");
  }

  $("compareBlock").classList.remove("hidden");
  const list = $("compareList");
  list.innerHTML = "";
  const cards = CONFIG.profiles.map((p) => {
    const card = makeCompareCard(p.label);
    list.appendChild(card.el);
    return { p, card };
  });

  setBusy(true);
  try {
    for (const { p, card } of cards) {
      card.setStatus("生成中…");
      const params = { ...base, control: p.control, cloneMode: mode, profileId: p.id, profileLabel: p.label };
      try {
        const data = await ttsRequest(params);
        card.fill(data);
        addHistory(data, params);
      } catch (e) {
        card.fail(e.message);
      }
    }
  } finally {
    setBusy(false);
  }
}

function makeCompareCard(label) {
  const el = document.createElement("div");
  el.className = "compare-card";
  el.innerHTML =
    `<div class="cc-head"><span class="cc-label">${escapeHtml(label)}</span>` +
    `<span class="cc-status">等待…</span></div>`;
  const statusEl = el.querySelector(".cc-status");
  return {
    el,
    setStatus(t) {
      statusEl.textContent = t;
    },
    fill(data) {
      statusEl.textContent = fmtMs(data.elapsedMs);
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.src = data.url;
      el.appendChild(audio);
    },
    fail(msg) {
      statusEl.textContent = "失败";
      statusEl.classList.add("fail");
      const err = document.createElement("div");
      err.className = "hi-meta";
      err.textContent = msg;
      el.appendChild(err);
    },
  };
}

// ── 结果渲染 ────────────────────────────────────────────
function renderBusy(container) {
  container.className = "result-card busy";
  let secs = 0;
  const render = () => {
    container.innerHTML = `<span class="spinner"></span><span style="margin-left:10px">生成中… ${secs.toFixed(1)}s</span>`;
  };
  render();
  const timer = setInterval(() => {
    secs += 0.1;
    render();
  }, 100);
  return () => clearInterval(timer);
}

function renderCurrentResult(data, params) {
  const el = $("currentResult");
  el.className = "result-card";
  el.innerHTML = "";

  const audio = document.createElement("audio");
  audio.controls = true;
  audio.autoplay = true;
  audio.src = data.url;
  el.appendChild(audio);

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.innerHTML =
    `<span>⏱ ${fmtMs(data.elapsedMs)}</span>` +
    `<span>🎚 ${data.sampleRate || "-"} Hz</span>` +
    `<span>🎛 ${escapeHtml(params.profileLabel)} · ${escapeHtml(params.cloneMode)}</span>` +
    `<span>🤖 ${escapeHtml(data.modelId || "-")}</span>`;
  el.appendChild(meta);

  const txt = document.createElement("div");
  txt.className = "result-text";
  txt.textContent = params.text;
  el.appendChild(txt);

  const dl = document.createElement("a");
  dl.className = "dl";
  dl.href = data.url;
  dl.download = `voxcpm-${data.id.slice(0, 8)}.wav`;
  dl.textContent = "下载 WAV";
  el.appendChild(dl);
}

function renderError(container, msg) {
  container.className = "result-card error";
  container.textContent = "生成失败：" + msg;
}

// ── 历史记录（localStorage） ────────────────────────────
function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch {
    return [];
  }
}

function saveHistory(items) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 100)));
}

function addHistory(data, params) {
  const items = loadHistory();
  items.unshift({
    id: data.id,
    url: data.url,
    text: params.text,
    control: params.control,
    profileLabel: params.profileLabel || currentProfileLabel(),
    cloneMode: params.cloneMode,
    cfgValue: params.cfgValue,
    inferenceTimesteps: params.inferenceTimesteps,
    normalize: params.normalize,
    denoise: params.denoise,
    elapsedMs: data.elapsedMs,
    sampleRate: data.sampleRate,
    time: new Date().toISOString(),
    starred: false,
  });
  saveHistory(items);
  renderHistory();
}

function renderHistory() {
  const list = $("historyList");
  const onlyStar = $("onlyStar").checked;
  let items = loadHistory();
  if (onlyStar) items = items.filter((it) => it.starred);

  if (items.length === 0) {
    list.innerHTML = `<div class="empty">${onlyStar ? "还没有收藏的记录。" : "历史记录为空。"}</div>`;
    return;
  }

  list.innerHTML = "";
  for (const it of items) {
    const item = document.createElement("div");
    item.className = "history-item";

    const top = document.createElement("div");
    top.className = "hi-top";
    top.innerHTML =
      `<div class="hi-text">${escapeHtml(it.text)}</div>` +
      `<div class="hi-actions">` +
      `<button class="icon-btn star ${it.starred ? "on" : ""}" title="收藏">${it.starred ? "★" : "☆"}</button>` +
      `<button class="icon-btn reuse" title="回填参数">↩</button>` +
      `<button class="icon-btn del" title="删除">🗑</button>` +
      `</div>`;
    item.appendChild(top);

    const audio = document.createElement("audio");
    audio.controls = true;
    audio.src = it.url;
    item.appendChild(audio);

    const tags = document.createElement("div");
    tags.className = "hi-tags";
    tags.innerHTML =
      `<span class="tag">${escapeHtml(it.profileLabel || "-")}</span>` +
      `<span class="tag">${escapeHtml(it.cloneMode)}</span>` +
      `<span class="tag">cfg ${it.cfgValue}</span>` +
      `<span class="tag">steps ${it.inferenceTimesteps}</span>`;
    item.appendChild(tags);

    const metaRow = document.createElement("div");
    metaRow.className = "hi-meta";
    metaRow.textContent = `${fmtTime(it.time)} · ${fmtMs(it.elapsedMs)}`;
    item.appendChild(metaRow);

    top.querySelector(".star").addEventListener("click", () => toggleStar(it.id));
    top.querySelector(".reuse").addEventListener("click", () => reuse(it));
    top.querySelector(".del").addEventListener("click", () => delHistory(it.id));

    list.appendChild(item);
  }
}

function toggleStar(id) {
  const items = loadHistory();
  const it = items.find((x) => x.id === id);
  if (it) it.starred = !it.starred;
  saveHistory(items);
  renderHistory();
}

function delHistory(id) {
  saveHistory(loadHistory().filter((x) => x.id !== id));
  renderHistory();
}

function reuse(it) {
  $("text").value = it.text;
  $("charCount").textContent = `${it.text.length} 字`;
  $("control").value = it.control || "";
  selectProfile("custom");
  setCloneMode(it.cloneMode || "controllable");
  $("cfg").value = it.cfgValue;
  $("cfgVal").textContent = Number(it.cfgValue).toFixed(1);
  $("steps").value = it.inferenceTimesteps;
  $("stepsVal").textContent = it.inferenceTimesteps;
  $("normalize").checked = !!it.normalize;
  $("denoise").checked = !!it.denoise;
  window.scrollTo({ top: 0, behavior: "smooth" });
  toast("已回填该记录的参数");
}

// ── 工具 ────────────────────────────────────────────────
let toastTimer = null;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 2600);
}

function fmtMs(ms) {
  if (ms == null) return "-";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function fmtTime(iso) {
  try {
    return new Date(iso).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return iso;
  }
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── 文本工具 / AI 表演增强 ───────────────────────────────
const CONTROL_CHIPS = [
  "慢一点", "语速中等偏慢", "稍快一点",
  "句间多停顿", "短句之间留停顿",
  "温柔", "带很轻的笑意", "克制低声提醒", "情绪收住", "叹气感", "不要朗读腔",
];

function renderControlChips() {
  const box = $("controlChips");
  if (!box) return;
  box.innerHTML = "";
  for (const w of CONTROL_CHIPS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip sm";
    b.textContent = w;
    b.addEventListener("click", () => appendControl(w));
    box.appendChild(b);
  }
}

function appendControl(word) {
  const el = $("control");
  const cur = el.value.trim().replace(/[；;]\s*$/, "");
  el.value = cur ? `${cur}；${word}` : word;
  if (selectedProfileId !== "custom") selectProfile("custom");
  el.dispatchEvent(new Event("input"));
}

function insertAtCursor(el, str) {
  const start = el.selectionStart != null ? el.selectionStart : el.value.length;
  const end = el.selectionEnd != null ? el.selectionEnd : el.value.length;
  el.value = el.value.slice(0, start) + str + el.value.slice(end);
  const pos = start + str.length;
  el.selectionStart = el.selectionEnd = pos;
  el.focus();
  el.dispatchEvent(new Event("input"));
}

function applyEnrichAvailability() {
  const btn = $("enrichBtn");
  if (btn && !CONFIG.enrichAvailable) btn.style.display = "none";
}

async function onEnrich() {
  const text = $("text").value.trim();
  if (!text) return toast("请先输入文本");
  const btn = $("enrichBtn");
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = "✨ 增强中…";
  try {
    const res = await fetch("/api/enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, control: $("control").value }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.detail || "增强失败");
    $("text").value = data.speechText;
    $("charCount").textContent = `${data.speechText.length} 字`;
    if (data.control) {
      $("control").value = data.control;
      selectProfile("custom");
    }
    toast(data.fallback ? "已增强（整体填入）" : "已生成表演稿，可直接生成试听");
  } catch (e) {
    toast("AI 增强失败：" + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

// ── 分段表演稿 ───────────────────────────────────────────
let currentMode = "single";
let SEGMENTS = [];

function setMode(mode) {
  currentMode = mode;
  document.querySelectorAll("#modeSwitch button").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === mode);
  });
  $("singleMode").classList.toggle("hidden", mode !== "single");
  $("singleExtra").classList.toggle("hidden", mode !== "single");
  $("segmentMode").classList.toggle("hidden", mode !== "segments");
  $("segmentExtra").classList.toggle("hidden", mode !== "segments");
}

function initSegments() {
  if (SEGMENTS.length === 0) {
    SEGMENTS = [
      { text: "", profileId: "comfort", silenceAfterMs: 350 },
      { text: "", profileId: "tease", silenceAfterMs: 0 },
    ];
  }
  renderSegments();
  const b2 = $("voiceBadge2");
  if (b2 && CONFIG.voiceName) {
    b2.textContent = "🎙 " + CONFIG.voiceName + " · 克隆音色";
    b2.classList.remove("hidden");
  }
}

function renderSegments() {
  const list = $("segmentList");
  list.innerHTML = "";
  const opts = (CONFIG.profiles || [])
    .map((p) => `<option value="${p.id}">${escapeHtml(p.label)}</option>`)
    .join("");
  SEGMENTS.forEach((seg, i) => {
    const row = document.createElement("div");
    row.className = "segment-row";
    row.innerHTML =
      `<div class="seg-head"><span class="seg-no">${i + 1}</span>` +
      `<select class="seg-profile">${opts}</select>` +
      `<label class="seg-sil">段后停顿 <input type="number" class="seg-silence" min="0" max="3000" step="50" value="${seg.silenceAfterMs}"> ms</label>` +
      `<button type="button" class="icon-btn seg-del" title="删除该段">🗑</button></div>` +
      `<textarea class="seg-text" rows="2" placeholder="第 ${i + 1} 段台词…"></textarea>`;
    const sel = row.querySelector(".seg-profile");
    sel.value = seg.profileId;
    sel.addEventListener("change", () => { SEGMENTS[i].profileId = sel.value; });
    const txt = row.querySelector(".seg-text");
    txt.value = seg.text;
    txt.addEventListener("input", () => { SEGMENTS[i].text = txt.value; });
    const sil = row.querySelector(".seg-silence");
    sil.addEventListener("input", () => { SEGMENTS[i].silenceAfterMs = parseInt(sil.value) || 0; });
    row.querySelector(".seg-del").addEventListener("click", () => {
      if (SEGMENTS.length <= 1) return toast("至少保留一段");
      SEGMENTS.splice(i, 1);
      renderSegments();
    });
    list.appendChild(row);
  });
}

function addSegment() {
  SEGMENTS.push({ text: "", profileId: "calm", silenceAfterMs: 300 });
  renderSegments();
}

async function onGenerateMulti() {
  if (busy) return;
  const rows = SEGMENTS.filter((s) => s.text.trim());
  if (!rows.length) return toast("请至少填写一段文本");
  const cfgV = $("cfg").value;
  const stepsV = $("steps").value;
  const norm = $("normalize").checked;
  const den = $("denoise").checked;
  const segments = rows.map((s) => {
    const prof = (CONFIG.profiles || []).find((p) => p.id === s.profileId);
    return {
      text: s.text.trim(),
      control: prof ? prof.control : "",
      cloneMode: "controllable",
      cfgValue: parseFloat(cfgV),
      inferenceTimesteps: parseInt(stepsV),
      normalize: norm,
      denoise: den,
      profileId: s.profileId,
      silenceAfterMs: parseInt(s.silenceAfterMs) || 0,
    };
  });

  setBusy(true);
  const stop = renderBusy($("currentResult"));
  try {
    const res = await fetch("/api/tts-multi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segments }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.detail || "合成失败");
    renderMultiResult(data, rows);
    addHistory(data, {
      text: rows.map((r, i) => `${i + 1}.${r.text.trim()}`).join("  "),
      control: "（分段表演稿）",
      profileLabel: `分段×${rows.length}`,
      cloneMode: "multi",
      cfgValue: cfgV,
      inferenceTimesteps: stepsV,
      normalize: norm,
      denoise: den,
    });
  } catch (e) {
    renderError($("currentResult"), e.message);
  } finally {
    stop();
    setBusy(false);
  }
}

function profileLabelById(id) {
  const p = (CONFIG.profiles || []).find((x) => x.id === id);
  return p ? p.label : id;
}

function renderMultiResult(data, rows) {
  const el = $("currentResult");
  el.className = "result-card";
  el.innerHTML = "";
  const audio = document.createElement("audio");
  audio.controls = true;
  audio.autoplay = true;
  audio.src = data.url;
  el.appendChild(audio);
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.innerHTML = `<span>🧩 ${rows.length} 段拼接</span><span>⏱ ${fmtMs(data.elapsedMs)}</span>`;
  el.appendChild(meta);
  const txt = document.createElement("div");
  txt.className = "result-text";
  txt.textContent = rows
    .map((r, i) => `${i + 1}. [${profileLabelById(r.profileId)}] ${r.text.trim()}`)
    .join("\n");
  el.appendChild(txt);
  const dl = document.createElement("a");
  dl.className = "dl";
  dl.href = data.url;
  dl.download = `voxcpm-multi-${data.id.slice(0, 8)}.wav`;
  dl.textContent = "下载 WAV";
  el.appendChild(dl);
}

boot();
