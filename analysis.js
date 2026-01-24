// analysis.js
// Single-session report + modelling features (NO aggregation)

export function computeSummary(session) {
  if (!session) return null;

  const t = session.rounds?.typing || {};
  const tap = session.rounds?.tapping || {};

  const typingAcc =
    t.attempts ? Math.round((t.correct / t.attempts) * 100) : 0;

  const tapTotal = (tap.hits || 0) + (tap.misses || 0);
  const tapAcc =
    tapTotal ? Math.round(((tap.hits || 0) / tapTotal) * 100) : 0;

  // tap score = hits - misses (clamp should be applied in app, but keep safe here)
  const tapScore = Math.max(0, (tap.hits || 0) - (tap.misses || 0));

  const typingScore = t.score ?? 0;
  const totalScore = (typingScore || 0) + (tapScore || 0);

  return {
    schemaVersion: session.schemaVersion ?? null,
    sessionId: session.sessionId ?? "",
    sessionIndex: session.sessionIndex ?? null,
    participantId: session.participantId ?? "",
    displayName: session.displayName ?? "",
    createdAtClientISO: session.createdAtClientISO ?? "",

    timeBucket: session.context?.timeBucket ?? "",
    fatigue: session.context?.fatigue ?? null,
    inputDevice: session.context?.inputDevice ?? "",
    vibration: session.context?.vibration ?? "",
    alcohol: session.context?.alcohol ?? "",

    typingScore,
    typingAttempts: t.attempts ?? 0,
    typingCorrect: t.correct ?? 0,
    typingAccuracyPct: typingAcc,
    typingMeanIktMs: t.meanIktMs ?? null,
    typingBackspaces: t.backspaces ?? 0,

    tapHits: tap.hits ?? 0,
    tapMisses: tap.misses ?? 0,
    tapScore,
    tapAccuracyPct: tapAcc,
    tapMeanRtMs: tap.meanRtMs ?? null,

    totalScore
  };
}

