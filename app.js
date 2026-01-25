// ==========================
// Imports
// ==========================
import { WORDS, WORD_META } from "./words.js";
import {
  computeSummary,
  computeSessionFeatures,
  summaryToCSVRow,
  downloadCSV,
  flattenFeaturesForAuth,
  authFeaturesToCSVRow
} from "./analysis.js";
// ==========================
// Utilities
// ==========================
const nowMs = () => performance.now();
const rand = (n) => Math.floor(Math.random() * n);

const makeId = () => {
  // Prefer modern UUID when available
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().replace(/-/g, "");

  // Fallback: RFC4122-ish using getRandomValues if available
  const cryptoObj = globalThis.crypto || globalThis.msCrypto;
  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoObj.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant
    return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
  }

  // Last resort fallback (still fine for your use)
  return (Date.now().toString(16) + Math.random().toString(16).slice(2)).replace(".", "");
};


// ==========================
// DOM helpers
// ==========================
const el = (id) => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing DOM element id="${id}"`);
  return node;
};

const setScreen = (id) => {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id)?.classList.add("active");
};

// ==========================
// Global state
// ==========================
let session = null;
let lastEventMs = null;

// timers / intervals
let typingEndTimeout = null;
let typingTickInterval = null;
let tappingEndTimeout = null;
let tappingTickInterval = null;

// typing state
let typingRoundStartMs = null;
let firstKeyLogged = false;
let keyIndexInWord = 0;
let currentWord = null;

let lastKeyDownMs = null;
let iktSumMs = 0;
let iktCount = 0;
let wordDiffSum = 0;
let submitLocked = false;

// tapping state
let tapStimulusMs = null;
let rtSum = 0;

// ==========================
// Session helpers
// ==========================
function newSession() {
  const count = Number(localStorage.getItem("sessionCount") || 0) + 1;
  localStorage.setItem("sessionCount", String(count));

  return {
    schemaVersion: 1,
    sessionId: makeId(),
    sessionIndex: count,
    participantId: localStorage.getItem("participantId"),
    displayName: localStorage.getItem("displayName"),
    createdAtClientISO: new Date().toISOString(),
    context: {},
    device: {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      screen: { w: screen.width, h: screen.height, dpr: window.devicePixelRatio },
      timezoneOffsetMin: new Date().getTimezoneOffset()
    },
    rounds: {
      typing: {
        score: 0,
        attempts: 0,
        correct: 0,
        keyCount: 0,
        backspaces: 0,
        iktCount: 0,
        meanIktMs: null,
        meanWordDiff: null,
        reactionMs: null
      },
      tapping: {
        score: 0,
        hits: 0,
        misses: 0,
        rtCount: 0,
        meanRtMs: null
      }
    },
    events: []
  };
}

// ==========================
// Event logger (core)
// ==========================
function logEvent(type, payload = {}) {
  if (!session) return;
  const ms = Math.round(nowMs());
  const dt = lastEventMs === null ? null : ms - lastEventMs;
  lastEventMs = ms;

  session.events.push({
    t: type,
    ms,
    dt,
    tISO: new Date().toISOString(),
    ...payload
  });
}

// ==========================
// UI refs
// ==========================
const UI = {
  // consent
  consentCheckbox: () => el("consentCheckbox"),
  btnConsentNext: () => el("btnConsentNext"),

  // id
  participantIdInput: () => el("participantIdInput"),
  btnIdNext: () => el("btnIdNext"),

  // context
  fatigue: () => el("fatigue"),
  fatigueVal: () => el("fatigueVal"),
  inputDevice: () => el("inputDevice"),
  vibration: () => el("vibration"),
  alcohol: () => el("alcohol"),
  btnContextNext: () => el("btnContextNext"),

  // typing
  typingTime: () => el("typingTime"),
  typingScore: () => el("typingScore"),
  typingAttempts: () => el("typingAttempts"),
  typingAccuracy: () => el("typingAccuracy"),
  wordPrompt: () => el("wordPrompt"),
  wordInput: () => el("wordInput"),
  btnSubmitWord: () => el("btnSubmitWord"),

  // tapping
  tapTime: () => el("tapTime"),
  tapHits: () => el("tapHits"),
  tapMisses: () => el("tapMisses"),
  tapAccuracy: () => el("tapAccuracy"),
  tapTarget: () => el("tapTarget"),

  // results
  resTyping: () => el("resTyping"),
  resTypingAcc: () => el("resTypingAcc"),
  resTap: () => el("resTap"),
  resTapAcc: () => el("resTapAcc"),
  resTotal: () => el("resTotal"),
  uploadStatus: () => el("uploadStatus"),
  btnViewLeaderboard: () => el("btnViewLeaderboard"),
  btnRestart: () => el("btnRestart"),

  // leaderboard
  leaderboardList: () => el("leaderboardList"),
  btnBackToResultsFromLeaderboard: () => el("btnBackToResultsFromLeaderboard"),

  // data
  btnViewData: () => el("btnViewData"),
  btnDownloadCSV: () => el("btnDownloadCSV"),
  btnBackToResultsFromData: () => el("btnBackToResultsFromData"),
  dataSummary: () => el("dataSummary")
};

// ==========================
// Init / Bindings
// ==========================
document.addEventListener("DOMContentLoaded", () => {
  // fatigue live label
  UI.fatigueVal().textContent = UI.fatigue().value;
  UI.fatigue().addEventListener("input", () => {
    UI.fatigueVal().textContent = UI.fatigue().value;
  });

  bindConsent();
  bindParticipantId();
  bindContext();
  bindTypingUI();
  bindResultsUI();
  bindLeaderboardUI();
  bindDataUI();
});

// ==========================
// Consent
// ==========================
function bindConsent() {
  const cb = UI.consentCheckbox();
  const btn = UI.btnConsentNext();
  btn.disabled = !cb.checked;

  cb.addEventListener("change", () => {
    btn.disabled = !cb.checked;
  });

  btn.addEventListener("click", () => {
    setScreen("screen-id");
  });
}

// ==========================
// Participant ID
// ==========================
function bindParticipantId() {
  UI.btnIdNext().addEventListener("click", () => {
    const pid = UI.participantIdInput().value.trim();
    if (!pid) return alert("Enter an ID");

    localStorage.setItem("participantId", pid);

    if (!localStorage.getItem("displayName")) {
      localStorage.setItem(
        "displayName",
        ["Blue", "Green", "Red", "Gold", "Swift", "Raven", "Fox", "Wolf"][rand(8)] + "-" + rand(100)
      );
    }

    setScreen("screen-context");
  });
}

// ==========================
// Context
// ==========================
let selectedTime = null;

function bindContext() {
  document.querySelectorAll("[data-time]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-time]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      selectedTime = btn.dataset.time;
    });
  });

  UI.btnContextNext().addEventListener("click", () => {
    if (!selectedTime) return alert("Pick a time of day");

    // start fresh session
    session = newSession();
    lastEventMs = null;

    session.context = {
      timeBucket: selectedTime,
      fatigue: Number(UI.fatigue().value),
      inputDevice: UI.inputDevice().value,
      vibration: UI.vibration().value,
      alcohol: UI.alcohol().value
    };

    logEvent("session_start", session.context);

    // reset UI counters
    UI.typingScore().textContent = "0";
    UI.typingAttempts().textContent = "0";
    UI.tapHits().textContent = "0";
    UI.tapMisses().textContent = "0";
    UI.tapAccuracy().textContent = "0%";
    UI.uploadStatus().textContent = "";

    startTypingRound();
  });
}

// ==========================
// Typing game
// ==========================
function bindTypingUI() {
  UI.btnSubmitWord().addEventListener("click", () => submitWord("button"));

  UI.wordInput().addEventListener("keydown", (e) => {
    if (!session) return;

    const ignore = ["Shift", "Alt", "Meta", "Control", "CapsLock", "Tab"];
    if (ignore.includes(e.key)) return;

    const t = nowMs();

    if (!firstKeyLogged) {
      const rt = Math.round(t - typingRoundStartMs);
      session.rounds.typing.reactionMs = rt;
      logEvent("typing_reaction", { rt });
      firstKeyLogged = true;
    }

    // IKT = delta between keydowns (clip long pauses)
    if (lastKeyDownMs != null) {
      const ikt = t - lastKeyDownMs;
      const clipped = Math.min(ikt, 2000);
      iktSumMs += clipped;
      iktCount += 1;
    }
    lastKeyDownMs = t;

    keyIndexInWord += 1;
    session.rounds.typing.keyCount += 1;

    if (e.key === "Backspace") session.rounds.typing.backspaces += 1;

    logEvent("key", {
      k: e.key === "Backspace" ? "B" : e.key === "Enter" ? "E" : "K",
      pos: keyIndexInWord
    });

    if (e.key === "Enter") {
      e.preventDefault();
      submitWord("enter");
    }
  });

  // Optional: log input-type events to capture autocorrect/IME behaviour (no raw text)
  UI.wordInput().addEventListener("beforeinput", (e) => {
    if (!session) return;
    logEvent("before_input", { inputType: e.inputType });
  });

  UI.wordInput().addEventListener("compositionstart", () => {
    if (!session) return;
    logEvent("composition_start");
  });

  UI.wordInput().addEventListener("compositionend", () => {
    if (!session) return;
    logEvent("composition_end");
  });
}

function startTypingRound() {
  clearTimers();

  setScreen("screen-typing");

  typingRoundStartMs = nowMs();
  firstKeyLogged = false;
  keyIndexInWord = 0;
  lastKeyDownMs = null;

  iktSumMs = 0;
  iktCount = 0;
  wordDiffSum = 0;

  // timer display
  UI.typingTime().textContent = "60.0";

  nextWord();
  setTimeout(() => UI.wordInput().focus(), 50);

  // tick display 10 Hz
  typingTickInterval = setInterval(() => {
    const left = Math.max(0, 60000 - (nowMs() - typingRoundStartMs));
    UI.typingTime().textContent = (left / 1000).toFixed(1);
  }, 100);

  // end after 60s
  typingEndTimeout = setTimeout(endTypingRound, 60000);
}

function nextWord() {
  const idx = rand(WORDS.length);
  const w = WORDS[idx];
  const text = typeof w === "string" ? w : (w.word ?? w.text ?? w.value ?? "");
  currentWord = { word: text, id: idx, len: text.length };

  UI.wordPrompt().textContent = currentWord.word;
  UI.wordInput().value = "";
  keyIndexInWord = 0;
  lastKeyDownMs = null;

  logEvent("word_shown", { wordId: currentWord.id, wordLen: currentWord.len });
}

function submitWord(reason) {
  if (!session || !currentWord) return;
  if (submitLocked) return;

  submitLocked = true;
  try {
    const typed = UI.wordInput().value;
    const target = currentWord.word;

    const norm = (s) => s.trim().toLowerCase();
    const ok = norm(typed) === norm(target) ? 1 : 0;

    const inputLen = typed.length;
    const diff = WORD_META[currentWord.id]?.difficulty ?? 1;

    const inc = ok ? 1 : -1;
    session.rounds.typing.score = Math.max(0, session.rounds.typing.score + inc);

    session.rounds.typing.attempts += 1;
    if (ok) session.rounds.typing.correct += 1;

    const acc =
      session.rounds.typing.attempts > 0
        ? Math.round(
            (session.rounds.typing.correct / session.rounds.typing.attempts) * 100
          )
        : 0;

    session.rounds.typing.accuracyPct = acc;

    wordDiffSum += diff;

    UI.typingScore().textContent = String(session.rounds.typing.score);
    UI.typingAttempts().textContent = String(session.rounds.typing.attempts);
    UI.typingAccuracy().textContent = `${acc}%`;

    logEvent("typing_submit", {
      wordId: currentWord.id,
      wordLen: currentWord.len,
      inLen: inputLen,
      ok,
      wordDiff: diff,
      reason,
      scoreInc: inc
    });

    if (ok) {
      nextWord();
    } else {
      UI.wordInput().focus();
    }
  } finally {
    // always unlock (next tick)
    setTimeout(() => { submitLocked = false; }, 0);
  }
}

function endTypingRound() {
  clearInterval(typingTickInterval);
  clearTimeout(typingEndTimeout);

  logEvent("typing_end", { elapsedMs: Math.round(nowMs() - typingRoundStartMs) });

  startTappingRound();
}

// ==========================
// Tapping game
// ==========================
let tappingRoundStartMs = null;

function startTappingRound() {
  setScreen("screen-tapping");

  tappingRoundStartMs = nowMs();
  rtSum = 0;

  UI.tapTime().textContent = "60.0";

  // target starts visible + positioned
  moveTarget();

  // IMPORTANT: miss listener in bubble phase so stopPropagation on hit works
  UI.tapTarget().addEventListener("pointerdown", onHit);
  document.addEventListener("pointerdown", onMiss);

  tappingTickInterval = setInterval(() => {
    const left = Math.max(0, 60000 - (nowMs() - tappingRoundStartMs));
    UI.tapTime().textContent = (left / 1000).toFixed(1);
  }, 100);

  tappingEndTimeout = setTimeout(endTappingRound, 60000);
}

function moveTarget() {
  // If your CSS positions within arena, % is fine
  const x = rand(80);
  const y = rand(80);
  const tgt = UI.tapTarget();
  tgt.style.left = `${x}%`;
  tgt.style.top = `${y}%`;

  tapStimulusMs = nowMs();
  logEvent("target_move", { xPct: x, yPct: y });
}

function onHit(e) {
  e.stopPropagation();

  const rt = Math.round(nowMs() - tapStimulusMs);
  rtSum += rt;

  session.rounds.tapping.hits += 1;
  session.rounds.tapping.rtCount += 1;

  session.rounds.tapping.score = computeTapScore(session.rounds.tapping);

  UI.tapHits().textContent = String(session.rounds.tapping.hits);
  updateTapAccuracy();

  logEvent("tap_hit", {
    rt,
    x: Math.round(e.clientX),
    y: Math.round(e.clientY)
  });

  moveTarget();
}

function onMiss(e) {
  // ignore taps that are actually on the target
  if (e.target === UI.tapTarget()) return;

  session.rounds.tapping.misses += 1;
  session.rounds.tapping.score = computeTapScore(session.rounds.tapping);
  UI.tapMisses().textContent = String(session.rounds.tapping.misses);
  updateTapAccuracy();

  logEvent("tap_miss", {
    x: Math.round(e.clientX),
    y: Math.round(e.clientY)
  });
}

function updateTapAccuracy() {
  const tap = session.rounds.tapping;
  const total = tap.hits + tap.misses;
  const acc = total > 0 ? Math.round((tap.hits / total) * 100) : 0;
  tap.accuracyPct = acc;
  UI.tapAccuracy().textContent = `${acc}%`;
}

function endTappingRound() {
  clearInterval(tappingTickInterval);
  clearTimeout(tappingEndTimeout);

  UI.tapTarget().removeEventListener("pointerdown", onHit);
  document.removeEventListener("pointerdown", onMiss);

  session.rounds.tapping.score = computeTapScore(session.rounds.tapping);

  logEvent("tapping_end");

  showResults();
}

// ==========================
// Results + navigation
// ==========================
function bindResultsUI() {
  UI.btnRestart().addEventListener("click", () => {
    // keep participantId, new context answers next run (or you can skip context if you want)
    setScreen("screen-context");
  });

  UI.btnViewData().addEventListener("click", () => {
    if (!session) return;
    renderSessionReport(UI.dataSummary(), session);
    setScreen("screen-data");
  });
}

function bindLeaderboardUI() {
  UI.btnBackToResultsFromLeaderboard().addEventListener("click", () => {
    setScreen("screen-results");
  });
}

function bindDataUI() {
  // View Data (Results -> Data)
  UI.btnViewData().addEventListener("click", () => {
    if (!session) return;

    renderSessionReport(UI.dataSummary(), session);
    setScreen("screen-data");
  });

  // Back (Data -> Results)
  UI.btnBackToResultsFromData().addEventListener("click", () => {
    setScreen("screen-results");
  });

  // Download CSV (1-row session summary)
  UI.btnDownloadCSV().addEventListener("click", () => {
    if (!session) return;

    // ---- Existing summary (keep if you want both)
    const summary = computeSummary(session);

    // ---- NEW: authentication features
    const features = computeSessionFeatures(session);
    const flatAuth = flattenFeaturesForAuth(summary, features);
    const authCSV = authFeaturesToCSVRow(flatAuth);

    // ---- Download auth-ready feature vector
    downloadCSV(
      "auth_features.csv",
      authCSV.header,
      authCSV.row
    );
  });
}

function computeTapScore(tap) {
  return Math.max(0, tap.hits - tap.misses);
}

function showResults() {
  // final aggregates
  const t = session.rounds.typing;
  const tap = session.rounds.tapping;

  t.iktCount = iktCount;
  t.meanIktMs = iktCount ? Math.round(iktSumMs / iktCount) : null;
  t.meanWordDiff = t.attempts ? Number((wordDiffSum / t.attempts).toFixed(3)) : null;

  tap.meanRtMs = tap.rtCount ? Math.round(rtSum / tap.rtCount) : null;

  const total = (t.score || 0) + (tap.score || 0);

  UI.resTyping().textContent = String(t.score || 0);
  UI.resTap().textContent = String(tap.score || 0);
  UI.resTotal().textContent = String(total);

  const typingAcc = t.attempts
    ? Math.round((t.correct / t.attempts) * 100)
    : 0;

  const tapTotal = (tap.hits || 0) + (tap.misses || 0);
  const tapAcc = tapTotal
    ? Math.round((tap.hits / tapTotal) * 100)
    : 0;

  t.accuracyPct = typingAcc;
  tap.accuracyPct = tapAcc;

  UI.resTypingAcc().textContent = String(typingAcc);
  UI.resTapAcc().textContent = String(tapAcc);

  UI.uploadStatus().textContent = "Session saved locally (Firebase upload disabled).";

  setScreen("screen-results");

  console.log("SESSION_PAYLOAD", session);
}

// ==========================
// Cleanup
// ==========================
function renderDataSummary(s) {
  const t = s.rounds.typing;
  const tap = s.rounds.tapping;

  const typingAcc =
    t.attempts ? Math.round((t.correct / t.attempts) * 100) : 0;

  const tapTotal = (tap.hits || 0) + (tap.misses || 0);
  const tapAcc =
    tapTotal ? Math.round(((tap.hits || 0) / tapTotal) * 100) : 0;

  return `
    <div class="card">
      <h3>Session</h3>
      <p><strong>sessionId:</strong> ${s.sessionId}</p>
      <p><strong>participantId:</strong> ${s.participantId}</p>
      <p><strong>createdAt:</strong> ${s.createdAtClientISO}</p>
    </div>

    <div class="card">
      <h3>Typing</h3>
      <p><strong>score:</strong> ${t.score}</p>
      <p><strong>attempts:</strong> ${t.attempts}</p>
      <p><strong>correct:</strong> ${t.correct}</p>
      <p><strong>accuracy:</strong> ${typingAcc}%</p>
      <p><strong>meanIktMs:</strong> ${t.meanIktMs ?? "—"}</p>
      <p><strong>reactionMs:</strong> ${t.reactionMs ?? "—"}</p>
    </div>

    <div class="card">
      <h3>Tapping</h3>
      <p><strong>score:</strong> ${tap.score}</p>
      <p><strong>hits:</strong> ${tap.hits}</p>
      <p><strong>misses:</strong> ${tap.misses}</p>
      <p><strong>accuracy:</strong> ${tapAcc}%</p>
      <p><strong>meanRtMs:</strong> ${tap.meanRtMs ?? "—"}</p>
    </div>

    <div class="card">
      <h3>Events</h3>
      <p><strong>event count:</strong> ${s.events.length}</p>
    </div>
  `;
}

function downloadSessionCSV(s) {
  // Simple “events.csv” export (1 row per event)
  // This is the most useful format for modelling later.
  const rows = [];
  const header = Object.keys(s.events[0] || { t: "", ms: "", dt: "", tISO: "" });
  rows.push(header);

  for (const ev of s.events) {
    // Ensure stable columns (fill blanks if some keys missing)
    const allKeys = new Set(header);
    Object.keys(ev).forEach(k => allKeys.add(k));

    // If new keys appeared, expand header + backfill old rows
    if (allKeys.size !== header.length) {
      const newHeader = Array.from(allKeys);
      // backfill previous rows to new header length
      const oldHeader = header.slice();
      header.length = 0;
      header.push(...newHeader);

      for (let i = 0; i < rows.length; i++) {
        const rowObj = {};
        oldHeader.forEach((k, idx) => rowObj[k] = rows[i][idx]);
        rows[i] = header.map(k => rowObj[k] ?? "");
      }
    }

    rows.push(
      header.map(k => csvCell(ev[k]))
    );
  }

  const csv = rows.map(r => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `session_${s.sessionId}_events.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // escape quotes + wrap if needed
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function clearTimers() {
  clearTimeout(typingEndTimeout);
  clearInterval(typingTickInterval);
  clearTimeout(tappingEndTimeout);
  clearInterval(tappingTickInterval);
  typingEndTimeout = null;
  typingTickInterval = null;
  tappingEndTimeout = null;
  tappingTickInterval = null;
}

window._UI = UI;
window._session = () => session;