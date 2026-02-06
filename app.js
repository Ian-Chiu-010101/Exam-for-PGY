// ======================
// Storage keys (隔離)
// ======================
const WRONG_KEY = "medquiz_wrong_v1_NEWBANK";
const SAVED_KEY = "medquiz_saved_v1_NEWBANK";

// ======================
// State
// ======================
let ALL = [];
let pool = [];
let current = null;
let answered = false;

// mode: "all" | "wrong" | "saved"
let mode = "all";

// ======================
// Wrong store
// ======================
function getWrongMap() {
  try { return JSON.parse(localStorage.getItem(WRONG_KEY) || "{}"); }
  catch { return {}; }
}
function setWrongMap(map) { localStorage.setItem(WRONG_KEY, JSON.stringify(map)); }
function incWrong(id) {
  const m = getWrongMap();
  m[id] = (m[id] || 0) + 1;
  setWrongMap(m);
}
function clearWrong() { localStorage.removeItem(WRONG_KEY); }

// ======================
// Saved store (收藏/手動儲存)
// 用 Set<string> 存 id，序列化成 array
// ======================
function getSavedSet() {
  try {
    const arr = JSON.parse(localStorage.getItem(SAVED_KEY) || "[]");
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}
function setSavedSet(set) {
  localStorage.setItem(SAVED_KEY, JSON.stringify([...set]));
}
function isSaved(id) {
  return getSavedSet().has(id);
}
function toggleSaved(id) {
  const s = getSavedSet();
  if (s.has(id)) s.delete(id);
  else s.add(id);
  setSavedSet(s);
  return s.has(id);
}

// ======================
// Loader / Normalize
// ======================
function normalizeQuestions(data, sourceId = "UNKNOWN") {
  if (!Array.isArray(data)) throw new Error(`[${sourceId}] 題庫必須是陣列`);

  data.forEach((q, i) => {
    if (!q || !q.id || !q.stem || !q.options || !q.answer) {
      throw new Error(`[${sourceId}] 第 ${i + 1} 題缺少必要欄位（id/stem/options/answer）`);
    }
    if (typeof q.options !== "object") {
      throw new Error(`[${sourceId}] 第 ${i + 1} 題 options 必須是 object（例如 {A:"",B:""}）`);
    }
  });

  return data;
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}：${url}`);
  return await res.json();
}

async function loadFromManifest() {
  const manifest = await fetchJson(`./data/manifest.json?v=${Date.now()}`);
  const enabled = (manifest.sources || []).filter(s => s.enabled);

  const merged = [];
  const idSet = new Set();

  // A：去重統計
  let totalIn = 0;
  let dupCount = 0;
  const dupIds = [];

  for (const src of enabled) {
    const data = await fetchJson(`${src.path}?v=${Date.now()}`);
    const qs = normalizeQuestions(data, src.id);

    for (const q of qs) {
      totalIn += 1;
      if (idSet.has(q.id)) {
        dupCount += 1;
        if (dupIds.length < 20) dupIds.push(q.id);
        continue;
      }
      idSet.add(q.id);
      merged.push(q);
    }
  }

  merged._meta = { totalIn, uniqueOut: merged.length, dupCount, dupIds };
  return merged;
}

// ======================
// UI helpers
// ======================
function $(id) { return document.getElementById(id); }

function setFeedback(msg, type = "") {
  const el = $("feedback");
  if (!el) return;
  el.className = "feedback" + (type ? ` ${type}` : "");
  el.textContent = msg || "";
}

function updateProgress() {
  const el = $("progress");
  if (!el) return;
  const wrongCount = Object.keys(getWrongMap()).length;
  const savedCount = getSavedSet().size;
  el.textContent = `總題數：${ALL.length}｜錯題：${wrongCount}｜收藏：${savedCount}｜模式：${mode}`;
}

function updateModeButtons() {
  const btnWrong = $("btnToggleWrong");
  const btnSavedMode = $("btnToggleSaved");

  if (btnWrong) btnWrong.textContent = `錯題模式：${mode === "wrong" ? "開" : "關"}`;
  if (btnSavedMode) btnSavedMode.textContent = `收藏模式：${mode === "saved" ? "開" : "關"}`;
}

function updateSaveButton() {
  const btn = $("btnSave");
  if (!btn) return;
  if (!current) { btn.textContent = "收藏本題"; return; }
  btn.textContent = isSaved(current.id) ? "取消收藏" : "收藏本題";
}

// ======================
// Explanation renderer (修正 [object Object])
// ======================
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderExplanation(exp) {
  if (!exp) return "";

  // 舊格式：直接是字串
  if (typeof exp === "string") {
    return `<div class="exp-sec"><div class="exp-body">${escapeHtml(exp)}</div></div>`;
  }

  // 新格式：物件（例如 {correct_reasoning, option_analysis, exam_tips}）
  if (typeof exp === "object") {
    const correct = exp.correct_reasoning
      ? `<div class="exp-sec">
           <div class="exp-title">核心解題</div>
           <div class="exp-body">${escapeHtml(exp.correct_reasoning)}</div>
         </div>`
      : "";

    const optionAnalysis = exp.option_analysis && typeof exp.option_analysis === "object"
      ? `<div class="exp-sec">
           <div class="exp-title">選項解析</div>
           ${Object.entries(exp.option_analysis)
             .map(([k, v]) => `<div class="exp-opt"><b>${escapeHtml(k)}</b>：${escapeHtml(v)}</div>`)
             .join("")}
         </div>`
      : "";

    const tips = Array.isArray(exp.exam_tips) && exp.exam_tips.length
      ? `<div class="exp-sec">
           <div class="exp-title">延伸考點</div>
           <ul class="exp-list">
             ${exp.exam_tips.map(t => `<li>${escapeHtml(t)}</li>`).join("")}
           </ul>
         </div>`
      : "";

    const fallback = (!correct && !optionAnalysis && !tips)
      ? `<div class="exp-sec"><div class="exp-body">${escapeHtml(JSON.stringify(exp, null, 2))}</div></div>`
      : "";

    return `${correct}${optionAnalysis}${tips}${fallback}`;
  }

  // 其他型態（保底）
  return `<div class="exp-sec"><div class="exp-body">${escapeHtml(String(exp))}</div></div>`;
}

// ======================
// Pool / Random
// ======================
function buildPool() {
  const wrongMap = getWrongMap();
  const savedSet = getSavedSet();

  if (mode === "all") {
    pool = [...ALL];
  } else if (mode === "wrong") {
    pool = ALL.filter(q => wrongMap[q.id]);
  } else if (mode === "saved") {
    pool = ALL.filter(q => savedSet.has(q.id));
  }

  if ((mode === "wrong" || mode === "saved") && pool.length === 0) {
    const prev = mode;
    mode = "all";
    updateModeButtons();
    pool = [...ALL];
    setFeedback(`${prev === "wrong" ? "錯題池" : "收藏池"}目前是空的，已切回全題模式。`, "no");
  }

  updateProgress();
}

function pickRandom() {
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ======================
// Render
// ======================
function renderQuestion(q) {
  current = q;
  answered = false;

  $("qid").textContent = q.id;
  $("stem").textContent = q.stem;
  $("tags").textContent = Array.isArray(q.tags) ? q.tags.join(" · ") : "";

  const explainBox = $("explainBox");
  if (explainBox) explainBox.open = false;

  // ✅ 修正：explanation 可能是 object，不能用 textContent 直接塞
  const expEl = $("explanation");
  if (expEl) {
    expEl.innerHTML = renderExplanation(q.explanation);
  }

  const optWrap = $("options");
  optWrap.innerHTML = "";

  const keys = Object.keys(q.options);
  keys.forEach(k => {
    const btn = document.createElement("button");
    btn.className = "opt";
    btn.textContent = `${k}. ${q.options[k]}`;
    btn.onclick = () => onPick(k, btn);
    optWrap.appendChild(btn);
  });

  setFeedback("");
  updateSaveButton();
}

function revealAnswer() {
  if (!current) return;
  const correct = String(current.answer).trim();

  const buttons = Array.from($("options").querySelectorAll(".opt"));
  buttons.forEach(btn => {
    const letter = btn.textContent.split(".")[0].trim();
    if (letter === correct) btn.classList.add("correct");
  });

  // ✅ 自動打開詳解（按「顯示正解」也展開）
  const box = $("explainBox");
  if (box) {
    box.open = true;
    box.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// ======================
// Answer logic
// ======================
function onPick(choice, btn) {
  if (!current || answered) return;
  answered = true;

  const correct = String(current.answer).trim();
  const buttons = Array.from($("options").querySelectorAll(".opt"));

  buttons.forEach(b => b.disabled = true);

  if (String(choice).trim() === correct) {
    btn.classList.add("correct");
    setFeedback("✅ 正確", "ok");
  } else {
    btn.classList.add("wrong");
    buttons.forEach(b => {
      const letter = b.textContent.split(".")[0].trim();
      if (letter === correct) b.classList.add("correct");
    });
    setFeedback(`❌ 錯誤；正解是 ${correct}`, "bad");
    incWrong(current.id);
    updateProgress();
  }

  // ✅ 按完選項自動跳出詳解
  const box = $("explainBox");
  if (box) {
    box.open = true;
  }
}

// ======================
// Init / Events
// ======================
async function main() {
  try {
    const loadStatus = $("loadStatus");
    if (loadStatus) loadStatus.textContent = "載入中…";

    const merged = await loadFromManifest();
    ALL = merged;
    buildPool();

    // 顯示 A 的去重統計
    if (loadStatus) {
      const meta = merged._meta;
      if (meta) {
        const extra = meta.dupCount > 0
          ? `｜重複：${meta.dupCount}（例：${meta.dupIds.join(", ")}）`
          : "";
        loadStatus.textContent = `載入完成：${meta.totalIn} → ${meta.uniqueOut}${extra}`;
      } else {
        loadStatus.textContent = `載入完成：${ALL.length}`;
      }
    }

    const first = pickRandom();
    if (first) renderQuestion(first);
    updateModeButtons();
    updateProgress();

    // buttons
    $("btnNew")?.addEventListener("click", () => {
      buildPool();
      const q = pickRandom();
      if (q) renderQuestion(q);
    });

    $("btnToggleWrong")?.addEventListener("click", () => {
      mode = (mode === "wrong") ? "all" : "wrong";
      updateModeButtons();
      buildPool();
      const q = pickRandom();
      if (q) renderQuestion(q);
    });

    $("btnToggleSaved")?.addEventListener("click", () => {
      mode = (mode === "saved") ? "all" : "saved";
      updateModeButtons();
      buildPool();
      const q = pickRandom();
      if (q) renderQuestion(q);
    });

    $("btnSave")?.addEventListener("click", () => {
      if (!current) return;
      const nowSaved = toggleSaved(current.id);
      setFeedback(nowSaved ? "已收藏本題。" : "已取消收藏。", "no");
      updateSaveButton();
      if (mode === "saved") buildPool();
      updateProgress();
    });

    $("btnShowAnswer")?.addEventListener("click", () => {
      revealAnswer();
    });

    $("btnResetWrong")?.addEventListener("click", () => {
      clearWrong();
      setFeedback("已清除錯題紀錄。", "no");
      buildPool();
      updateProgress();
    });

    $("btnResetSaved")?.addEventListener("click", () => {
      localStorage.removeItem(SAVED_KEY);
      setFeedback("已清除收藏。", "no");
      buildPool();
      updateProgress();
      updateSaveButton();
    });

  } catch (err) {
    console.error(err);
    const loadStatus = $("loadStatus");
    if (loadStatus) loadStatus.textContent = "載入失敗";
    setFeedback(String(err?.message || err), "bad");
  }
}

main();