export function summaryToCSVRow(summary) {
  const cols = Object.keys(summary);
  const vals = cols.map((k) => csvEscape(summary[k]));
  return { header: cols.join(","), row: vals.join(",") };
}

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[,"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function downloadCSV(filename, header, row) {
  const csv = header + "\n" + row + "\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

export function renderSummaryTable(containerEl, summary) {
  if (!containerEl) return;
  containerEl.innerHTML = "";

  const table = document.createElement("table");
  table.style.width = "100%";
  table.style.borderCollapse = "collapse";

  for (const [k, v] of Object.entries(summary)) {
    const tr = document.createElement("tr");

    const tdK = document.createElement("td");
    tdK.textContent = k;
    tdK.style.padding = "8px";
    tdK.style.opacity = "0.8";
    tdK.style.borderBottom = "1px solid rgba(255,255,255,0.08)";

    const tdV = document.createElement("td");
    tdV.textContent = v === null ? "—" : String(v);
    tdV.style.padding = "8px";
    tdV.style.borderBottom = "1px solid rgba(255,255,255,0.08)";

    tr.appendChild(tdK);
    tr.appendChild(tdV);
    table.appendChild(tr);
  }

  containerEl.appendChild(table);
}

/* =========================================================
   NEW: Modelling features (single session)
   ========================================================= */

export function computeSessionFeatures(session) {
  if (!session) return null;

  const events = Array.isArray(session.events) ? session.events : [];
  const { typingWindow, tappingWindow } = inferWindows(events);

  // ---- Typing: IKTs from key events (k: K/B), and submit outcomes ----
  const typingKeyTimes = events
    .filter(e =>
      e?.t === "key" &&
      inWindow(e.ms, typingWindow) &&
      (e.k === "K" || e.k === "B")
    )
    .map(e => e.ms);

  const ikts = deltas(typingKeyTimes).map(x => Math.min(x, 2000)); // match app clipping

  const typingSubmits = events.filter(e => e?.t === "typing_submit" && inWindow(e.ms, typingWindow));
  const typingSubmitTimes = typingSubmits.map(e => e.ms);
  const typingOk = typingSubmits.map(e => Number(e.ok || 0));

  // Word difficulty sensitivity (single-session)
  const diffBuckets = bucketBy(typingSubmits, s => String(s.wordDiff ?? "na"));

  // ---- Tapping: RTs from tap_hit (rt exists), miss events for miss rate ----
  const tapHits = events.filter(e => e?.t === "tap_hit" && inWindow(e.ms, tappingWindow));
  const tapMisses = events.filter(e => e?.t === "tap_miss" && inWindow(e.ms, tappingWindow));
  const rts = tapHits.map(e => Number(e.rt)).filter(isFiniteNumber);

  // ---- Drift: thirds (early/mid/late) ----
  const typingThirds = thirdsStats({
    startMs: typingWindow?.startMs,
    endMs: typingWindow?.endMs,
    // use submit outcomes for accuracy per third
    submits: typingSubmits
  });

  const tappingThirds = thirdsStats({
    startMs: tappingWindow?.startMs,
    endMs: tappingWindow?.endMs,
    // use hit/miss for miss rate per third
    hits: tapHits,
    misses: tapMisses
  });

  // IKT by thirds: use key timestamps
  const iktThirds = thirdsFromSeries(typingKeyTimes, typingWindow);

  // RT by thirds: use tap_hit RTs + timestamps
  const rtThirds = thirdsFromTimedValues(
    tapHits.map(e => ({ ms: e.ms, v: Number(e.rt) })).filter(x => isFiniteNumber(x.v)),
    tappingWindow
  );

  // ---- Error recovery times ----
  const recoverTypingWrongToNextCorrectMs = recoveryTimes(
    typingSubmits.filter(s => Number(s.ok) === 0).map(s => s.ms),
    typingSubmits.filter(s => Number(s.ok) === 1).map(s => s.ms)
  );

  const recoverTapMissToNextHitMs = recoveryTimes(
    tapMisses.map(m => m.ms),
    tapHits.map(h => h.ms)
  );

  const recoverBackspaceToNextCorrectMs = recoveryTimes(
    events
      .filter(e => e?.t === "key" && inWindow(e.ms, typingWindow) && e.k === "B")
      .map(e => e.ms),
    typingSubmits.filter(s => Number(s.ok) === 1).map(s => s.ms)
  );

  // ---- Error clustering ----
  const typingErrorTimes = typingSubmits.filter(s => Number(s.ok) === 0).map(s => s.ms);
  const tapMissTimes = tapMisses.map(m => m.ms);

  const typingErrorGaps = deltas(typingErrorTimes);
  const tapMissGaps = deltas(tapMissTimes);

  // ---- Cross-task coupling (single session descriptors, not inference) ----
  const iktVar = variance(ikts);
  const rtVar = variance(rts);

  // ---- Outputs (keep primitive, CSV-friendly) ----
  return {
    windows: {
      typing: typingWindow,
      tapping: tappingWindow
    },

    typing: {
      ikt: seriesSummary(ikts),
      submits: {
        count: typingSubmits.length,
        ok: typingSubmits.reduce((a, s) => a + (Number(s.ok) === 1 ? 1 : 0), 0),
        accuracyPct: typingSubmits.length
          ? Math.round(100 * typingSubmits.reduce((a, s) => a + (Number(s.ok) === 1 ? 1 : 0), 0) / typingSubmits.length)
          : 0
      },
      drift: {
        accuracyEarly: typingThirds.accuracyEarly,
        accuracyLate: typingThirds.accuracyLate,
        accuracyDeltaEarlyLate: typingThirds.accuracyDeltaEarlyLate,

        iktMeanEarly: iktThirds.meanEarly,
        iktMeanLate: iktThirds.meanLate,
        iktDeltaEarlyLate: iktThirds.deltaEarlyLate
      },
      errorDynamics: {
        wrongToNextCorrect: seriesSummary(recoverTypingWrongToNextCorrectMs),
        backspaceToNextCorrect: seriesSummary(recoverBackspaceToNextCorrectMs),
        errorGapMs: seriesSummary(typingErrorGaps)
      },
      difficulty: {
        // per-difficulty counts + accuracy (single session)
        buckets: Object.fromEntries(Object.entries(diffBuckets).map(([k, arr]) => {
          const n = arr.length;
          const ok = arr.reduce((a, s) => a + (Number(s.ok) === 1 ? 1 : 0), 0);
          return [k, { n, ok, accPct: n ? Math.round(100 * ok / n) : 0 }];
        }))
      }
    },

    tapping: {
      rt: seriesSummary(rts),
      trials: {
        hits: tapHits.length,
        misses: tapMisses.length,
        total: tapHits.length + tapMisses.length,
        missRatePct: (tapHits.length + tapMisses.length)
          ? Math.round(100 * tapMisses.length / (tapHits.length + tapMisses.length))
          : 0
      },
      drift: {
        missRateEarlyPct: tappingThirds.missRateEarlyPct,
        missRateLatePct: tappingThirds.missRateLatePct,
        missRateDeltaEarlyLatePct: tappingThirds.missRateDeltaEarlyLatePct,

        rtMeanEarly: rtThirds.meanEarly,
        rtMeanLate: rtThirds.meanLate,
        rtDeltaEarlyLate: rtThirds.deltaEarlyLate
      },
      errorDynamics: {
        missToNextHit: seriesSummary(recoverTapMissToNextHitMs),
        missGapMs: seriesSummary(tapMissGaps)
      }
    },

    coupling: {
      iktVar,
      rtVar,
      // simple ratio descriptor (avoid pretending it's a correlation)
      varRatioRtToIkt: (iktVar > 0 && rtVar > 0) ? Number((rtVar / iktVar).toFixed(3)) : null
    },

    events: {
      total: events.length,
      counts: countBy(events, e => e.t)
    }
  };
}

export function computeSessionFlags(session, features) {
  if (!session || !features) return { valid: false, flags: ["NO_SESSION"] };

  const flags = [];

  const t = session.rounds?.typing || {};
  const tap = session.rounds?.tapping || {};

  const typingAttempts = Number(t.attempts || 0);
  const tapTrials = Number((tap.hits || 0) + (tap.misses || 0));

  // Completeness (must have both rounds)
  if (!features.windows?.typing?.startMs || !features.windows?.typing?.endMs) flags.push("INCOMPLETE_TYPING_WINDOW");
  if (!features.windows?.tapping?.startMs || !features.windows?.tapping?.endMs) flags.push("INCOMPLETE_TAPPING_WINDOW");

  // Minimum engagement
  if (typingAttempts < 10) flags.push("LOW_TYPING_ATTEMPTS");
  if (tapTrials < 30) flags.push("LOW_TAP_TRIALS");

  // Timing sanity
  const iktMean = features.typing?.ikt?.mean ?? null;
  if (iktMean !== null && iktMean < 80) flags.push("SUSPICIOUS_TYPING_IKT_TOO_FAST");
  if (iktMean !== null && iktMean > 1500) flags.push("SUSPICIOUS_TYPING_IKT_TOO_SLOW");

  const rtMean = features.tapping?.rt?.mean ?? null;
  if (rtMean !== null && rtMean < 120) flags.push("SUSPICIOUS_TAP_RT_TOO_FAST");

  // Miss rate sanity
  const missRate = features.tapping?.trials?.missRatePct ?? 0;
  if (missRate > 70) flags.push("VERY_HIGH_MISS_RATE");

  // Zero activity
  if (typingAttempts === 0) flags.push("ZERO_TYPING_ACTIVITY");
  if (tapTrials === 0) flags.push("ZERO_TAPPING_ACTIVITY");

  // “Hard” invalidation (keep simple for now)
  const hard = new Set([
    "NO_SESSION",
    "INCOMPLETE_TYPING_WINDOW",
    "INCOMPLETE_TAPPING_WINDOW",
    "ZERO_TYPING_ACTIVITY",
    "ZERO_TAPPING_ACTIVITY"
  ]);

  const valid = !flags.some(f => hard.has(f));
  return { valid, flags };
}

export function renderSessionReport(containerEl, session) {
  if (!containerEl) return;
  containerEl.innerHTML = "";

  const summary = computeSummary(session);
  const features = computeSessionFeatures(session);
  const { valid, flags } = computeSessionFlags(session, features);

  // Wrapper
  const wrap = document.createElement("div");

  // 1) Overview card
  wrap.appendChild(card("Session Overview", [
    `participantId: ${summary.participantId || "—"}`,
    `displayName: ${summary.displayName || "—"}`,
    `sessionId: ${summary.sessionId || "—"}`,
    `createdAt: ${summary.createdAtClientISO || "—"}`,
    `context: ${summary.timeBucket || "—"} • fatigue=${summary.fatigue ?? "—"} • ${summary.inputDevice || "—"} • vib=${summary.vibration || "—"} • alcohol=${summary.alcohol || "—"}`
  ]));

  // 2) Validity / flags
  wrap.appendChild(card(valid ? "Data Quality: VALID ✅" : "Data Quality: REVIEW ⚠️", [
    `flags: ${flags.length ? flags.join(", ") : "none"}`
  ]));

  // 3) Modelling features (high value)
  wrap.appendChild(card("Typing Features", [
    `attempts=${summary.typingAttempts}, accuracy=${summary.typingAccuracyPct}%`,
    `IKT mean=${fmtMs(features.typing.ikt.mean)}, std=${fmtMs(features.typing.ikt.std)}, IQR=${fmtMs(features.typing.ikt.iqr)}, CV=${fmt(features.typing.ikt.cv)}`,
    `drift: IKT Δ(early→late)=${fmtMs(features.typing.drift.iktDeltaEarlyLate)}, acc Δ(early→late)=${fmt(features.typing.drift.accuracyDeltaEarlyLate)}pp`,
    `error recovery: wrong→next correct (median)=${fmtMs(features.typing.errorDynamics.wrongToNextCorrect.median)}, backspace→next correct (median)=${fmtMs(features.typing.errorDynamics.backspaceToNextCorrect.median)}`,
    `error gaps: (median)=${fmtMs(features.typing.errorDynamics.errorGapMs.median)}`
  ]));

  wrap.appendChild(card("Tapping Features", [
    `trials=${features.tapping.trials.total} (hits=${features.tapping.trials.hits}, misses=${features.tapping.trials.misses}), missRate=${features.tapping.trials.missRatePct}%`,
    `RT mean=${fmtMs(features.tapping.rt.mean)}, std=${fmtMs(features.tapping.rt.std)}, IQR=${fmtMs(features.tapping.rt.iqr)}, CV=${fmt(features.tapping.rt.cv)}`,
    `drift: RT Δ(early→late)=${fmtMs(features.tapping.drift.rtDeltaEarlyLate)}, missRate Δ(early→late)=${fmt(features.tapping.drift.missRateDeltaEarlyLatePct)}pp`,
    `error recovery: miss→next hit (median)=${fmtMs(features.tapping.errorDynamics.missToNextHit.median)}`
  ]));

  wrap.appendChild(card("Cross-task Coupling (descriptive)", [
    `variance(IKT)=${fmt(features.coupling.iktVar)}, variance(RT)=${fmt(features.coupling.rtVar)}`,
    `varRatio RT/IKT=${features.coupling.varRatioRtToIkt ?? "—"}`
  ]));

  // 4) Event counts (debuggable, not a full dump)
  const topCounts = Object.entries(features.events.counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([k, v]) => `${k}: ${v}`);

  wrap.appendChild(card("Event Summary", [
    `total events=${features.events.total}`,
    topCounts.join(" • ")
  ]));

  // 5) Keep your human-readable table at the end (optional, but nice)
  const tableCard = document.createElement("div");
  tableCard.className = "card data-summary";
  const h = document.createElement("h3");
  h.textContent = "Raw Session Summary";
  tableCard.appendChild(h);

  const tableWrap = document.createElement("div");
  renderSummaryTable(tableWrap, summary);
  tableCard.appendChild(tableWrap);

  wrap.appendChild(tableCard);

  containerEl.appendChild(wrap);
}

/* =========================================================
   Helpers
   ========================================================= */

function inferWindows(events) {
  // typing window: first word_shown → typing_end
  const firstWord = events.find(e => e?.t === "word_shown");
  const typingEnd = lastOf(events, e => e?.t === "typing_end");
  const typingWindow = {
    startMs: firstWord?.ms ?? null,
    endMs: typingEnd?.ms ?? null
  };

  // tapping window: first target_move → tapping_end (or tap_end event name)
  const firstMove = events.find(e => e?.t === "target_move");
  const tappingEnd = lastOf(events, e => e?.t === "tapping_end");
  const tappingWindow = {
    startMs: firstMove?.ms ?? null,
    endMs: tappingEnd?.ms ?? null
  };

  return { typingWindow, tappingWindow };
}

function inWindow(ms, w) {
  if (!isFiniteNumber(ms) || !w?.startMs || !w?.endMs) return false;
  return ms >= w.startMs && ms <= w.endMs;
}

function deltas(times) {
  const out = [];
  for (let i = 1; i < times.length; i++) out.push(times[i] - times[i - 1]);
  return out;
}

function isFiniteNumber(x) {
  return typeof x === "number" && Number.isFinite(x);
}

function mean(xs) {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function variance(xs) {
  if (!xs.length) return null;
  const m = mean(xs);
  if (m === null) return null;
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return s / xs.length;
}

function std(xs) {
  const v = variance(xs);
  return v === null ? null : Math.sqrt(v);
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] === undefined) return sorted[base];
  return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function iqr(xs) {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const q1 = quantile(s, 0.25);
  const q3 = quantile(s, 0.75);
  if (q1 === null || q3 === null) return null;
  return q3 - q1;
}

function median(xs) {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  return quantile(s, 0.5);
}

function seriesSummary(xs) {
  if (!xs || !xs.length) {
    return { n: 0, mean: null, std: null, median: null, iqr: null, cv: null };
  }
  const m = mean(xs);
  const sd = std(xs);
  const cv = (m && sd) ? sd / m : null;
  return {
    n: xs.length,
    mean: m !== null ? Math.round(m) : null,
    std: sd !== null ? Math.round(sd) : null,
    median: median(xs) !== null ? Math.round(median(xs)) : null,
    iqr: iqr(xs) !== null ? Math.round(iqr(xs)) : null,
    cv: cv !== null ? Number(cv.toFixed(3)) : null
  };
}

function recoveryTimes(errorTimes, successTimes) {
  const out = [];
  const succ = successTimes.slice().sort((a, b) => a - b);
  for (const e of errorTimes) {
    const next = succ.find(s => s > e);
    if (next !== undefined) out.push(next - e);
  }
  return out;
}

function lastOf(arr, pred) {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) return arr[i];
  }
  return null;
}

