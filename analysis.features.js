// analysis.features.js
// Behavioural feature extraction for continuous authentication

/* =========================
   PUBLIC EXPORTS
   ========================= */

export function computeSummary(session) {
  if (!session) return null;

  const t = session.rounds?.typing || {};
  const tap = session.rounds?.tapping || {};

  const typingAcc =
    t.attempts ? Math.round((t.correct / t.attempts) * 100) : 0;

  const tapTotal = (tap.hits || 0) + (tap.misses || 0);
  const tapAcc =
    tapTotal ? Math.round(((tap.hits || 0) / tapTotal) * 100) : 0;

  const tapScore = Math.max(0, (tap.hits || 0) - (tap.misses || 0));
  const typingScore = t.score ?? 0;

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

    totalScore: typingScore + tapScore
  };
}

export function computeSessionFeatures(session) {
  if (!session) return null;

  const events = Array.isArray(session.events) ? session.events : [];
  const { typingWindow, tappingWindow } = inferWindows(events);

  // ---------- Typing IKTs ----------
  const keyEvents = events
    .filter(e =>
      e?.t === "key" &&
      inWindow(e.ms, typingWindow) &&
      (e.k === "K" || e.k === "B")
    )
    .map(e => e.ms);

  const iktGlobal = deltas(keyEvents).map(x => Math.min(x, 2000));

  // Within-word IKTs (app-matched)
  const timeline = events
    .filter(e =>
      inWindow(e.ms, typingWindow) &&
      (e.t === "word_shown" || (e.t === "key" && (e.k === "K" || e.k === "B")))
    )
    .sort((a, b) => a.ms - b.ms);

  const iktWithin = [];
  let lastKey = null;
  for (const e of timeline) {
    if (e.t === "word_shown") {
      lastKey = null;
      continue;
    }
    if (lastKey !== null) {
      iktWithin.push(Math.min(e.ms - lastKey, 2000));
    }
    lastKey = e.ms;
  }

  // ---------- Typing submits ----------
  const submits = events.filter(e => e?.t === "typing_submit" && inWindow(e.ms, typingWindow));
  const wrongTimes = submits.filter(s => !s.ok).map(s => s.ms);
  const correctTimes = submits.filter(s => s.ok).map(s => s.ms);

  // ---------- Tapping ----------
  const hits = events.filter(e => e?.t === "tap_hit" && inWindow(e.ms, tappingWindow));
  const misses = events.filter(e => e?.t === "tap_miss" && inWindow(e.ms, tappingWindow));
  const rts = hits.map(h => h.rt).filter(isFiniteNumber);

  return {
    typing: {
      iktGlobal: seriesSummary(iktGlobal, 2000),
      iktWithin: seriesSummary(iktWithin, 2000),
      accuracyPct: submits.length
        ? Math.round(100 * correctTimes.length / submits.length)
        : 0,
      driftIkt: driftDelta(keyEvents, typingWindow),
      errorRecoveryWrong: seriesSummary(
        recoveryTimes(wrongTimes, correctTimes)
      )
    },

    tapping: {
      rt: seriesSummary(rts),
      missRatePct: (hits.length + misses.length)
        ? Math.round(100 * misses.length / (hits.length + misses.length))
        : 0,
      driftRt: driftDelta(
        hits.map(h => ({ ms: h.ms, v: h.rt })),
        tappingWindow,
        true
      ),
      errorRecoveryMiss: seriesSummary(
        recoveryTimes(misses.map(m => m.ms), hits.map(h => h.ms))
      )
    },

    coupling: {
      varIkt: variance(iktGlobal),
      varRt: variance(rts),
      varRatio: (variance(iktGlobal) && variance(rts))
        ? Number((variance(rts) / variance(iktGlobal)).toFixed(3))
        : null
    }
  };
}

export function computeSessionFlags(session, features) {
  if (!session || !features) return { valid: false, flags: ["NO_SESSION"] };

  const flags = [];
  if (!features.typing || !features.tapping) flags.push("INCOMPLETE");
  return { valid: flags.length === 0, flags };
}

/* =========================
   HELPERS
   ========================= */

function inferWindows(events) {
  const typingStart = events.find(e => e.t === "word_shown")?.ms;
  const typingEnd = [...events].reverse().find(e => e.t === "typing_end")?.ms;

  const tappingStart = events.find(e => e.t === "target_move")?.ms;
  const tappingEnd = [...events].reverse().find(e => e.t === "tapping_end")?.ms;

  return {
    typingWindow: { startMs: typingStart, endMs: typingEnd },
    tappingWindow: { startMs: tappingStart, endMs: tappingEnd }
  };
}

function inWindow(ms, w) {
  return isFiniteNumber(ms) && w?.startMs && w?.endMs && ms >= w.startMs && ms <= w.endMs;
}

function deltas(xs) {
  const out = [];
  for (let i = 1; i < xs.length; i++) out.push(xs[i] - xs[i - 1]);
  return out;
}

function seriesSummary(xs, clipMax = null) {
  if (!xs.length) return { n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const m = mean(xs);
  const sd = std(xs);

  return {
    n: xs.length,
    mean: Math.round(m),
    std: Math.round(sd),
    iqr: Math.round(quantile(s, 0.75) - quantile(s, 0.25)),
    p95: Math.round(quantile(s, 0.95)),
    max: Math.max(...s),
    clippedPct: clipMax
      ? Number((100 * xs.filter(x => x >= clipMax).length / xs.length).toFixed(1))
      : null
  };
}

function driftDelta(series, w, isTimed = false) {
  if (!w.startMs || !w.endMs) return null;
  const mid = (w.startMs + w.endMs) / 2;

  const early = series.filter(e =>
    (isTimed ? e.ms : e) < mid
  ).map(e => isTimed ? e.v : e);

  const late = series.filter(e =>
    (isTimed ? e.ms : e) >= mid
  ).map(e => isTimed ? e.v : e);

  if (!early.length || !late.length) return null;
  return Math.round(mean(late) - mean(early));
}

function recoveryTimes(errors, successes) {
  const out = [];
  const s = [...successes].sort((a, b) => a - b);
  for (const e of errors) {
    const next = s.find(x => x > e);
    if (next) out.push(next - e);
  }
  return out;
}

function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function variance(xs) {
  if (!xs.length) return null;
  const m = mean(xs);
  return mean(xs.map(x => (x - m) ** 2));
}

function std(xs) {
  return Math.sqrt(variance(xs));
}

function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base];
}

function isFiniteNumber(x) {
  return typeof x === "number" && Number.isFinite(x);
}