// ==========================
// Imports
// ==========================
import {
  auth, signInAnonymously,
  db, doc, getDoc, setDoc, serverTimestamp,
  collection, addDoc,
  storage, ref, uploadBytes
} from "./firebase.js";

import { WORDS, WORD_META } from "./words.js";
import {
  computeSummary,
  computeSessionFeatures,
  downloadCSV,
  flattenFeaturesForAuth,
  authFeaturesToCSVRow,
  generateWindows,
  renderSessionReport
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
let tappingListenersAttached = false;

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
// Participant ID Generator
// ==========================
function makeParticipantId() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "p";
  for (let i = 0; i < 6; i++) {
    s += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return s;
}

// Identity Bootstrap Logic
async function ensureIdentity() {
  await signInAnonymously(auth);

  const uid = auth.currentUser.uid;
  const refUser = doc(db, "participants", uid);
  const snap = await getDoc(refUser);

  let participantId;

  if (snap.exists()) {
    participantId = snap.data().participantId;
  } else {
    participantId = makeParticipantId();
    await setDoc(refUser, {
      participantId,
      createdAt: serverTimestamp()
    });
  }

  localStorage.setItem("participantId", participantId);
  return { uid: auth.currentUser?.uid ?? null, participantId };
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
  pidDisplay: () => el("pidDisplay"),
  btnCopyPid: () => el("btnCopyPid"),
  sessionCountDisplay: () => el("sessionCountDisplay"),
  btnViewLeaderboard: () => el("btnViewLeaderboard"),
  btnRestart: () => el("btnRestart"),


  // leaderboard
  leaderboardList: () => el("leaderboardList"),
  btnBackToResultsFromLeaderboard: () => el("btnBackToResultsFromLeaderboard"),

  // data
  btnViewData: () => el("btnViewData"),
  btnDownloadCSV: () => el("btnDownloadCSV"),
  btnDownloadEventsCSV: () => el("btnDownloadEventsCSV"),
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

  btn.addEventListener("click", async () => {
    try {
      UI.uploadStatus().textContent = ""; // just in case
      const { participantId } = await ensureIdentity();

      // Populate the ID input if the screen exists (but keep it read-only)
      UI.pidDisplay().value = participantId;

      // Skip ID screen (prevents identity fragmentation)
      setScreen("screen-context");
    } catch (e) {
      console.error(e);
      alert("Auth failed. Please refresh and try again.");
    }
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

  // Guard against accidental double-binding
  if (!tappingListenersAttached) {
    // IMPORTANT: miss listener in bubble phase so stopPropagation on hit works
    UI.tapTarget().addEventListener("pointerdown", onHit);
    document.addEventListener("pointerdown", onMiss);
    tappingListenersAttached = true;
  }

  tappingTickInterval = setInterval(() => {
    const left = Math.max(0, 60000 - (nowMs() - tappingRoundStartMs));
    UI.tapTime().textContent = (left / 1000).toFixed(1);
  }, 100);

  tappingEndTimeout = setTimeout(endTappingRound, 60000);
}

function moveTarget() {
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

  if (tappingListenersAttached) {
    UI.tapTarget().removeEventListener("pointerdown", onHit);
    document.removeEventListener("pointerdown", onMiss);
    tappingListenersAttached = false;
  }

  session.rounds.tapping.score = computeTapScore(session.rounds.tapping);

  logEvent("tapping_end");

  showResults();
}

// ==========================
// Results + navigation
// ==========================
function bindResultsUI() {
  UI.btnRestart().addEventListener("click", () => {
    setScreen("screen-context");
  });

  // Results -> Data
  UI.btnViewData().addEventListener("click", () => {
    if (!session) return;

    setScreen("screen-data");
    renderSessionReport(UI.dataSummary(), session);
  });

  UI.btnViewLeaderboard().addEventListener("click", () => {
    setScreen("screen-leaderboard");
  });

  UI.btnCopyPid().addEventListener("click", async () => {
    const pid = localStorage.getItem("participantId") || "";
    if (!pid) return;

    try {
      await navigator.clipboard.writeText(pid);
      UI.btnCopyPid().textContent = "Copied ✅";
      setTimeout(() => (UI.btnCopyPid().textContent = "Copy ID"), 1200);
    } catch {
      // fallback if clipboard blocked
      UI.pidDisplay().focus();
      UI.pidDisplay().select();
      alert("Copy not permitted in this browser. Please copy manually.");
    }
  });
}

function bindLeaderboardUI() {
  UI.btnBackToResultsFromLeaderboard().addEventListener("click", () => {
    setScreen("screen-results");
  });
}

function bindDataUI() {
  UI.btnBackToResultsFromData().addEventListener("click", () => {
    setScreen("screen-results");
  });

  // Download model CSV (windows)
  UI.btnDownloadCSV().addEventListener("click", () => {
    if (!session) return;

    const summary = computeSummary(session);
    const authCsv = buildAuthWindowsCSV(session);

    if (!authCsv) {
      alert("No window rows to export yet.");
      return;
    }

    // downloadCSV wants: filename, headerLine, rowString(s)
    const [header, ...rowLines] = authCsv.trimEnd().split("\n");
    downloadCSV(
      `auth_windows_${summary.sessionId}.csv`,
      header,
      rowLines.join("\n")
    );
  });

  // Download events CSV
  UI.btnDownloadEventsCSV().addEventListener("click", () => {
    if (!session) return;

    const eventsCsv = buildEventsCSV(session);
    if (!eventsCsv) {
      alert("No events to export.");
      return;
    }

    const [header, ...rowLines] = eventsCsv.trimEnd().split("\n");
    downloadCSV(
      `events_${session.sessionId}.csv`,
      header,
      rowLines.join("\n")
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

  const typingAcc = t.attempts ? Math.round((t.correct / t.attempts) * 100) : 0;

  const tapTotal = (tap.hits || 0) + (tap.misses || 0);
  const tapAcc = tapTotal ? Math.round((tap.hits / tapTotal) * 100) : 0;

  t.accuracyPct = typingAcc;
  tap.accuracyPct = tapAcc;

  UI.resTypingAcc().textContent = String(typingAcc);
  UI.resTapAcc().textContent = String(tapAcc);

  setScreen("screen-results");

  // Populate ID + session count for participant UX
  UI.pidDisplay().value = localStorage.getItem("participantId") || "";
  UI.sessionCountDisplay().textContent = String(
    Number(localStorage.getItem("sessionCount") || 0)
  );

  // Auto-upload to Firebase
  UI.uploadStatus().textContent = "Uploading…";
  uploadSessionToFirebase(session)
    .then(() => {
      UI.uploadStatus().textContent = "Uploaded ✅ Thanks — play again later on the same device.";
    })
    .catch((e) => {
      console.error(e);
      UI.uploadStatus().textContent = "Upload failed — please download the CSVs below.";
    });

  console.log("SESSION_PAYLOAD", session);
}

// ==========================
// Cleanup helpers
// ==========================
function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
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

// ==========================
// Firebase upload helpers
// ==========================
function csvBlob(text) {
  return new Blob([text], { type: "text/csv;charset=utf-8;" });
}

function buildAuthWindowsCSV(s) {
  const summary = computeSummary(s);
  const windows = generateWindows(s.events, 30000, 15000); // 30s, 50% overlap

  let header = null;
  const rows = [];

  windows.forEach(w => {
    const features = computeSessionFeatures(s, w);
    const flatAuth = flattenFeaturesForAuth(summary, features);
    if (!flatAuth) return;

    flatAuth.windowIndex = w.windowIndex;
    flatAuth.windowStartMs = w.startMs;
    flatAuth.windowEndMs = w.endMs;

    const authCSV = authFeaturesToCSVRow(flatAuth);
    if (!header) header = authCSV.header;
    rows.push(authCSV.row);
  });

  if (!header || rows.length === 0) return null;
  return header + "\n" + rows.join("\n") + "\n";
}

function buildEventsCSV(s) {
  const events = Array.isArray(s?.events) ? s.events : [];
  if (!events.length) return null;

  const keys = new Set();
  for (const ev of events) Object.keys(ev || {}).forEach(k => keys.add(k));

  const core = ["t", "ms", "dt", "tISO"];
  core.forEach(k => keys.delete(k));
  keys.delete("sessionId");
  keys.delete("participantId");

  const header = ["sessionId", "participantId", ...core, ...Array.from(keys).sort()];

  const rows = events.map(ev => {
    const rowObj = {
      sessionId: (s.sessionId ?? ""),
      participantId: (s.participantId ?? ""),
      ...(ev || {})
    };
    return header.map(k => csvCell(rowObj[k])).join(",");
  });

  return header.join(",") + "\n" + rows.join("\n") + "\n";
}

async function uploadSessionToFirebase(s) {
  if (!auth.currentUser) throw new Error("Not signed in");

  const authCsv = buildAuthWindowsCSV(s);
  const eventsCsv = buildEventsCSV(s);

  if (!authCsv) throw new Error("No auth_windows rows to upload yet.");

  const base = `sessions/${s.sessionId}`;

  await uploadBytes(ref(storage, `${base}/auth_windows.csv`), csvBlob(authCsv));
  if (eventsCsv) {
    await uploadBytes(ref(storage, `${base}/events.csv`), csvBlob(eventsCsv));
  }

  await addDoc(collection(db, "sessions"), {
    sessionId: s.sessionId,
    uid: auth.currentUser.uid,
    participantId: s.participantId ?? null,
    sessionIndex: s.sessionIndex ?? null,
    createdAt: serverTimestamp(),
    context: s.context ?? {},
    device: s.device ?? {},
    eventCount: (s.events || []).length,
    hasEventsCsv: Boolean(eventsCsv)
  });
}

// Debug hooks
window._UI = UI;
window._session = () => session;