function countBy(xs, keyFn) {
  const m = {};
  for (const x of xs) {
    const k = keyFn(x);
    m[k] = (m[k] || 0) + 1;
  }
  return m;
}

function bucketBy(xs, keyFn) {
  const out = {};
  for (const x of xs) {
    const k = keyFn(x);
    (out[k] ||= []).push(x);
  }
  return out;
}

function thirdsIndex(ms, w) {
  if (!w?.startMs || !w?.endMs) return null;
  const dur = w.endMs - w.startMs;
  if (dur <= 0) return null;
  const r = (ms - w.startMs) / dur;
  if (r < 1 / 3) return 0;
  if (r < 2 / 3) return 1;
  return 2;
}

function thirdsStats({ startMs, endMs, submits, hits, misses }) {
  if (!startMs || !endMs) {
    return {
      accuracyEarly: null, accuracyLate: null, accuracyDeltaEarlyLate: null,
      missRateEarlyPct: null, missRateLatePct: null, missRateDeltaEarlyLatePct: null
    };
  }

  const w = { startMs, endMs };

  // typing accuracy per third
  let accEarly = null, accLate = null, accDelta = null;
  if (Array.isArray(submits)) {
    const by = [[], [], []];
    for (const s of submits) {
      const idx = thirdsIndex(s.ms, w);
      if (idx === null) continue;
      by[idx].push(s);
    }
    const acc = (arr) => {
      if (!arr.length) return null;
      const ok = arr.reduce((a, s) => a + (Number(s.ok) === 1 ? 1 : 0), 0);
      return Math.round(100 * ok / arr.length);
    };
    accEarly = acc(by[0]);
    accLate = acc(by[2]);
    if (accEarly !== null && accLate !== null) accDelta = accLate - accEarly;
  }

  // tapping miss rate per third
  let missEarly = null, missLate = null, missDelta = null;
  if (Array.isArray(hits) && Array.isArray(misses)) {
    const hBy = [0, 0, 0];
    const mBy = [0, 0, 0];

    for (const h of hits) {
      const idx = thirdsIndex(h.ms, w);
      if (idx !== null) hBy[idx] += 1;
    }
    for (const m of misses) {
      const idx = thirdsIndex(m.ms, w);
      if (idx !== null) mBy[idx] += 1;
    }

    const missRate = (i) => {
      const total = hBy[i] + mBy[i];
      return total ? Math.round(100 * mBy[i] / total) : null;
    };

    missEarly = missRate(0);
    missLate = missRate(2);
    if (missEarly !== null && missLate !== null) missDelta = missLate - missEarly;
  }

  return {
    accuracyEarly: accEarly,
    accuracyLate: accLate,
    accuracyDeltaEarlyLate: accDelta,

    missRateEarlyPct: missEarly,
    missRateLatePct: missLate,
    missRateDeltaEarlyLatePct: missDelta
  };
}

