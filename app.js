const STORE_KEY = "medquiz_wrong_v1";

let ALL = [];
let pool = [];
let current = null;
let answered = false;
let wrongOnly = false;

function getWrongMap() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); }
  catch { return {}; }
}
function setWrongMap(map) { localStorage.setItem(STORE_KEY, JSON.stringify(map)); }
function incWrong(id) {
  const m = getWrongMap();
  m[id] = (m[id] || 0) + 1;
  setWrongMap(m);
}
function clearWrong() { localStorage.removeItem(STORE_KEY); }

function normalizeQuestions(data, sourceId = "UNKNOWN") {
  if (!Array.isArray(data)) throw new Error(`[${sourceId}] 題庫必須是陣列`);
  data.forEach((q, i) => {
    if (!q.id || !q.stem || !q.options || !q.answer) {
      throw new Error(`[${sourceId}] 第 ${i+1} 題缺少必要欄位（id/stem/options/answer）`);
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
  const manifestUrl = `./data/manifest.json?v=${Date.now()}`;
  const manifest = await fetchJson(manifestUrl);

  if (!manifest || !Array.isArray(manifest.sources)) {
    throw new Error("manifest.json 格式錯誤：缺 sources[]");
  }

  const enabled = manifest.sources.filter(s => s.enabled);
  if (enabled.length === 0) return [];

  const merged = [];
  const idSet = new Set();

  for (const src of enabled) {
    const path = `${src.path}?v=${Date.now()}`;
    const data = await fetchJson(path);
    const qs = normalizeQuestions(data, src.id);

    for (const q of qs) {
      if (idSet.has(q.id)) continue; // 去重：同 id 只保留第一個
      idSet.add(q.id);
      merged.push(q);
    }
  }
  return merged;
}

function buildPool() {
  const wrongMap = getWrongMap();
  if (!wrongOnly) {
    pool = [...ALL];
  } else {
    pool = ALL.filter(q => wrongMap[q.id]);
  }
  if (wrongOnly && pool.length === 0) {
    wrongOnly = false;
    document.getElementById("btnToggleWrong").textContent = "錯題模式：關";
    pool = [...ALL];
    setFeedback("錯題池目前是空的，已切回全題模式。", "no");
  }
}

function pickRandom() {
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function setFeedback(msg, type = "") {
  const el = document.getElementById("feedback");
  el.className = "feedback" + (type ? ` ${type}` : "");
  el.textContent = msg || "";
}

function renderQuestion(q) {
  current = q;
  answered = false;

  document.getElementById("qid").textContent = q.id;
  document.getElementById("stem").textContent = q.stem;
  document.getElementById("tags").textContent = Array.isArray(q.tags) ? q.tags.join(" · ") : "";
  document.getElementById("explainBox").open = false;
  document.getElementById("explanation").textContent = q.explanation || "";

  const optWrap = document.getElementById("options");
  optWrap.innerHTML = "";

  q.options.forEach(opt => {
    const div = document.createElement("div");
    div.className = "opt";
    div.dataset.key = opt.key;

    const key = document.createElement("span");
    key.className = "key";
    key.textContent = opt.key;

    const txt = document.createElement("span");
    txt.textContent = opt.text;

    div.appendChild(key);
    div.appendChild(txt);
    div.addEventListener("click", () => onChoose(opt.key));
    optWrap.appendChild(div);
  });

  updateMeta();
  setFeedback("", "");
}

function lockOptionsAndReveal(correctKey, chosenKey = null) {
  const nodes = [...document.querySelectorAll(".opt")];
  nodes.forEach(n => {
    n.classList.add("disabled");
    const k = n.dataset.key;
    if (k === correctKey) n.classList.add("correct");
    if (chosenKey && k === chosenKey && chosenKey !== correctKey) n.classList.add("wrong");
    n.style.pointerEvents = "none";
  });
}

function onChoose(key) {
  if (!current || answered) return;
  answered = true;

  const correct = current.answer;
  if (key === correct) {
    setFeedback("✅ 正確", "ok");
  } else {
    setFeedback(`❌ 錯誤。正確答案是 ${correct}`, "no");
    incWrong(current.id);
  }
  lockOptionsAndReveal(correct, key);
  document.getElementById("explainBox").open = true;
  updateMeta();
}

function revealAnswer() {
  if (!current) return;
  if (!answered) {
    answered = true;
    setFeedback(`正確答案是 ${current.answer}`, "no");
    lockOptionsAndReveal(current.answer, null);
    document.getElementById("explainBox").open = true;
    updateMeta();
  }
}

function updateMeta() {
  const wrongMap = getWrongMap();
  const wrongCount = Object.keys(wrongMap).length;
  const total = ALL.length;
  const mode = wrongOnly ? `錯題模式（池：${pool.length}）` : "全題模式";
  document.getElementById("progress").textContent = `總題數 ${total}｜錯題 ${wrongCount}｜${mode}`;
}

function nextQuestion() {
  buildPool();
  const q = pickRandom();
  if (!q) {
    setFeedback("題庫是空的或錯題池為空。", "no");
    return;
  }
  renderQuestion(q);
}

function toggleWrongMode() {
  wrongOnly = !wrongOnly;
  document.getElementById("btnToggleWrong").textContent = wrongOnly ? "錯題模式：開" : "錯題模式：關";
  nextQuestion();
}

async function main() {
  const status = document.getElementById("loadStatus");
  try {
    ALL = await loadFromManifest();
    status.textContent = `載入成功：${ALL.length} 題（manifest）`;
    buildPool();
    nextQuestion();
  } catch (e) {
    status.textContent = `載入失敗：${e.message}`;
    setFeedback("請檢查 data/manifest.json、各 source path 與 JSON 格式。", "no");
  }

  document.getElementById("btnNew").addEventListener("click", nextQuestion);
  document.getElementById("btnToggleWrong").addEventListener("click", toggleWrongMode);
  document.getElementById("btnShowAnswer").addEventListener("click", revealAnswer);
  document.getElementById("btnResetWrong").addEventListener("click", () => {
    clearWrong();
    setFeedback("已清除錯題紀錄。", "ok");
    updateMeta();
    if (wrongOnly) nextQuestion();
  });
}

main();