function thirdsFromSeries(times, w) {
  if (!w?.startMs || !w?.endMs) return { meanEarly: null, meanLate: null, deltaEarlyLate: null };
  const out = [[], [], []];
  for (let i = 1; i < times.length; i++) {
    const t0 = times[i - 1];
    const t1 = times[i];
    const dt = Math.min(t1 - t0, 2000);
    const idx = thirdsIndex(t1, w);
    if (idx === null) continue;
    out[idx].push(dt);
  }
  const m0 = mean(out[0]);
  const m2 = mean(out[2]);
  return {
    meanEarly: m0 !== null ? Math.round(m0) : null,
    meanLate: m2 !== null ? Math.round(m2) : null,
    deltaEarlyLate: (m0 !== null && m2 !== null) ? Math.round(m2 - m0) : null
  };
}

function thirdsFromTimedValues(points, w) {
  if (!w?.startMs || !w?.endMs) return { meanEarly: null, meanLate: null, deltaEarlyLate: null };
  const out = [[], [], []];
  for (const p of points) {
    const idx = thirdsIndex(p.ms, w);
    if (idx === null) continue;
    out[idx].push(p.v);
  }
  const m0 = mean(out[0]);
  const m2 = mean(out[2]);
  return {
    meanEarly: m0 !== null ? Math.round(m0) : null,
    meanLate: m2 !== null ? Math.round(m2) : null,
    deltaEarlyLate: (m0 !== null && m2 !== null) ? Math.round(m2 - m0) : null
  };
}

function card(title, lines) {
  const c = document.createElement("div");
  c.className = "card";

  const h = document.createElement("h3");
  h.textContent = title;
  h.style.margin = "0 0 8px";

  const ul = document.createElement("ul");
  ul.style.margin = "0";
  ul.style.paddingLeft = "18px";
  ul.style.lineHeight = "1.35";

  for (const line of lines) {
    const li = document.createElement("li");
    li.textContent = line;
    ul.appendChild(li);
  }

  c.appendChild(h);
  c.appendChild(ul);
  return c;
}

function fmt(x) {
  if (x === null || x === undefined) return "—";
  if (typeof x === "number") return String(x);
  return String(x);
}

function fmtMs(x) {
  if (x === null || x === undefined) return "—";
  return `${x}ms`;
}