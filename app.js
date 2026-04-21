// ==========================
// Imports
// ==========================
import {
  auth, signInAnonymously,
  db, doc, getDoc, setDoc, serverTimestamp,
  collection, addDoc,
  storage, ref, uploadBytes
} from "./firebase.js?v=4";

import { WORDS, WORD_META, TYPING_WORD_POOL } from "./words.js?v=4";

// ==========================
// Inlined analysis helpers
// ==========================

// ---- analysis.features.js ----

const IDENTITY_BIGRAMS = [
  "th",
  "he",
  "er",
  "on",
  "an",
  "re",
  "ed",
  "nd",
  "ha",
  "at",
  "en",
  "es"
];

function summariseIdentityBigrams(bigramEvents) {
  const out = {};

  for (const bg of IDENTITY_BIGRAMS) {
    const rows = bigramEvents.filter((e) => e?.bigram === bg);

    out[bg] = {
      pressToPress: seriesSummary(
        rows.map((e) => e.press_to_press_ms).filter(isFiniteNumberFeature),
        2000
      ),
      releaseToPress: seriesSummary(
        rows.map((e) => e.release_to_press_ms).filter(isFiniteNumberFeature),
        2000
      ),
      sameHandPct: pctTrue(rows, "same_hand"),
      crossHandPct: pctTrue(rows, "cross_hand"),
      adjacentPct: pctTrue(rows, "adjacent_key"),
      farPct: pctTrue(rows, "far_key"),
      count: rows.length
    };
  }

  return out;
}

function computeSummary(session) {
  if (!session) return null;

  const t = session.rounds?.typing || {};
  const tap = session.rounds?.tapping || {};

  const typingAcc = t.attempts ? Math.round((t.correct / t.attempts) * 100) : 0;
  const tapTotal = (tap.hits || 0) + (tap.misses || 0);
  const tapAcc = tapTotal ? Math.round(((tap.hits || 0) / tapTotal) * 100) : 0;
  const tapScore = Math.max(0, (tap.hits || 0) - (tap.misses || 0));
  const typingScore = t.score ?? 0;

  return {
    schemaVersion: session.schemaVersion ?? null,
    featureSchema: session.featureSchema ?? null,
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

function computeSessionFeatures(session, windowOverride = null) {
  if (!session) return null;

  const events = Array.isArray(session.events) ? session.events : [];
  const { typingWindow, tappingWindow } = inferWindows(events, windowOverride);

  const legacyKeyEvents = events
    .filter(
      (e) =>
        e?.t === "key" &&
        inWindowFeature(e.ms, typingWindow) &&
        (e.k === "K" || e.k === "B")
    )
    .map((e) => e.ms);

  const iktGlobal = deltasFeature(legacyKeyEvents).map((x) => Math.min(x, 2000));

  const timeline = events
    .filter(
      (e) =>
        inWindowFeature(e.ms, typingWindow) &&
        (e.t === "word_shown" || (e.t === "key" && (e.k === "K" || e.k === "B")))
    )
    .sort((a, b) => a.ms - b.ms);

  const iktWithin = [];
  let lastLegacyKey = null;
  for (const e of timeline) {
    if (e.t === "word_shown") {
      lastLegacyKey = null;
      continue;
    }
    if (lastLegacyKey !== null) {
      iktWithin.push(Math.min(e.ms - lastLegacyKey, 2000));
    }
    lastLegacyKey = e.ms;
  }

  const keyDowns = events
    .filter((e) => e?.t === "key_down" && inWindowFeature(e.ms, typingWindow))
    .sort((a, b) => a.ms - b.ms);

  const bigramEvents = events
    .filter((e) => e?.t === "typing_bigram" && inWindowFeature(e.ms, typingWindow))
    .sort((a, b) => a.ms - b.ms);

  const identityBigramFeatures = summariseIdentityBigrams(bigramEvents);

  const bigramPressToPress = bigramEvents
    .map((e) => e.press_to_press_ms)
    .filter(isFiniteNumberFeature);

  const bigramReleaseToPress = bigramEvents
    .map((e) => e.release_to_press_ms)
    .filter(isFiniteNumberFeature);

  const bigramSameHandPct = pctTrue(bigramEvents, "same_hand");
  const bigramCrossHandPct = pctTrue(bigramEvents, "cross_hand");
  const bigramAdjacentPct = pctTrue(bigramEvents, "adjacent_key");
  const bigramFarPct = pctTrue(bigramEvents, "far_key");

  const keyUps = events
    .filter((e) => e?.t === "key_up" && inWindowFeature(e.ms, typingWindow))
    .sort((a, b) => a.ms - b.ms);

  const submits = events
    .filter((e) => e?.t === "typing_submit" && inWindowFeature(e.ms, typingWindow))
    .sort((a, b) => a.ms - b.ms);

  const wordShown = events
    .filter((e) => e?.t === "word_shown" && inWindowFeature(e.ms, typingWindow))
    .sort((a, b) => a.ms - b.ms);

  const typingReactionEvents = events
    .filter((e) => e?.t === "typing_reaction" && inWindowFeature(e.ms, typingWindow))
    .sort((a, b) => a.ms - b.ms);

  const wrongTimes = submits.filter((s) => !s.ok).map((s) => s.ms);
  const correctTimes = submits.filter((s) => !!s.ok).map((s) => s.ms);

  const dwellMs = keyUps.map((e) => e.dwell_ms).filter(isFiniteNumberFeature);
  const pressToPressMs = keyDowns.map((e) => e.press_to_press_ms).filter(isFiniteNumberFeature);
  const releaseToPressMs = keyDowns.map((e) => e.release_to_press_ms).filter(isFiniteNumberFeature);
  const transitionDistance = keyDowns.map((e) => e.transition_distance).filter(isFiniteNumberFeature);

  const hesitationPauseCount = keyDowns.filter((e) => e.hesitation_pause === true).length;
  const pauses750 = pressToPressMs.filter((x) => x >= 750).length;
  const pauses1000 = pressToPressMs.filter((x) => x >= 1000).length;

  const sameHandPct = pctTrue(keyDowns, "same_hand");
  const crossHandPct = pctTrue(keyDowns, "cross_hand");
  const sameRowPct = pctTrue(keyDowns, "same_row");
  const rowChangePct = pctTrue(keyDowns, "row_change");
  const adjacentKeyPct = pctTrue(keyDowns, "adjacent_key");
  const farKeyPct = pctTrue(keyDowns, "far_key");

  const letterOnlyKeyDowns = keyDowns.filter((e) => e.key_is_letter === true);
  const backspaceKeyDowns = keyDowns.filter((e) => e.key_code_class === "BACKSPACE");

  const backspaceBurstLens = [];
  let currentBackspaceBurst = 0;
  for (const e of keyDowns) {
    if (e.key_code_class === "BACKSPACE") {
      currentBackspaceBurst += 1;
    } else if (currentBackspaceBurst > 0) {
      backspaceBurstLens.push(currentBackspaceBurst);
      currentBackspaceBurst = 0;
    }
  }
  if (currentBackspaceBurst > 0) backspaceBurstLens.push(currentBackspaceBurst);

  const firstLetterLatencies = [];
  const middleLetterLatencies = [];
  const lastLetterLatencies = [];
  const shortWordPressToPress = [];
  const longWordPressToPress = [];

  for (let i = 0; i < wordShown.length; i++) {
    const startMs = wordShown[i].ms;
    const endMs = i + 1 < wordShown.length ? wordShown[i + 1].ms : typingWindow.endMs;

    const localKeys = keyDowns.filter(
      (e) =>
        e.ms >= startMs &&
        e.ms < endMs &&
        e.key_is_letter === true &&
        isFiniteNumberFeature(e.pos)
    );

    if (!localKeys.length) continue;

    const maxPos = Math.max(...localKeys.map((e) => e.pos).filter(isFiniteNumberFeature));
    const wordLen = Number.isFinite(maxPos) ? maxPos : null;

    const first = localKeys.find((e) => e.pos === 1);
    if (first) firstLetterLatencies.push(first.ms - startMs);

    for (const e of localKeys) {
      if (!Number.isFinite(e.pos) || !Number.isFinite(wordLen)) continue;

      if (e.pos === wordLen) {
        if (isFiniteNumberFeature(e.press_to_press_ms)) lastLetterLatencies.push(e.press_to_press_ms);
      } else if (e.pos > 1 && e.pos < wordLen) {
        if (isFiniteNumberFeature(e.press_to_press_ms)) middleLetterLatencies.push(e.press_to_press_ms);
      }

      if (isFiniteNumberFeature(e.press_to_press_ms)) {
        if (wordLen <= 4) shortWordPressToPress.push(e.press_to_press_ms);
        if (wordLen >= 7) longWordPressToPress.push(e.press_to_press_ms);
      }
    }
  }

  const typingSeriesForDrift = pressToPressMs.map((v, i) => ({
    ms: keyDowns[i]?.ms,
    v
  })).filter((x) => isFiniteNumberFeature(x.ms) && isFiniteNumberFeature(x.v));

  const typingEarlyLate = earlyLateDeltaFeature(pressToPressMs);
  const dwellEarlyLate = earlyLateDeltaFeature(dwellMs);

  const hits = events
    .filter((e) => e?.t === "tap_hit" && inWindowFeature(e.ms, tappingWindow))
    .sort((a, b) => a.ms - b.ms);

  const misses = events
    .filter((e) => e?.t === "tap_miss" && inWindowFeature(e.ms, tappingWindow))
    .sort((a, b) => a.ms - b.ms);

  const pointerMoves = events
    .filter((e) => e?.t === "pointer_move" && inWindowFeature(e.ms, tappingWindow))
    .sort((a, b) => a.ms - b.ms);

  const pointerDowns = events
    .filter((e) => e?.t === "pointer_down" && inWindowFeature(e.ms, tappingWindow))
    .sort((a, b) => a.ms - b.ms);

  const pointerUps = events
    .filter((e) => e?.t === "pointer_up" && inWindowFeature(e.ms, tappingWindow))
    .sort((a, b) => a.ms - b.ms);

  const rts = hits.map((h) => h.rt).filter(isFiniteNumberFeature);
  const tapReactionToFirstMove = hits.map((h) => h.reaction_to_first_move_ms).filter(isFiniteNumberFeature);
  const tapReactionToClick = hits.map((h) => h.reaction_to_click_ms).filter(isFiniteNumberFeature);
  const tapClickHold = hits.map((h) => h.click_hold_ms).filter(isFiniteNumberFeature);
  const tapDistToCenter = hits.map((h) => h.dist_to_target_center).filter(isFiniteNumberFeature);
  const tapHoverTime = hits.map((h) => h.hover_time_ms).filter(isFiniteNumberFeature);
  const tapPathLength = hits.map((h) => h.path_length).filter(isFiniteNumberFeature);
  const tapMeanSpeed = hits.map((h) => h.mean_speed).filter(isFiniteNumberFeature);
  const tapSpeedVar = hits.map((h) => h.speed_var).filter(isFiniteNumberFeature);
  const tapMeanAccel = hits.map((h) => h.mean_accel).filter(isFiniteNumberFeature);
  const tapMeanAbsJerk = hits.map((h) => h.mean_abs_jerk).filter(isFiniteNumberFeature);
  const tapStraightness = hits.map((h) => h.straightness_ratio).filter(isFiniteNumberFeature);
  const tapMicroCorrections = hits.map((h) => h.micro_correction_count).filter(isFiniteNumberFeature);
  const tapOvershoot = hits.map((h) => h.overshoot_count).filter(isFiniteNumberFeature);
  const tapIdleToAction = hits.map((h) => h.idle_to_action_latency_ms).filter(isFiniteNumberFeature);
  const tapNearestDist = hits.map((h) => h.nearest_distance_to_target).filter(isFiniteNumberFeature);
  const tapHoverSamples = hits.map((h) => h.hover_samples).filter(isFiniteNumberFeature);
  const tapTouchRadiusX = hits.map((h) => h.touch_radius_x).filter(isFiniteNumberFeature);
  const tapTouchRadiusY = hits.map((h) => h.touch_radius_y).filter(isFiniteNumberFeature);
  const tapTouchForce = hits.map((h) => h.touch_force).filter(isFiniteNumberFeature);
  const tapTouchArea = hits.map((h) => h.touch_area_est).filter(isFiniteNumberFeature);
  const tapTouchAspectRatio = hits.map((h) => h.touch_aspect_ratio).filter(isFiniteNumberFeature);
  const tapTouchRotationAngle = hits.map((h) => h.touch_rotation_angle).filter(isFiniteNumberFeature);

  const tapCadence = deltasFeature(hits.map((h) => h.ms)).filter(isFiniteNumberFeature);

  const nearMissCount = misses.filter((m) => m.near_miss === true).length;
  const nearMissPct = misses.length
    ? Number(((100 * nearMissCount) / misses.length).toFixed(1))
    : null;

  const enteredTargetBeforeHitPct = hits.length
    ? Number(((100 * hits.filter((h) => h.entered_target_before_hit === true).length) / hits.length).toFixed(1))
    : null;

  const pointerDistSeries = pointerMoves.map((e) => e.dist_to_target_center).filter(isFiniteNumberFeature);
  const pointerSpeedSeries = pointerMoves.map((e) => e.speed).filter(isFiniteNumberFeature);
  const pointerAngleSeries = pointerMoves.map((e) => e.angle_deg).filter(isFiniteNumberFeature);

  const tappingEarlyLateRt = earlyLateDeltaFeature(rts);
  const tappingEarlyLateDist = earlyLateDeltaFeature(tapDistToCenter);

  const varIkt = varianceFeature(iktGlobal);
  const varRt = varianceFeature(rts);

  return {
    typing: {
      iktGlobal: seriesSummary(iktGlobal, 2000),
      iktWithin: seriesSummary(iktWithin, 2000),
      accuracyPct: submits.length ? Math.round((100 * correctTimes.length) / submits.length) : 0,
      driftIkt: driftDeltaFeature(typingSeriesForDrift, typingWindow, true),
      errorRecoveryWrong: seriesSummary(recoveryTimesFeature(wrongTimes, correctTimes)),
      dwell: seriesSummary(dwellMs),
      pressToPress: seriesSummary(pressToPressMs, 2000),
      releaseToPress: seriesSummary(releaseToPressMs, 2000),
      keyTravel: seriesSummary(transitionDistance),
      sameHandPct,
      crossHandPct,
      sameRowPct,
      rowChangePct,
      adjacentKeyPct,
      farKeyPct,
      backspaceBurst: seriesSummary(backspaceBurstLens),
      backspaceCount: backspaceKeyDowns.length,
      hesitationPauseCount,
      pauses750Count: pauses750,
      pauses1000Count: pauses1000,
      cvPressToPress: coeffVarFeature(pressToPressMs),
      cvDwell: coeffVarFeature(dwellMs),
      entropyPressToPress: entropyFromSeriesFeature(pressToPressMs, 8),
      burstinessPressToPress: burstinessFeature(pressToPressMs),
      localInconsistencyPressToPress: localInconsistencyFeature(pressToPressMs),
      outlierPressToPressPct: outlierPctFeature(pressToPressMs),
      earlyLatePressToPressDiff: typingEarlyLate,
      earlyLateDwellDiff: dwellEarlyLate,
      firstLetterRt: seriesSummary(firstLetterLatencies, 3000),
      middleLetterRhythm: seriesSummary(middleLetterLatencies, 2000),
      lastLetterLatency: seriesSummary(lastLetterLatencies, 2000),
      shortWordPtp: seriesSummary(shortWordPressToPress, 2000),
      longWordPtp: seriesSummary(longWordPressToPress, 2000),
      bigramPressToPress: seriesSummary(bigramPressToPress, 2000),
      bigramReleaseToPress: seriesSummary(bigramReleaseToPress, 2000),
      bigramSameHandPct,
      bigramCrossHandPct,
      bigramAdjacentPct,
      bigramFarPct,
      identityBigrams: identityBigramFeatures,
      keyDownCount: keyDowns.length,
      keyUpCount: keyUps.length,
      letterKeyCount: letterOnlyKeyDowns.length,
      typingReaction: seriesSummary(
        typingReactionEvents.map((e) => e.rt).filter(isFiniteNumberFeature),
        3000
      )
    },

    tapping: {
      rt: seriesSummary(rts),
      missRatePct:
        hits.length + misses.length
          ? Math.round((100 * misses.length) / (hits.length + misses.length))
          : 0,
      driftRt: driftDeltaFeature(
        hits.map((h) => ({ ms: h.ms, v: h.rt })),
        tappingWindow,
        true
      ),
      errorRecoveryMiss: seriesSummary(
        recoveryTimesFeature(
          misses.map((m) => m.ms),
          hits.map((h) => h.ms)
        )
      ),
      reactionToFirstMove: seriesSummary(tapReactionToFirstMove, 3000),
      reactionToClick: seriesSummary(tapReactionToClick, 3000),
      clickHold: seriesSummary(tapClickHold, 2000),
      distToCenter: seriesSummary(tapDistToCenter),
      nearestDistToTarget: seriesSummary(tapNearestDist),
      pathLength: seriesSummary(tapPathLength),
      meanSpeed: seriesSummary(tapMeanSpeed),
      speedVar: seriesSummary(tapSpeedVar),
      meanAccel: seriesSummary(tapMeanAccel),
      meanAbsJerk: seriesSummary(tapMeanAbsJerk),
      straightnessRatio: seriesSummary(tapStraightness),
      microCorrectionCount: seriesSummary(tapMicroCorrections),
      overshootCount: seriesSummary(tapOvershoot),
      hoverTime: seriesSummary(tapHoverTime),
      hoverSamples: seriesSummary(tapHoverSamples),
      idleToActionLatency: seriesSummary(tapIdleToAction),
      enteredTargetBeforeHitPct,
      touchRadiusX: seriesSummary(tapTouchRadiusX),
      touchRadiusY: seriesSummary(tapTouchRadiusY),
      touchForce: seriesSummary(tapTouchForce),
      touchArea: seriesSummary(tapTouchArea),
      touchAspectRatio: seriesSummary(tapTouchAspectRatio),
      touchRotationAngle: seriesSummary(tapTouchRotationAngle),
      pointerMoveCount: pointerMoves.length,
      pointerDownCount: pointerDowns.length,
      pointerUpCount: pointerUps.length,
      pointerDistEntropy: entropyFromSeriesFeature(pointerDistSeries, 8),
      pointerAngleEntropy: entropyFromSeriesFeature(pointerAngleSeries, 12),
      pointerSpeedCv: coeffVarFeature(pointerSpeedSeries),
      nearMissCount,
      nearMissPct,
      cadence: seriesSummary(tapCadence, 5000),
      cvCadence: coeffVarFeature(tapCadence),
      burstinessCadence: burstinessFeature(tapCadence),
      localInconsistencyCadence: localInconsistencyFeature(tapCadence),
      earlyLateRtDiff: tappingEarlyLateRt,
      earlyLateDistDiff: tappingEarlyLateDist
    },

    coupling: {
      varIkt,
      varRt,
      varRatio:
        isFiniteNumberFeature(varIkt) && isFiniteNumberFeature(varRt) && varIkt > 0
          ? Number((varRt / varIkt).toFixed(3))
          : null
    }
  };
}

function computeSessionFlags(session, features) {
  if (!session || !features) return { valid: false, flags: ["NO_SESSION"] };

  const flags = [];
  if (!features.typing || !features.tapping) flags.push("INCOMPLETE");

  return { valid: flags.length === 0, flags };
}

function inferWindows(events, override = null) {
  if (override?.startMs != null && override?.endMs != null) {
    return {
      typingWindow: { startMs: override.startMs, endMs: override.endMs },
      tappingWindow: { startMs: override.startMs, endMs: override.endMs }
    };
  }

  const typingStart = events.find((e) => e.t === "word_shown")?.ms;
  const typingEnd = [...events].reverse().find((e) => e.t === "typing_end")?.ms;
  const tappingStart = events.find((e) => e.t === "target_move")?.ms;
  const tappingEnd = [...events].reverse().find((e) => e.t === "tapping_end")?.ms;

  return {
    typingWindow: { startMs: typingStart, endMs: typingEnd },
    tappingWindow: { startMs: tappingStart, endMs: tappingEnd }
  };
}

function generateWindows(events, windowMs, stepMs = windowMs) {
  const times = events.map((e) => e.ms).filter(isFiniteNumberFeature);
  if (!times.length) return [];

  const start = Math.min(...times);
  const end = Math.max(...times);
  const windows = [];

  let idx = 0;
  for (let t = start; t + windowMs <= end; t += stepMs) {
    windows.push({
      windowIndex: idx++,
      startMs: t,
      endMs: t + windowMs
    });
  }
  return windows;
}

function inWindowFeature(ms, w) {
  return (
    isFiniteNumberFeature(ms) &&
    isFiniteNumberFeature(w?.startMs) &&
    isFiniteNumberFeature(w?.endMs) &&
    ms >= w.startMs &&
    ms <= w.endMs
  );
}

function deltasFeature(xs) {
  const out = [];
  for (let i = 1; i < xs.length; i++) out.push(xs[i] - xs[i - 1]);
  return out;
}

function seriesSummary(xs, clipMax = null) {
  const clean = xs.filter(isFiniteNumberFeature);
  if (!clean.length) {
    return {
      n: 0,
      mean: null,
      std: null,
      median: null,
      iqr: null,
      p95: null,
      max: null,
      clippedPct: null
    };
  }

  const s = [...clean].sort((a, b) => a - b);
  return {
    n: clean.length,
    mean: roundOrNullFeature(meanFeature(clean)),
    std: roundOrNullFeature(stdFeature(clean)),
    median: roundOrNullFeature(quantileFeature(s, 0.5)),
    iqr: roundOrNullFeature(quantileFeature(s, 0.75) - quantileFeature(s, 0.25)),
    p95: roundOrNullFeature(quantileFeature(s, 0.95)),
    max: roundOrNullFeature(Math.max(...s)),
    clippedPct: clipMax
      ? Number(((100 * clean.filter((x) => x >= clipMax).length) / clean.length).toFixed(1))
      : null
  };
}

function driftDeltaFeature(series, w, isTimed = false) {
  if (!isFiniteNumberFeature(w?.startMs) || !isFiniteNumberFeature(w?.endMs)) return null;

  const mid = (w.startMs + w.endMs) / 2;
  const early = series
    .filter((e) => (isTimed ? e.ms : e) < mid)
    .map((e) => (isTimed ? e.v : e))
    .filter(isFiniteNumberFeature);

  const late = series
    .filter((e) => (isTimed ? e.ms : e) >= mid)
    .map((e) => (isTimed ? e.v : e))
    .filter(isFiniteNumberFeature);

  if (!early.length || !late.length) return null;
  return roundOrNullFeature(meanFeature(late) - meanFeature(early));
}

function earlyLateDeltaFeature(xs) {
  const clean = xs.filter(isFiniteNumberFeature);
  if (clean.length < 4) return null;
  const half = Math.floor(clean.length / 2);
  const early = clean.slice(0, half);
  const late = clean.slice(half);
  if (!early.length || !late.length) return null;
  return roundOrNullFeature(meanFeature(late) - meanFeature(early));
}

function recoveryTimesFeature(errors, successes) {
  const out = [];
  const s = [...successes].filter(isFiniteNumberFeature).sort((a, b) => a - b);

  for (const e of errors.filter(isFiniteNumberFeature)) {
    const next = s.find((x) => x > e);
    if (isFiniteNumberFeature(next)) out.push(next - e);
  }
  return out;
}

function pctTrue(rows, field) {
  const vals = rows.map((r) => r?.[field]).filter((v) => typeof v === "boolean");
  if (!vals.length) return null;
  return Number(((100 * vals.filter(Boolean).length) / vals.length).toFixed(1));
}

function coeffVarFeature(xs) {
  const clean = xs.filter(isFiniteNumberFeature);
  if (clean.length < 2) return null;
  const m = meanFeature(clean);
  if (!isFiniteNumberFeature(m) || m === 0) return null;
  return Number((stdFeature(clean) / m).toFixed(4));
}

function entropyFromSeriesFeature(xs, bins = 8) {
  const clean = xs.filter(isFiniteNumberFeature);
  if (clean.length < 3) return null;

  const minV = Math.min(...clean);
  const maxV = Math.max(...clean);
  if (minV === maxV) return 0;

  const width = (maxV - minV) / bins;
  const counts = new Array(bins).fill(0);

  for (const x of clean) {
    let idx = Math.floor((x - minV) / width);
    if (idx >= bins) idx = bins - 1;
    if (idx < 0) idx = 0;
    counts[idx] += 1;
  }

  const probs = counts.map((c) => c / clean.length).filter((p) => p > 0);
  const h = -probs.reduce((acc, p) => acc + p * Math.log2(p), 0);
  return Number(h.toFixed(4));
}

function burstinessFeature(xs) {
  const clean = xs.filter(isFiniteNumberFeature);
  if (clean.length < 3) return null;
  const m = meanFeature(clean);
  const s = stdFeature(clean);
  if (s + m === 0) return null;
  return Number(((s - m) / (s + m)).toFixed(4));
}

function localInconsistencyFeature(xs) {
  const clean = xs.filter(isFiniteNumberFeature);
  if (clean.length < 3) return null;
  const diffs = [];
  for (let i = 1; i < clean.length; i++) {
    diffs.push(Math.abs(clean[i] - clean[i - 1]));
  }
  return roundOrNullFeature(meanFeature(diffs));
}

function outlierPctFeature(xs) {
  const clean = xs.filter(isFiniteNumberFeature);
  if (clean.length < 4) return null;

  const s = [...clean].sort((a, b) => a - b);
  const q1 = quantileFeature(s, 0.25);
  const q3 = quantileFeature(s, 0.75);
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;

  const nOut = clean.filter((x) => x < lo || x > hi).length;
  return Number(((100 * nOut) / clean.length).toFixed(1));
}

function meanFeature(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function varianceFeature(xs) {
  const clean = xs.filter(isFiniteNumberFeature);
  if (!clean.length) return null;
  const m = meanFeature(clean);
  return meanFeature(clean.map((x) => (x - m) ** 2));
}

function stdFeature(xs) {
  const v = varianceFeature(xs);
  return isFiniteNumberFeature(v) ? Math.sqrt(v) : null;
}

function quantileFeature(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base];
}

function roundOrNullFeature(x) {
  return isFiniteNumberFeature(x) ? Math.round(x) : null;
}

function isFiniteNumberFeature(x) {
  return typeof x === "number" && Number.isFinite(x);
}

// ---- analysis.export.js ----

function summaryToCSVRow(summary) {
  const cols = Object.keys(summary);
  const vals = cols.map((k) => csvEscapeFeature(summary[k]));
  return { header: cols.join(","), row: vals.join(",") };
}

function downloadCSV(filename, header, row) {
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

function csvEscapeFeature(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[,"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function flattenFeaturesForAuth(summary, features, meta = {}) {
  if (!summary || !features) return null;

  const row = {
    schemaVersion: summary.schemaVersion ?? 2,
    sessionId: summary.sessionId,
    participantId: summary.participantId,
    user_id: summary.participantId,
    sessionIndex: summary.sessionIndex,
    session_order: meta.session_order ?? summary.sessionIndex ?? null,
    session_date: meta.session_date ?? null,
    timeBucket: summary.timeBucket,
    fatigue: summary.fatigue,
    inputDevice: summary.inputDevice,
    device_family: meta.device_family ?? null,
    has_typing: meta.has_typing ?? null,
    has_tapping: meta.has_tapping ?? null,
    n_key_events: meta.n_key_events ?? null,
    n_key_events_legacy: meta.n_key_events_legacy ?? null,
    n_key_down_events: meta.n_key_down_events ?? null,
    n_key_up_events: meta.n_key_up_events ?? null,
    n_tap_hits: meta.n_tap_hits ?? null,
    n_tap_misses: meta.n_tap_misses ?? null,
    n_pointer_move_events: meta.n_pointer_move_events ?? null,
    n_pointer_down_events: meta.n_pointer_down_events ?? null,
    n_pointer_up_events: meta.n_pointer_up_events ?? null,
    window_duration_ms: meta.window_duration_ms ?? null,
    is_low_activity_window: meta.is_low_activity_window ?? null,

    typing_ikt_global_mean: features.typing?.iktGlobal?.mean ?? null,
    typing_ikt_global_std: features.typing?.iktGlobal?.std ?? null,
    typing_ikt_global_iqr: features.typing?.iktGlobal?.iqr ?? null,
    typing_ikt_global_p95: features.typing?.iktGlobal?.p95 ?? null,
    typing_ikt_global_clipped_pct: features.typing?.iktGlobal?.clippedPct ?? null,

    typing_ikt_within_mean: features.typing?.iktWithin?.mean ?? null,
    typing_ikt_within_std: features.typing?.iktWithin?.std ?? null,
    typing_ikt_within_iqr: features.typing?.iktWithin?.iqr ?? null,
    typing_ikt_within_p95: features.typing?.iktWithin?.p95 ?? null,
    typing_ikt_within_clipped_pct: features.typing?.iktWithin?.clippedPct ?? null,

    typing_accuracy_pct: features.typing?.accuracyPct ?? null,
    typing_drift_ikt: features.typing?.driftIkt ?? null,
    typing_error_recovery_wrong_median:
      features.typing?.errorRecoveryWrong?.median ?? null,

    tap_rt_mean: features.tapping?.rt?.mean ?? null,
    tap_rt_std: features.tapping?.rt?.std ?? null,
    tap_rt_iqr: features.tapping?.rt?.iqr ?? null,
    tap_rt_p95: features.tapping?.rt?.p95 ?? null,

    tap_miss_rate_pct: features.tapping?.missRatePct ?? null,
    tap_drift_rt: features.tapping?.driftRt ?? null,
    tap_error_recovery_miss_median:
      features.tapping?.errorRecoveryMiss?.median ?? null,

    coupling_var_ikt: features.coupling?.varIkt ?? null,
    coupling_var_rt: features.coupling?.varRt ?? null,
    coupling_var_ratio: features.coupling?.varRatio ?? null,

    typing_keydown_count: features.typing?.keyDownCount ?? null,
    typing_keyup_count: features.typing?.keyUpCount ?? null,
    typing_letter_key_count: features.typing?.letterKeyCount ?? null,
    typing_backspace_count: features.typing?.backspaceCount ?? null,

    typing_dwell_mean: features.typing?.dwell?.mean ?? null,
    typing_dwell_std: features.typing?.dwell?.std ?? null,
    typing_dwell_median: features.typing?.dwell?.median ?? null,
    typing_dwell_iqr: features.typing?.dwell?.iqr ?? null,
    typing_dwell_p95: features.typing?.dwell?.p95 ?? null,
    typing_dwell_max: features.typing?.dwell?.max ?? null,
    typing_dwell_n: features.typing?.dwell?.n ?? null,

    typing_ptp_mean: features.typing?.pressToPress?.mean ?? null,
    typing_ptp_std: features.typing?.pressToPress?.std ?? null,
    typing_ptp_median: features.typing?.pressToPress?.median ?? null,
    typing_ptp_iqr: features.typing?.pressToPress?.iqr ?? null,
    typing_ptp_p95: features.typing?.pressToPress?.p95 ?? null,
    typing_ptp_max: features.typing?.pressToPress?.max ?? null,
    typing_ptp_clipped_pct: features.typing?.pressToPress?.clippedPct ?? null,
    typing_ptp_n: features.typing?.pressToPress?.n ?? null,

    typing_rtp_mean: features.typing?.releaseToPress?.mean ?? null,
    typing_rtp_std: features.typing?.releaseToPress?.std ?? null,
    typing_rtp_median: features.typing?.releaseToPress?.median ?? null,
    typing_rtp_iqr: features.typing?.releaseToPress?.iqr ?? null,
    typing_rtp_p95: features.typing?.releaseToPress?.p95 ?? null,
    typing_rtp_max: features.typing?.releaseToPress?.max ?? null,
    typing_rtp_clipped_pct: features.typing?.releaseToPress?.clippedPct ?? null,
    typing_rtp_n: features.typing?.releaseToPress?.n ?? null,

    typing_bigram_ptp_mean: features.typing?.bigramPressToPress?.mean ?? null,
    typing_bigram_ptp_std: features.typing?.bigramPressToPress?.std ?? null,
    typing_bigram_ptp_median: features.typing?.bigramPressToPress?.median ?? null,
    typing_bigram_ptp_iqr: features.typing?.bigramPressToPress?.iqr ?? null,
    typing_bigram_ptp_p95: features.typing?.bigramPressToPress?.p95 ?? null,
    typing_bigram_ptp_max: features.typing?.bigramPressToPress?.max ?? null,
    typing_bigram_ptp_clipped_pct:
      features.typing?.bigramPressToPress?.clippedPct ?? null,
    typing_bigram_ptp_n: features.typing?.bigramPressToPress?.n ?? null,

    typing_bigram_rtp_mean: features.typing?.bigramReleaseToPress?.mean ?? null,
    typing_bigram_rtp_std: features.typing?.bigramReleaseToPress?.std ?? null,
    typing_bigram_rtp_median: features.typing?.bigramReleaseToPress?.median ?? null,
    typing_bigram_rtp_iqr: features.typing?.bigramReleaseToPress?.iqr ?? null,
    typing_bigram_rtp_p95: features.typing?.bigramReleaseToPress?.p95 ?? null,
    typing_bigram_rtp_max: features.typing?.bigramReleaseToPress?.max ?? null,
    typing_bigram_rtp_clipped_pct:
      features.typing?.bigramReleaseToPress?.clippedPct ?? null,
    typing_bigram_rtp_n: features.typing?.bigramReleaseToPress?.n ?? null,

    typing_bigram_same_hand_pct: features.typing?.bigramSameHandPct ?? null,
    typing_bigram_cross_hand_pct: features.typing?.bigramCrossHandPct ?? null,
    typing_bigram_adjacent_pct: features.typing?.bigramAdjacentPct ?? null,
    typing_bigram_far_pct: features.typing?.bigramFarPct ?? null,

    typing_bg_th_ptp_mean: features.typing?.identityBigrams?.th?.pressToPress?.mean ?? null,
    typing_bg_th_ptp_std: features.typing?.identityBigrams?.th?.pressToPress?.std ?? null,
    typing_bg_th_rtp_mean: features.typing?.identityBigrams?.th?.releaseToPress?.mean ?? null,
    typing_bg_th_rtp_std: features.typing?.identityBigrams?.th?.releaseToPress?.std ?? null,
    typing_bg_th_count: features.typing?.identityBigrams?.th?.count ?? null,

    typing_bg_he_ptp_mean: features.typing?.identityBigrams?.he?.pressToPress?.mean ?? null,
    typing_bg_he_ptp_std: features.typing?.identityBigrams?.he?.pressToPress?.std ?? null,
    typing_bg_he_rtp_mean: features.typing?.identityBigrams?.he?.releaseToPress?.mean ?? null,
    typing_bg_he_rtp_std: features.typing?.identityBigrams?.he?.releaseToPress?.std ?? null,
    typing_bg_he_count: features.typing?.identityBigrams?.he?.count ?? null,

    typing_bg_er_ptp_mean: features.typing?.identityBigrams?.er?.pressToPress?.mean ?? null,
    typing_bg_er_ptp_std: features.typing?.identityBigrams?.er?.pressToPress?.std ?? null,
    typing_bg_er_rtp_mean: features.typing?.identityBigrams?.er?.releaseToPress?.mean ?? null,
    typing_bg_er_rtp_std: features.typing?.identityBigrams?.er?.releaseToPress?.std ?? null,
    typing_bg_er_count: features.typing?.identityBigrams?.er?.count ?? null,

    typing_bg_on_ptp_mean: features.typing?.identityBigrams?.on?.pressToPress?.mean ?? null,
    typing_bg_on_ptp_std: features.typing?.identityBigrams?.on?.pressToPress?.std ?? null,
    typing_bg_on_rtp_mean: features.typing?.identityBigrams?.on?.releaseToPress?.mean ?? null,
    typing_bg_on_rtp_std: features.typing?.identityBigrams?.on?.releaseToPress?.std ?? null,
    typing_bg_on_count: features.typing?.identityBigrams?.on?.count ?? null,

    typing_bg_an_ptp_mean: features.typing?.identityBigrams?.an?.pressToPress?.mean ?? null,
    typing_bg_an_ptp_std: features.typing?.identityBigrams?.an?.pressToPress?.std ?? null,
    typing_bg_an_rtp_mean: features.typing?.identityBigrams?.an?.releaseToPress?.mean ?? null,
    typing_bg_an_rtp_std: features.typing?.identityBigrams?.an?.releaseToPress?.std ?? null,
    typing_bg_an_count: features.typing?.identityBigrams?.an?.count ?? null,

    typing_bg_re_ptp_mean: features.typing?.identityBigrams?.re?.pressToPress?.mean ?? null,
    typing_bg_re_ptp_std: features.typing?.identityBigrams?.re?.pressToPress?.std ?? null,
    typing_bg_re_rtp_mean: features.typing?.identityBigrams?.re?.releaseToPress?.mean ?? null,
    typing_bg_re_rtp_std: features.typing?.identityBigrams?.re?.releaseToPress?.std ?? null,
    typing_bg_re_count: features.typing?.identityBigrams?.re?.count ?? null,

    typing_bg_ed_ptp_mean: features.typing?.identityBigrams?.ed?.pressToPress?.mean ?? null,
    typing_bg_ed_ptp_std: features.typing?.identityBigrams?.ed?.pressToPress?.std ?? null,
    typing_bg_ed_rtp_mean: features.typing?.identityBigrams?.ed?.releaseToPress?.mean ?? null,
    typing_bg_ed_rtp_std: features.typing?.identityBigrams?.ed?.releaseToPress?.std ?? null,
    typing_bg_ed_count: features.typing?.identityBigrams?.ed?.count ?? null,

    typing_bg_nd_ptp_mean: features.typing?.identityBigrams?.nd?.pressToPress?.mean ?? null,
    typing_bg_nd_ptp_std: features.typing?.identityBigrams?.nd?.pressToPress?.std ?? null,
    typing_bg_nd_rtp_mean: features.typing?.identityBigrams?.nd?.releaseToPress?.mean ?? null,
    typing_bg_nd_rtp_std: features.typing?.identityBigrams?.nd?.releaseToPress?.std ?? null,
    typing_bg_nd_count: features.typing?.identityBigrams?.nd?.count ?? null,

    typing_bg_ha_ptp_mean: features.typing?.identityBigrams?.ha?.pressToPress?.mean ?? null,
    typing_bg_ha_ptp_std: features.typing?.identityBigrams?.ha?.pressToPress?.std ?? null,
    typing_bg_ha_rtp_mean: features.typing?.identityBigrams?.ha?.releaseToPress?.mean ?? null,
    typing_bg_ha_rtp_std: features.typing?.identityBigrams?.ha?.releaseToPress?.std ?? null,
    typing_bg_ha_count: features.typing?.identityBigrams?.ha?.count ?? null,

    typing_bg_at_ptp_mean: features.typing?.identityBigrams?.at?.pressToPress?.mean ?? null,
    typing_bg_at_ptp_std: features.typing?.identityBigrams?.at?.pressToPress?.std ?? null,
    typing_bg_at_rtp_mean: features.typing?.identityBigrams?.at?.releaseToPress?.mean ?? null,
    typing_bg_at_rtp_std: features.typing?.identityBigrams?.at?.releaseToPress?.std ?? null,
    typing_bg_at_count: features.typing?.identityBigrams?.at?.count ?? null,

    typing_bg_en_ptp_mean: features.typing?.identityBigrams?.en?.pressToPress?.mean ?? null,
    typing_bg_en_ptp_std: features.typing?.identityBigrams?.en?.pressToPress?.std ?? null,
    typing_bg_en_rtp_mean: features.typing?.identityBigrams?.en?.releaseToPress?.mean ?? null,
    typing_bg_en_rtp_std: features.typing?.identityBigrams?.en?.releaseToPress?.std ?? null,
    typing_bg_en_count: features.typing?.identityBigrams?.en?.count ?? null,

    typing_bg_es_ptp_mean: features.typing?.identityBigrams?.es?.pressToPress?.mean ?? null,
    typing_bg_es_ptp_std: features.typing?.identityBigrams?.es?.pressToPress?.std ?? null,
    typing_bg_es_rtp_mean: features.typing?.identityBigrams?.es?.releaseToPress?.mean ?? null,
    typing_bg_es_rtp_std: features.typing?.identityBigrams?.es?.releaseToPress?.std ?? null,
    typing_bg_es_count: features.typing?.identityBigrams?.es?.count ?? null,

    typing_key_travel_mean: features.typing?.keyTravel?.mean ?? null,
    typing_key_travel_std: features.typing?.keyTravel?.std ?? null,
    typing_key_travel_median: features.typing?.keyTravel?.median ?? null,
    typing_key_travel_iqr: features.typing?.keyTravel?.iqr ?? null,
    typing_key_travel_p95: features.typing?.keyTravel?.p95 ?? null,
    typing_key_travel_max: features.typing?.keyTravel?.max ?? null,
    typing_key_travel_n: features.typing?.keyTravel?.n ?? null,

    typing_same_hand_pct: features.typing?.sameHandPct ?? null,
    typing_cross_hand_pct: features.typing?.crossHandPct ?? null,
    typing_same_row_pct: features.typing?.sameRowPct ?? null,
    typing_row_change_pct: features.typing?.rowChangePct ?? null,
    typing_adjacent_key_pct: features.typing?.adjacentKeyPct ?? null,
    typing_far_key_pct: features.typing?.farKeyPct ?? null,

    typing_backspace_burst_mean: features.typing?.backspaceBurst?.mean ?? null,
    typing_backspace_burst_std: features.typing?.backspaceBurst?.std ?? null,
    typing_backspace_burst_median: features.typing?.backspaceBurst?.median ?? null,
    typing_backspace_burst_iqr: features.typing?.backspaceBurst?.iqr ?? null,
    typing_backspace_burst_p95: features.typing?.backspaceBurst?.p95 ?? null,
    typing_backspace_burst_max: features.typing?.backspaceBurst?.max ?? null,
    typing_backspace_burst_n: features.typing?.backspaceBurst?.n ?? null,

    typing_hesitation_pause_count: features.typing?.hesitationPauseCount ?? null,
    typing_pauses_750_count: features.typing?.pauses750Count ?? null,
    typing_pauses_1000_count: features.typing?.pauses1000Count ?? null,

    typing_cv_ptp: features.typing?.cvPressToPress ?? null,
    typing_cv_dwell: features.typing?.cvDwell ?? null,
    typing_entropy_ptp: features.typing?.entropyPressToPress ?? null,
    typing_burstiness_ptp: features.typing?.burstinessPressToPress ?? null,
    typing_local_inconsistency_ptp:
      features.typing?.localInconsistencyPressToPress ?? null,
    typing_outlier_ptp_pct: features.typing?.outlierPressToPressPct ?? null,
    typing_early_late_ptp_diff: features.typing?.earlyLatePressToPressDiff ?? null,
    typing_early_late_dwell_diff: features.typing?.earlyLateDwellDiff ?? null,

    typing_first_letter_rt_mean: features.typing?.firstLetterRt?.mean ?? null,
    typing_first_letter_rt_std: features.typing?.firstLetterRt?.std ?? null,
    typing_first_letter_rt_median: features.typing?.firstLetterRt?.median ?? null,
    typing_first_letter_rt_iqr: features.typing?.firstLetterRt?.iqr ?? null,
    typing_first_letter_rt_p95: features.typing?.firstLetterRt?.p95 ?? null,

    typing_middle_letter_rhythm_mean: features.typing?.middleLetterRhythm?.mean ?? null,
    typing_middle_letter_rhythm_std: features.typing?.middleLetterRhythm?.std ?? null,
    typing_middle_letter_rhythm_median: features.typing?.middleLetterRhythm?.median ?? null,
    typing_middle_letter_rhythm_iqr: features.typing?.middleLetterRhythm?.iqr ?? null,
    typing_middle_letter_rhythm_p95: features.typing?.middleLetterRhythm?.p95 ?? null,

    typing_last_letter_latency_mean: features.typing?.lastLetterLatency?.mean ?? null,
    typing_last_letter_latency_std: features.typing?.lastLetterLatency?.std ?? null,
    typing_last_letter_latency_median: features.typing?.lastLetterLatency?.median ?? null,
    typing_last_letter_latency_iqr: features.typing?.lastLetterLatency?.iqr ?? null,
    typing_last_letter_latency_p95: features.typing?.lastLetterLatency?.p95 ?? null,

    typing_short_word_ptp_mean: features.typing?.shortWordPtp?.mean ?? null,
    typing_short_word_ptp_std: features.typing?.shortWordPtp?.std ?? null,
    typing_short_word_ptp_median: features.typing?.shortWordPtp?.median ?? null,
    typing_short_word_ptp_iqr: features.typing?.shortWordPtp?.iqr ?? null,
    typing_short_word_ptp_p95: features.typing?.shortWordPtp?.p95 ?? null,

    typing_long_word_ptp_mean: features.typing?.longWordPtp?.mean ?? null,
    typing_long_word_ptp_std: features.typing?.longWordPtp?.std ?? null,
    typing_long_word_ptp_median: features.typing?.longWordPtp?.median ?? null,
    typing_long_word_ptp_iqr: features.typing?.longWordPtp?.iqr ?? null,
    typing_long_word_ptp_p95: features.typing?.longWordPtp?.p95 ?? null,

    typing_reaction_mean: features.typing?.typingReaction?.mean ?? null,
    typing_reaction_std: features.typing?.typingReaction?.std ?? null,
    typing_reaction_median: features.typing?.typingReaction?.median ?? null,
    typing_reaction_iqr: features.typing?.typingReaction?.iqr ?? null,
    typing_reaction_p95: features.typing?.typingReaction?.p95 ?? null,

    tap_reaction_to_first_move_mean: features.tapping?.reactionToFirstMove?.mean ?? null,
    tap_reaction_to_first_move_std: features.tapping?.reactionToFirstMove?.std ?? null,
    tap_reaction_to_first_move_median: features.tapping?.reactionToFirstMove?.median ?? null,
    tap_reaction_to_first_move_iqr: features.tapping?.reactionToFirstMove?.iqr ?? null,
    tap_reaction_to_first_move_p95: features.tapping?.reactionToFirstMove?.p95 ?? null,

    tap_reaction_to_click_mean: features.tapping?.reactionToClick?.mean ?? null,
    tap_reaction_to_click_std: features.tapping?.reactionToClick?.std ?? null,
    tap_reaction_to_click_median: features.tapping?.reactionToClick?.median ?? null,
    tap_reaction_to_click_iqr: features.tapping?.reactionToClick?.iqr ?? null,
    tap_reaction_to_click_p95: features.tapping?.reactionToClick?.p95 ?? null,

    tap_click_hold_mean: features.tapping?.clickHold?.mean ?? null,
    tap_click_hold_std: features.tapping?.clickHold?.std ?? null,
    tap_click_hold_median: features.tapping?.clickHold?.median ?? null,
    tap_click_hold_iqr: features.tapping?.clickHold?.iqr ?? null,
    tap_click_hold_p95: features.tapping?.clickHold?.p95 ?? null,

    tap_dist_to_center_mean: features.tapping?.distToCenter?.mean ?? null,
    tap_dist_to_center_std: features.tapping?.distToCenter?.std ?? null,
    tap_dist_to_center_median: features.tapping?.distToCenter?.median ?? null,
    tap_dist_to_center_iqr: features.tapping?.distToCenter?.iqr ?? null,
    tap_dist_to_center_p95: features.tapping?.distToCenter?.p95 ?? null,

    tap_nearest_dist_to_target_mean: features.tapping?.nearestDistToTarget?.mean ?? null,
    tap_nearest_dist_to_target_std: features.tapping?.nearestDistToTarget?.std ?? null,
    tap_nearest_dist_to_target_median: features.tapping?.nearestDistToTarget?.median ?? null,
    tap_nearest_dist_to_target_iqr: features.tapping?.nearestDistToTarget?.iqr ?? null,
    tap_nearest_dist_to_target_p95: features.tapping?.nearestDistToTarget?.p95 ?? null,

    tap_path_length_mean: features.tapping?.pathLength?.mean ?? null,
    tap_path_length_std: features.tapping?.pathLength?.std ?? null,
    tap_path_length_median: features.tapping?.pathLength?.median ?? null,
    tap_path_length_iqr: features.tapping?.pathLength?.iqr ?? null,
    tap_path_length_p95: features.tapping?.pathLength?.p95 ?? null,

    tap_mean_speed_mean: features.tapping?.meanSpeed?.mean ?? null,
    tap_mean_speed_std: features.tapping?.meanSpeed?.std ?? null,
    tap_mean_speed_median: features.tapping?.meanSpeed?.median ?? null,
    tap_mean_speed_iqr: features.tapping?.meanSpeed?.iqr ?? null,
    tap_mean_speed_p95: features.tapping?.meanSpeed?.p95 ?? null,

    tap_speed_var_mean: features.tapping?.speedVar?.mean ?? null,
    tap_speed_var_std: features.tapping?.speedVar?.std ?? null,
    tap_speed_var_median: features.tapping?.speedVar?.median ?? null,
    tap_speed_var_iqr: features.tapping?.speedVar?.iqr ?? null,
    tap_speed_var_p95: features.tapping?.speedVar?.p95 ?? null,

    tap_mean_accel_mean: features.tapping?.meanAccel?.mean ?? null,
    tap_mean_accel_std: features.tapping?.meanAccel?.std ?? null,
    tap_mean_accel_median: features.tapping?.meanAccel?.median ?? null,
    tap_mean_accel_iqr: features.tapping?.meanAccel?.iqr ?? null,
    tap_mean_accel_p95: features.tapping?.meanAccel?.p95 ?? null,

    tap_mean_abs_jerk_mean: features.tapping?.meanAbsJerk?.mean ?? null,
    tap_mean_abs_jerk_std: features.tapping?.meanAbsJerk?.std ?? null,
    tap_mean_abs_jerk_median: features.tapping?.meanAbsJerk?.median ?? null,
    tap_mean_abs_jerk_iqr: features.tapping?.meanAbsJerk?.iqr ?? null,
    tap_mean_abs_jerk_p95: features.tapping?.meanAbsJerk?.p95 ?? null,

    tap_straightness_ratio_mean: features.tapping?.straightnessRatio?.mean ?? null,
    tap_straightness_ratio_std: features.tapping?.straightnessRatio?.std ?? null,
    tap_straightness_ratio_median: features.tapping?.straightnessRatio?.median ?? null,
    tap_straightness_ratio_iqr: features.tapping?.straightnessRatio?.iqr ?? null,
    tap_straightness_ratio_p95: features.tapping?.straightnessRatio?.p95 ?? null,

    tap_micro_correction_count_mean: features.tapping?.microCorrectionCount?.mean ?? null,
    tap_micro_correction_count_std: features.tapping?.microCorrectionCount?.std ?? null,
    tap_micro_correction_count_median: features.tapping?.microCorrectionCount?.median ?? null,
    tap_micro_correction_count_iqr: features.tapping?.microCorrectionCount?.iqr ?? null,
    tap_micro_correction_count_p95: features.tapping?.microCorrectionCount?.p95 ?? null,

    tap_overshoot_count_mean: features.tapping?.overshootCount?.mean ?? null,
    tap_overshoot_count_std: features.tapping?.overshootCount?.std ?? null,
    tap_overshoot_count_median: features.tapping?.overshootCount?.median ?? null,
    tap_overshoot_count_iqr: features.tapping?.overshootCount?.iqr ?? null,
    tap_overshoot_count_p95: features.tapping?.overshootCount?.p95 ?? null,

    tap_hover_time_mean: features.tapping?.hoverTime?.mean ?? null,
    tap_hover_time_std: features.tapping?.hoverTime?.std ?? null,
    tap_hover_time_median: features.tapping?.hoverTime?.median ?? null,
    tap_hover_time_iqr: features.tapping?.hoverTime?.iqr ?? null,
    tap_hover_time_p95: features.tapping?.hoverTime?.p95 ?? null,

    tap_hover_samples_mean: features.tapping?.hoverSamples?.mean ?? null,
    tap_hover_samples_std: features.tapping?.hoverSamples?.std ?? null,
    tap_hover_samples_median: features.tapping?.hoverSamples?.median ?? null,
    tap_hover_samples_iqr: features.tapping?.hoverSamples?.iqr ?? null,
    tap_hover_samples_p95: features.tapping?.hoverSamples?.p95 ?? null,

    tap_idle_to_action_latency_mean: features.tapping?.idleToActionLatency?.mean ?? null,
    tap_idle_to_action_latency_std: features.tapping?.idleToActionLatency?.std ?? null,
    tap_idle_to_action_latency_median: features.tapping?.idleToActionLatency?.median ?? null,
    tap_idle_to_action_latency_iqr: features.tapping?.idleToActionLatency?.iqr ?? null,
    tap_idle_to_action_latency_p95: features.tapping?.idleToActionLatency?.p95 ?? null,

    tap_entered_target_before_hit_pct: features.tapping?.enteredTargetBeforeHitPct ?? null,

    tap_touch_radius_x_mean: features.tapping?.touchRadiusX?.mean ?? null,
    tap_touch_radius_x_std: features.tapping?.touchRadiusX?.std ?? null,
    tap_touch_radius_x_median: features.tapping?.touchRadiusX?.median ?? null,
    tap_touch_radius_x_iqr: features.tapping?.touchRadiusX?.iqr ?? null,
    tap_touch_radius_x_p95: features.tapping?.touchRadiusX?.p95 ?? null,

    tap_touch_radius_y_mean: features.tapping?.touchRadiusY?.mean ?? null,
    tap_touch_radius_y_std: features.tapping?.touchRadiusY?.std ?? null,
    tap_touch_radius_y_median: features.tapping?.touchRadiusY?.median ?? null,
    tap_touch_radius_y_iqr: features.tapping?.touchRadiusY?.iqr ?? null,
    tap_touch_radius_y_p95: features.tapping?.touchRadiusY?.p95 ?? null,

    tap_touch_force_mean: features.tapping?.touchForce?.mean ?? null,
    tap_touch_force_std: features.tapping?.touchForce?.std ?? null,
    tap_touch_force_median: features.tapping?.touchForce?.median ?? null,
    tap_touch_force_iqr: features.tapping?.touchForce?.iqr ?? null,
    tap_touch_force_p95: features.tapping?.touchForce?.p95 ?? null,

    tap_touch_area_mean: features.tapping?.touchArea?.mean ?? null,
    tap_touch_area_std: features.tapping?.touchArea?.std ?? null,
    tap_touch_area_median: features.tapping?.touchArea?.median ?? null,
    tap_touch_area_iqr: features.tapping?.touchArea?.iqr ?? null,
    tap_touch_area_p95: features.tapping?.touchArea?.p95 ?? null,

    tap_touch_aspect_ratio_mean: features.tapping?.touchAspectRatio?.mean ?? null,
    tap_touch_aspect_ratio_std: features.tapping?.touchAspectRatio?.std ?? null,
    tap_touch_aspect_ratio_median: features.tapping?.touchAspectRatio?.median ?? null,
    tap_touch_aspect_ratio_iqr: features.tapping?.touchAspectRatio?.iqr ?? null,
    tap_touch_aspect_ratio_p95: features.tapping?.touchAspectRatio?.p95 ?? null,

    tap_touch_rotation_angle_mean: features.tapping?.touchRotationAngle?.mean ?? null,
    tap_touch_rotation_angle_std: features.tapping?.touchRotationAngle?.std ?? null,
    tap_touch_rotation_angle_median: features.tapping?.touchRotationAngle?.median ?? null,
    tap_touch_rotation_angle_iqr: features.tapping?.touchRotationAngle?.iqr ?? null,
    tap_touch_rotation_angle_p95: features.tapping?.touchRotationAngle?.p95 ?? null,

    tap_pointer_move_count: features.tapping?.pointerMoveCount ?? null,
    tap_pointer_down_count: features.tapping?.pointerDownCount ?? null,
    tap_pointer_up_count: features.tapping?.pointerUpCount ?? null,
    tap_pointer_dist_entropy: features.tapping?.pointerDistEntropy ?? null,
    tap_pointer_angle_entropy: features.tapping?.pointerAngleEntropy ?? null,
    tap_pointer_speed_cv: features.tapping?.pointerSpeedCv ?? null,

    tap_near_miss_count: features.tapping?.nearMissCount ?? null,
    tap_near_miss_pct: features.tapping?.nearMissPct ?? null,

    tap_cadence_mean: features.tapping?.cadence?.mean ?? null,
    tap_cadence_std: features.tapping?.cadence?.std ?? null,
    tap_cadence_median: features.tapping?.cadence?.median ?? null,
    tap_cadence_iqr: features.tapping?.cadence?.iqr ?? null,
    tap_cadence_p95: features.tapping?.cadence?.p95 ?? null,

    tap_cv_cadence: features.tapping?.cvCadence ?? null,
    tap_burstiness_cadence: features.tapping?.burstinessCadence ?? null,
    tap_local_inconsistency_cadence:
      features.tapping?.localInconsistencyCadence ?? null,
    tap_early_late_rt_diff: features.tapping?.earlyLateRtDiff ?? null,
    tap_early_late_dist_diff: features.tapping?.earlyLateDistDiff ?? null
  };

  return row;
}

function authFeaturesToCSVRow(flatRow) {
  const cols = Object.keys(flatRow);
  const vals = cols.map((k) => csvEscapeFeature(flatRow[k]));
  return { header: cols.join(","), row: vals.join(",") };
}

// ---- analysis.ui.js ----

function renderSessionReport(containerEl, session) {
  containerEl.innerHTML = "";

  const summary = computeSummary(session);
  const features = computeSessionFeatures(session);
  const { valid, flags } = computeSessionFlags(session, features);

  containerEl.appendChild(sectionTitleFeature("Session Summary"));
  containerEl.appendChild(
    kvTableFeature([
      ["Schema version", summary?.schemaVersion],
      ["Session ID", summary?.sessionId],
      ["Participant ID", summary?.participantId],
      ["Session index", summary?.sessionIndex],
      ["Created (client ISO)", summary?.createdAtClientISO],
      ["Time bucket", summary?.timeBucket],
      ["Fatigue", summary?.fatigue],
      ["Input device", summary?.inputDevice],
      ["Vibration", summary?.vibration],
      ["Alcohol", summary?.alcohol],
      ["Typing score", summary?.typingScore],
      ["Typing attempts", summary?.typingAttempts],
      ["Typing correct", summary?.typingCorrect],
      ["Typing accuracy %", summary?.typingAccuracyPct],
      ["Tap hits", summary?.tapHits],
      ["Tap misses", summary?.tapMisses],
      ["Tap accuracy %", summary?.tapAccuracyPct],
      ["Total score", summary?.totalScore]
    ])
  );

  containerEl.appendChild(sectionTitleFeature("Recorded Data Overview"));
  containerEl.appendChild(
    kvTableFeature([
      ["Events recorded", Array.isArray(session?.events) ? session.events.length : 0],
      ["Rounds recorded", Array.isArray(session?.rounds) ? session.rounds.length : 0],
      ["Task summaries recorded", Array.isArray(session?.taskSummaries) ? session.taskSummaries.length : 0],
      ["Has device context", session?.device ? "yes" : "no"],
      ["Has context answers", session?.context ? "yes" : "no"],
      ["Has auth windows export inputs", session ? "yes" : "no"]
    ])
  );

  const eventCounts = countEventsByTypeFeature(session?.events);
  containerEl.appendChild(sectionTitleFeature("Event Counts By Type"));
  if (eventCounts.length) {
    containerEl.appendChild(kvTableFeature(eventCounts));
  } else {
    containerEl.appendChild(infoTextFeature("No events recorded."));
  }

  if (features?.typing) {
    containerEl.appendChild(sectionTitleFeature("Typing Features"));
    containerEl.appendChild(
      kvTableFeature([
        ["IKT global mean", features.typing.iktGlobal?.mean],
        ["IKT global std", features.typing.iktGlobal?.std],
        ["IKT global iqr", features.typing.iktGlobal?.iqr],
        ["IKT global p95", features.typing.iktGlobal?.p95],
        ["IKT within mean", features.typing.iktWithin?.mean],
        ["IKT within std", features.typing.iktWithin?.std],
        ["IKT within iqr", features.typing.iktWithin?.iqr],
        ["IKT within p95", features.typing.iktWithin?.p95],
        ["Accuracy %", features.typing?.accuracyPct],
        ["Drift IKT", features.typing?.driftIkt],
        ["Error recovery median", features.typing?.errorRecoveryWrong?.median]
      ])
    );
  }

  if (features?.tapping) {
    containerEl.appendChild(sectionTitleFeature("Tapping Features"));
    containerEl.appendChild(
      kvTableFeature([
        ["RT mean", features.tapping?.rt?.mean],
        ["RT std", features.tapping?.rt?.std],
        ["RT iqr", features.tapping?.rt?.iqr],
        ["RT p95", features.tapping?.rt?.p95],
        ["Miss rate %", features.tapping?.missRatePct],
        ["Drift RT", features.tapping?.driftRt],
        ["Error recovery median", features.tapping?.errorRecoveryMiss?.median]
      ])
    );
  }

  if (features?.coupling) {
    containerEl.appendChild(sectionTitleFeature("Cross-Task Coupling"));
    containerEl.appendChild(
      kvTableFeature([
        ["Variance IKT", features.coupling?.varIkt],
        ["Variance RT", features.coupling?.varRt],
        ["Variance ratio", features.coupling?.varRatio]
      ])
    );
  }

  containerEl.appendChild(sectionTitleFeature("Validity"));
  containerEl.appendChild(
    kvTableFeature([
      ["Valid", valid ? "yes" : "no"],
      ["Flags", (flags || []).length ? flags.join(", ") : "none"]
    ])
  );

  containerEl.appendChild(sectionTitleFeature("All Recorded Session Data (Raw JSON)"));
  containerEl.appendChild(
    detailsBlockFeature(
      "Expand full raw session object",
      prettyJsonFeature(session)
    )
  );

  containerEl.appendChild(sectionTitleFeature("All Derived Analysis Data (Raw JSON)"));
  containerEl.appendChild(
    detailsBlockFeature(
      "Expand summary + features + validity",
      prettyJsonFeature({
        summary,
        features,
        validity: {
          valid,
          flags
        }
      })
    )
  );
}

function sectionTitleFeature(text) {
  const h = document.createElement("h3");
  h.className = "data-section-title";
  h.textContent = text;
  return h;
}

function infoTextFeature(text) {
  const p = document.createElement("p");
  p.className = "muted";
  p.textContent = text;
  return p;
}

function fmtValueFeature(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return formatNumberFeature(v);
  return String(v);
}

function formatNumberFeature(v) {
  if (!Number.isFinite(v)) return String(v);
  if (Number.isInteger(v)) return String(v);
  return Number(v.toFixed(3)).toString();
}

function kvTableFeature(rows) {
  const table = document.createElement("table");
  const tbody = document.createElement("tbody");

  rows.forEach(([k, v]) => {
    const tr = document.createElement("tr");

    const tdK = document.createElement("td");
    tdK.textContent = String(k);

    const tdV = document.createElement("td");
    tdV.textContent = fmtValueFeature(v);

    tr.appendChild(tdK);
    tr.appendChild(tdV);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  return table;
}

function countEventsByTypeFeature(events) {
  if (!Array.isArray(events) || !events.length) return [];

  const counts = new Map();
  for (const ev of events) {
    const key = ev?.t || ev?.type || "unknown";
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return Array.from(counts.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return String(a[0]).localeCompare(String(b[0]));
  });
}

function detailsBlockFeature(summaryText, bodyText) {
  const details = document.createElement("details");
  details.style.marginTop = "10px";

  const summary = document.createElement("summary");
  summary.textContent = summaryText;
  summary.style.cursor = "pointer";
  summary.style.fontWeight = "600";
  summary.style.marginBottom = "10px";

  const pre = document.createElement("pre");
  pre.textContent = bodyText;
  pre.style.whiteSpace = "pre-wrap";
  pre.style.wordBreak = "break-word";
  pre.style.overflowX = "auto";
  pre.style.padding = "12px";
  pre.style.marginTop = "10px";
  pre.style.background = "#f7f8fb";
  pre.style.border = "1px solid #e2e6ef";
  pre.style.borderRadius = "8px";
  pre.style.fontSize = "12px";
  pre.style.lineHeight = "1.45";

  details.appendChild(summary);
  details.appendChild(pre);
  return details;
}

function prettyJsonFeature(obj) {
  try {
    return JSON.stringify(obj ?? {}, null, 2);
  } catch (err) {
    return JSON.stringify(
      {
        error: "Failed to stringify object",
        message: err?.message || String(err)
      },
      null,
      2
    );
  }
}

// ==========================
// Utilities
// ==========================
const nowMs = () => performance.now();
const rand = (n) => Math.floor(Math.random() * n);

function hasUsableLocalStorage() {
  try {
    const testKey = "__bb_storage_test__";
    const testValue = String(Date.now());

    localStorage.setItem(testKey, testValue);
    const readBack = localStorage.getItem(testKey);
    localStorage.removeItem(testKey);

    return readBack === testValue;
  } catch (err) {
    return false;
  }
}

function enforceSupportedBrowserMode() {
  if (hasUsableLocalStorage()) return true;

  alert(
    "This study must be opened in a normal browser tab, not private/incognito mode. Please reopen it in Safari or Chrome outside private browsing."
  );

  window.location.href = "open.html";
  return false;
}

const makeId = () => {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID().replace(/-/g, "");
  }

  const cryptoObj = globalThis.crypto || globalThis.msCrypto;
  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoObj.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

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
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
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
let lastLetterKeyDownForBigram = null;
let iktSumMs = 0;
let iktCount = 0;
let wordDiffSum = 0;
let submitLocked = false;

// tapping state
let tapStimulusMs = null;
let rtSum = 0;
let tappingListenersAttached = false;
let tappingRoundStartMs = null;

// pointer / tapping state
let pointerInsideArena = false;
let pointerIsDown = false;
let pointerDownMs = null;
let pointerDownPos = null;
let lastMove = null;
let activeStimulus = null;
let tapArenaEl = null;
let pendingHitPointerUp = false;

// ==========================
// Session helpers
// ==========================
function newSession() {
  const count = Number(localStorage.getItem("sessionCount") || 0) + 1;
  localStorage.setItem("sessionCount", String(count));

  return {
    schemaVersion: 3,
    featureSchema: "rich_keyboard_pointer_v1",
    sessionId: makeId(),
    sessionIndex: count,
    participantId: localStorage.getItem("participantId"),
    displayName: localStorage.getItem("displayName"),
    createdAtClientISO: new Date().toISOString(),
    context: {},
    device: {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      screen: {
        w: screen.width,
        h: screen.height,
        dpr: window.devicePixelRatio
      },
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
        reactionMs: null,
        accuracyPct: 0
      },
      tapping: {
        score: 0,
        hits: 0,
        misses: 0,
        rtCount: 0,
        meanRtMs: null,
        accuracyPct: 0
      }
    },
    events: []
  };
}

function inferDeviceFamily(sessionObj) {
  const ua = String(sessionObj?.device?.userAgent || "").toLowerCase();
  if (ua.includes("ipad") || ua.includes("tablet")) return "tablet";
  if (ua.includes("mobile") || ua.includes("android") || ua.includes("iphone")) return "mobile";
  return "desktop";
}

function inWindowMs(ms, w) {
  return Number.isFinite(ms) && ms >= w.startMs && ms <= w.endMs;
}

function windowEventCounts(events, w) {
  const inW = events.filter((e) => inWindowMs(Number(e?.ms), w));

  const nKeyLegacy = inW.filter((e) => e?.t === "key").length;
  const nKeyDown = inW.filter((e) => e?.t === "key_down").length;
  const nKeyUp = inW.filter((e) => e?.t === "key_up").length;

  const nTapHits = inW.filter((e) => e?.t === "tap_hit").length;
  const nTapMisses = inW.filter((e) => e?.t === "tap_miss").length;

  const nPointerMove = inW.filter((e) => e?.t === "pointer_move").length;
  const nPointerDown = inW.filter((e) => e?.t === "pointer_down").length;
  const nPointerUp = inW.filter((e) => e?.t === "pointer_up").length;

  const n_key_events = nKeyDown > 0 ? nKeyDown : nKeyLegacy;

  return {
    n_key_events,
    n_key_events_legacy: nKeyLegacy,
    n_key_down_events: nKeyDown,
    n_key_up_events: nKeyUp,
    n_tap_hits: nTapHits,
    n_tap_misses: nTapMisses,
    n_pointer_move_events: nPointerMove,
    n_pointer_down_events: nPointerDown,
    n_pointer_up_events: nPointerUp
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

// ==========================
// Identity Bootstrap Logic
// ==========================
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
  consentCheckbox: () => el("consentCheckbox"),
  privateBrowserCheckbox: () => el("privateBrowserCheckbox"),
  btnConsentNext: () => el("btnConsentNext"),

  fatigue: () => el("fatigue"),
  fatigueVal: () => el("fatigueVal"),
  inputDevice: () => el("inputDevice"),
  vibration: () => el("vibration"),
  alcohol: () => el("alcohol"),
  btnContextNext: () => el("btnContextNext"),

  typingTime: () => el("typingTime"),
  typingScore: () => el("typingScore"),
  typingAttempts: () => el("typingAttempts"),
  typingAccuracy: () => el("typingAccuracy"),
  wordPrompt: () => el("wordPrompt"),
  wordInput: () => el("wordInput"),

  tappingTime: () => el("tapTime"),
  tapHits: () => el("tapHits"),
  tapMisses: () => el("tapMisses"),
  tapAccuracy: () => el("tapAccuracy"),
  tapTarget: () => el("tapTarget"),
  tapArena: () => el("tapArena"),

  resTyping: () => el("resTyping"),
  resTypingAcc: () => el("resTypingAcc"),
  resTap: () => el("resTap"),
  resTapAcc: () => el("resTapAcc"),
  resTotal: () => el("resTotal"),
  uploadStatus: () => el("uploadStatus"),
  pidDisplay: () => el("pidDisplay"),
  btnCopyPid: () => el("btnCopyPid"),
  sessionCountDisplay: () => el("sessionCountDisplay"),
  btnSessionCompleteContinue: () => el("btnSessionCompleteContinue"),
  btnRestart: () => el("btnRestart"),
  btnGoToDataOnFail: () => el("btnGoToDataOnFail"),

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
  if (!enforceSupportedBrowserMode()) return;

  UI.fatigueVal().textContent = UI.fatigue().value;
  UI.fatigue().addEventListener("input", () => {
    UI.fatigueVal().textContent = UI.fatigue().value;
  });

  bindConsent();
  bindContext();
  bindTypingUI();
  bindCompleteUI();
  bindResultsUI();
  bindDataUI();
});

// ==========================
// Consent
// ==========================
function bindConsent() {
  const consentCb = UI.consentCheckbox();
  const privateCb = UI.privateBrowserCheckbox();
  const btn = UI.btnConsentNext();

  function refreshButtonState() {
    btn.disabled = !(consentCb.checked && privateCb.checked);
  }

  refreshButtonState();

  consentCb.addEventListener("change", refreshButtonState);
  privateCb.addEventListener("change", refreshButtonState);

  btn.addEventListener("click", async () => {
    try {
      UI.uploadStatus().textContent = "";
      const { participantId } = await ensureIdentity();
      UI.pidDisplay().value = participantId;
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
  document.querySelectorAll("[data-time]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-time]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedTime = btn.dataset.time;
    });
  });

  UI.btnContextNext().addEventListener("click", () => {
    if (!selectedTime) {
      alert("Pick a time of day");
      return;
    }

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

    UI.typingScore().textContent = "0";
    UI.typingAttempts().textContent = "0";
    UI.typingAccuracy().textContent = "0%";

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
  const KEYBOARD_LAYOUT = {
    q: { row: 0, col: 0, hand: "L" },
    w: { row: 0, col: 1, hand: "L" },
    e: { row: 0, col: 2, hand: "L" },
    r: { row: 0, col: 3, hand: "L" },
    t: { row: 0, col: 4, hand: "L" },
    y: { row: 0, col: 5, hand: "R" },
    u: { row: 0, col: 6, hand: "R" },
    i: { row: 0, col: 7, hand: "R" },
    o: { row: 0, col: 8, hand: "R" },
    p: { row: 0, col: 9, hand: "R" },

    a: { row: 1, col: 0.5, hand: "L" },
    s: { row: 1, col: 1.5, hand: "L" },
    d: { row: 1, col: 2.5, hand: "L" },
    f: { row: 1, col: 3.5, hand: "L" },
    g: { row: 1, col: 4.5, hand: "L" },
    h: { row: 1, col: 5.5, hand: "R" },
    j: { row: 1, col: 6.5, hand: "R" },
    k: { row: 1, col: 7.5, hand: "R" },
    l: { row: 1, col: 8.5, hand: "R" },

    z: { row: 2, col: 1, hand: "L" },
    x: { row: 2, col: 2, hand: "L" },
    c: { row: 2, col: 3, hand: "L" },
    v: { row: 2, col: 4, hand: "L" },
    b: { row: 2, col: 5, hand: "L" },
    n: { row: 2, col: 6, hand: "R" },
    m: { row: 2, col: 7, hand: "R" }
  };

  const SPECIAL_KEYS = {
    Backspace: { code: "BACKSPACE", row: 1, col: 10, hand: "R" },
    Enter: { code: "ENTER", row: 2, col: 9.5, hand: "R" },
    Space: { code: "SPACE", row: 3, col: 4.5, hand: "B" }
  };

  const NON_BEHAVIOURAL_KEYS = new Set([
    "Shift",
    "Alt",
    "Meta",
    "Control",
    "CapsLock",
    "Tab",
    "Escape",
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown"
  ]);

  const activeKeydowns = new Map();
  let lastBehavioralKeyDown = null;
  let lastBehavioralKeyUp = null;
  let backspaceBurst = 0;

  function normaliseKey(key) {
    if (typeof key !== "string") return null;
    if (key === " ") return "Space";
    if (key.length === 1) {
      const lower = key.toLowerCase();
      if (/^[a-z]$/.test(lower)) return lower;
      return "CHAR_OTHER";
    }
    if (key === "Backspace" || key === "Enter" || key === "Space") return key;
    return key;
  }

  function keyMotorMeta(key) {
    const nk = normaliseKey(key);
    if (!nk) {
      return {
        keyClass: "unknown",
        keyCodeClass: "UNKNOWN",
        row: null,
        col: null,
        hand: null,
        isLetter: false,
        isSpecial: false
      };
    }

    if (SPECIAL_KEYS[nk]) {
      return {
        keyClass: nk.toLowerCase(),
        keyCodeClass: SPECIAL_KEYS[nk].code,
        row: SPECIAL_KEYS[nk].row,
        col: SPECIAL_KEYS[nk].col,
        hand: SPECIAL_KEYS[nk].hand,
        isLetter: false,
        isSpecial: true
      };
    }

    if (KEYBOARD_LAYOUT[nk]) {
      return {
        keyClass: nk,
        keyCodeClass: "LETTER",
        row: KEYBOARD_LAYOUT[nk].row,
        col: KEYBOARD_LAYOUT[nk].col,
        hand: KEYBOARD_LAYOUT[nk].hand,
        isLetter: true,
        isSpecial: false
      };
    }

    return {
      keyClass: nk === "CHAR_OTHER" ? "char_other" : "other",
      keyCodeClass: nk === "CHAR_OTHER" ? "CHAR_OTHER" : "OTHER",
      row: null,
      col: null,
      hand: null,
      isLetter: false,
      isSpecial: false
    };
  }

  function keyboardDistance(a, b) {
    if (
      !a || !b ||
      !Number.isFinite(a.row) || !Number.isFinite(a.col) ||
      !Number.isFinite(b.row) || !Number.isFinite(b.col)
    ) {
      return null;
    }
    const dr = a.row - b.row;
    const dc = a.col - b.col;
    return Number(Math.sqrt(dr * dr + dc * dc).toFixed(3));
  }

  function transitionMeta(prevMeta, currMeta) {
    const dist = keyboardDistance(prevMeta, currMeta);
    return {
      transition_distance: dist,
      same_hand: prevMeta?.hand && currMeta?.hand ? prevMeta.hand === currMeta.hand : null,
      cross_hand: prevMeta?.hand && currMeta?.hand ? prevMeta.hand !== currMeta.hand : null,
      same_row:
        Number.isFinite(prevMeta?.row) && Number.isFinite(currMeta?.row)
          ? prevMeta.row === currMeta.row
          : null,
      row_change:
        Number.isFinite(prevMeta?.row) && Number.isFinite(currMeta?.row)
          ? prevMeta.row !== currMeta.row
          : null,
      adjacent_key: Number.isFinite(dist) ? dist <= 1.5 : null,
      far_key: Number.isFinite(dist) ? dist >= 4.0 : null
    };
  }

  function keyToken(e, nk) {
    return e.code || `${nk}_${e.key}`;
  }

  UI.wordInput().addEventListener("keydown", (e) => {
    if (!session) return;
    if (NON_BEHAVIOURAL_KEYS.has(e.key)) return;
    if (e.repeat) return;

    const t = nowMs();
    const nk = normaliseKey(e.key);
    const keyMeta = keyMotorMeta(e.key);

    if (!firstKeyLogged) {
      const rt = Math.round(t - typingRoundStartMs);
      session.rounds.typing.reactionMs = rt;
      logEvent("typing_reaction", { rt });
      firstKeyLogged = true;
    }

    let pressToPressMs = null;
    let releaseToPressMs = null;
    let prevMeta = null;

    if (lastBehavioralKeyDown) {
      pressToPressMs = Math.round(t - lastBehavioralKeyDown.ms);
      prevMeta = lastBehavioralKeyDown.meta;
    }

    if (lastBehavioralKeyUp) {
      releaseToPressMs = Math.round(t - lastBehavioralKeyUp.ms);
      if (!prevMeta) prevMeta = lastBehavioralKeyUp.meta;
    }

    if (lastKeyDownMs != null) {
      const ikt = t - lastKeyDownMs;
      const clipped = Math.min(ikt, 2000);
      iktSumMs += clipped;
      iktCount += 1;
    }
    lastKeyDownMs = t;

    keyIndexInWord += 1;
    session.rounds.typing.keyCount += 1;

    if (nk === "Backspace") {
      session.rounds.typing.backspaces += 1;
      backspaceBurst += 1;
      lastLetterKeyDownForBigram = null;
    } else {
      backspaceBurst = 0;
    }

    const transition = transitionMeta(prevMeta, keyMeta);

    activeKeydowns.set(keyToken(e, nk), {
      ms: t,
      meta: keyMeta,
      nk
    });

    logEvent("key_down", {
      key_class: keyMeta.keyClass,
      key_code_class: keyMeta.keyCodeClass,
      key_is_letter: keyMeta.isLetter,
      key_is_special: keyMeta.isSpecial,
      row: keyMeta.row,
      col: keyMeta.col,
      hand: keyMeta.hand,
      pos: keyIndexInWord,
      press_to_press_ms: pressToPressMs,
      release_to_press_ms: releaseToPressMs,
      backspace_burst_len: nk === "Backspace" ? backspaceBurst : 0,
      hesitation_pause: Number.isFinite(pressToPressMs) ? pressToPressMs >= 750 : null,
      ...transition
    });

    if (
      keyMeta.isLetter &&
      lastLetterKeyDownForBigram &&
      lastLetterKeyDownForBigram.meta?.isLetter
    ) {
      const prev = lastLetterKeyDownForBigram;
      const bigramTransition = transitionMeta(prev.meta, keyMeta);

      logEvent("typing_bigram", {
        bigram: `${prev.char}${nk}`,
        bigram_first: prev.char,
        bigram_second: nk,
        bigram_pos_second: keyIndexInWord,
        wordId: currentWord?.id ?? null,
        wordLen: currentWord?.len ?? null,
        press_to_press_ms: Math.round(t - prev.ms),
        release_to_press_ms:
          Number.isFinite(prev.upMs) ? Math.round(t - prev.upMs) : null,
        first_row: prev.meta.row,
        first_col: prev.meta.col,
        first_hand: prev.meta.hand,
        second_row: keyMeta.row,
        second_col: keyMeta.col,
        second_hand: keyMeta.hand,
        ...bigramTransition
      });
    }

    logEvent("key", {
      k: e.key === "Backspace" ? "B" : e.key === "Enter" ? "E" : "K",
      pos: keyIndexInWord
    });

    lastBehavioralKeyDown = {
      ms: t,
      meta: keyMeta,
      nk
    };

    if (keyMeta.isLetter) {
      lastLetterKeyDownForBigram = {
        char: nk,
        ms: t,
        upMs: null,
        meta: keyMeta
      };
    }

    if (e.key === "Enter") {
      e.preventDefault();
      submitWord("enter");
    }
  });

  UI.wordInput().addEventListener("keyup", (e) => {
    if (!session) return;
    if (NON_BEHAVIOURAL_KEYS.has(e.key)) return;
    if (e.repeat) return;

    const t = nowMs();
    const nk = normaliseKey(e.key);
    const keyMeta = keyMotorMeta(e.key);
    const active = activeKeydowns.get(keyToken(e, nk)) || null;

    let dwellMs = null;
    if (active && Number.isFinite(active.ms)) {
      dwellMs = Math.round(t - active.ms);
      activeKeydowns.delete(keyToken(e, nk));
    }

    logEvent("key_up", {
      key_class: keyMeta.keyClass,
      key_code_class: keyMeta.keyCodeClass,
      key_is_letter: keyMeta.isLetter,
      key_is_special: keyMeta.isSpecial,
      row: keyMeta.row,
      col: keyMeta.col,
      hand: keyMeta.hand,
      dwell_ms: dwellMs,
      pos: keyIndexInWord
    });

    lastBehavioralKeyUp = {
      ms: t,
      meta: keyMeta,
      nk
    };

    if (
      keyMeta.isLetter &&
      lastLetterKeyDownForBigram &&
      lastLetterKeyDownForBigram.char === nk &&
      lastLetterKeyDownForBigram.upMs == null
    ) {
      lastLetterKeyDownForBigram.upMs = t;
    }
  });

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

  window._typingDebug = {
    clearActiveKeys: () => activeKeydowns.clear()
  };
}

function startTypingRound() {
  clearTimers();

  setScreen("screen-typing");

  typingRoundStartMs = nowMs();
  firstKeyLogged = false;
  keyIndexInWord = 0;
  currentWord = null;
  lastKeyDownMs = null;
  lastLetterKeyDownForBigram = null;

  iktSumMs = 0;
  iktCount = 0;
  wordDiffSum = 0;
  submitLocked = false;

  UI.typingTime().textContent = "60.0";
  UI.typingScore().textContent = "0";
  UI.typingAttempts().textContent = "0";
  UI.typingAccuracy().textContent = "0%";

  nextWord();
  setTimeout(() => UI.wordInput().focus(), 50);

  typingTickInterval = setInterval(() => {
    const left = Math.max(0, 60000 - (nowMs() - typingRoundStartMs));
    UI.typingTime().textContent = (left / 1000).toFixed(1);
  }, 100);

  typingEndTimeout = setTimeout(endTypingRound, 60000);
}

function nextWord() {
  const text = TYPING_WORD_POOL[rand(TYPING_WORD_POOL.length)];
  const idx = WORDS.indexOf(text);
  currentWord = { word: text, id: idx, len: text.length };

  UI.wordPrompt().textContent = currentWord.word;
  UI.wordInput().value = "";
  keyIndexInWord = 0;
  firstKeyLogged = false;
  lastKeyDownMs = null;
  lastLetterKeyDownForBigram = null;

  logEvent("word_shown", {
    wordId: currentWord.id,
    wordLen: currentWord.len
  });
}

function submitWord(reason) {
  if (!session || !currentWord || submitLocked) return;

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
        ? Math.round((session.rounds.typing.correct / session.rounds.typing.attempts) * 100)
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
      scoreInc: inc,
      typed: typed
    });

    if (ok) {
      nextWord();
    } else {
      UI.wordInput().focus();
    }
  } finally {
    setTimeout(() => {
      submitLocked = false;
    }, 0);
  }
}

function endTypingRound() {
  clearInterval(typingTickInterval);
  clearTimeout(typingEndTimeout);

  logEvent("typing_end", {
    elapsedMs: Math.round(nowMs() - typingRoundStartMs)
  });

  setScreen("screen-tapping");
  UI.tappingTime().textContent = "60.0";

  setTimeout(() => {
    try {
      startTappingRound();
    } catch (err) {
      console.error("Transition to tapping failed:", err);
      alert(`Transition to tapping failed: ${err?.message || err}`);
    }
  }, 50);
}

// ==========================
// Tapping game
// ==========================
function computeTapScore(tap) {
  return Math.max(0, (tap?.hits || 0) - (tap?.misses || 0));
}

function updateTapAccuracy() {
  if (!session) return;

  const tap = session.rounds.tapping;
  const total = (tap.hits || 0) + (tap.misses || 0);
  const acc = total ? Math.round((100 * (tap.hits || 0)) / total) : 0;

  tap.accuracyPct = acc;
  UI.tapAccuracy().textContent = `${acc}%`;
}

function variance(xs) {
  const clean = xs.filter((x) => typeof x === "number" && Number.isFinite(x));
  if (!clean.length) return 0;
  const mean = clean.reduce((a, b) => a + b, 0) / clean.length;
  return clean.reduce((a, b) => a + (b - mean) ** 2, 0) / clean.length;
}

function getTapArenaEl() {
  return UI.tapArena();
}

function getArenaPoint(evt) {
  const arenaEl = getTapArenaEl();
  const rect = arenaEl.getBoundingClientRect();
  const x = evt.clientX - rect.left;
  const y = evt.clientY - rect.top;

  return {
    x: Number(x.toFixed(2)),
    y: Number(y.toFixed(2)),
    arenaW: Number(rect.width.toFixed(2)),
    arenaH: Number(rect.height.toFixed(2))
  };
}

function getTargetGeometry() {
  const arenaEl = getTapArenaEl();
  const arenaRect = arenaEl.getBoundingClientRect();
  const rect = UI.tapTarget().getBoundingClientRect();

  const left = rect.left - arenaRect.left;
  const top = rect.top - arenaRect.top;
  const width = rect.width;
  const height = rect.height;
  const cx = left + width / 2;
  const cy = top + height / 2;

  return {
    target_left: Number(left.toFixed(2)),
    target_top: Number(top.toFixed(2)),
    target_w: Number(width.toFixed(2)),
    target_h: Number(height.toFixed(2)),
    target_cx: Number(cx.toFixed(2)),
    target_cy: Number(cy.toFixed(2)),
    target_r: Number((Math.min(width, height) / 2).toFixed(2))
  };
}

function distToTargetCenter(pt, geom) {
  if (!pt || !geom) return null;
  return Number(
    Math.sqrt((pt.x - geom.target_cx) ** 2 + (pt.y - geom.target_cy) ** 2).toFixed(3)
  );
}

function resetStimulusTracking(stimulusMs) {
  activeStimulus = {
    stimulusMs,
    firstMoveMs: null,
    firstMoveLatencyMs: null,
    hoverEnterMs: null,
    hoverTimeMs: 0,
    hoverSamples: 0,
    pathLength: 0,
    moveCount: 0,
    microCorrections: 0,
    overshootCount: 0,
    angles: [],
    segmentSpeeds: [],
    segmentAccels: [],
    segmentJerks: [],
    lastAngle: null,
    nearestDistance: null,
    enteredTargetBeforeHit: false,
    downInsideTarget: false
  };
  lastMove = null;
}

function startHoverIfNeeded(pt, geom, ms) {
  if (!activeStimulus || !pt || !geom) return;

  const d = distToTargetCenter(pt, geom);
  if (d === null) return;

  const nearThreshold = Math.max(geom.target_r * 1.35, geom.target_r + 10);
  if (d <= nearThreshold) {
    activeStimulus.hoverSamples += 1;
    if (activeStimulus.hoverEnterMs == null) {
      activeStimulus.hoverEnterMs = ms;
    }
  } else if (activeStimulus.hoverEnterMs != null) {
    activeStimulus.hoverTimeMs += ms - activeStimulus.hoverEnterMs;
    activeStimulus.hoverEnterMs = null;
  }
}

function closeHoverIfOpen(ms) {
  if (!activeStimulus) return;
  if (activeStimulus.hoverEnterMs != null) {
    activeStimulus.hoverTimeMs += ms - activeStimulus.hoverEnterMs;
    activeStimulus.hoverEnterMs = null;
  }
}

const TARGET_SIZE_OPTIONS = [
  { label: "small", radius: 18 },
  { label: "medium", radius: 24 },
  { label: "large", radius: 30 }
];

function sampleTargetSize() {
  return TARGET_SIZE_OPTIONS[rand(TARGET_SIZE_OPTIONS.length)];
}

function moveTarget() {
  const arena = getTapArenaEl();
  const target = UI.tapTarget();

  const arenaRect = arena.getBoundingClientRect();

  const sizeSpec = sampleTargetSize();
  const diameter = sizeSpec.radius * 2;

  target.style.width = `${diameter}px`;
  target.style.height = `${diameter}px`;

  const targetW = diameter;
  const targetH = diameter;

  const maxX = Math.max(0, arenaRect.width - targetW);
  const maxY = Math.max(0, arenaRect.height - targetH);

  const x = Math.random() * maxX;
  const y = Math.random() * maxY;

  target.style.left = `${x}px`;
  target.style.top = `${y}px`;

  tapStimulusMs = nowMs();
  resetStimulusTracking(tapStimulusMs);

  const geom = getTargetGeometry();
  logEvent("target_move", {
    xPx: Number(x.toFixed(2)),
    yPx: Number(y.toFixed(2)),
    target_size_label: sizeSpec.label,
    target_radius_px: sizeSpec.radius,
    target_diameter_px: diameter,
    ...geom,
    stimulus_ms: Math.round(tapStimulusMs)
  });
}

function finishTapAttempt(kind, evt) {
  if (!session || tapStimulusMs == null) return;

  const ms = Math.round(nowMs());
  const pt = getArenaPoint(evt);
  const geom = getTargetGeometry();
  const rt = Math.round(ms - tapStimulusMs);

  closeHoverIfOpen(ms);

  const dCenter = distToTargetCenter(pt, geom);
  const firstMoveLatencyMs = activeStimulus?.firstMoveLatencyMs ?? null;
  const clickHoldMs =
    Number.isFinite(pointerDownMs) ? Math.max(0, ms - pointerDownMs) : null;

  const pathLength = activeStimulus
    ? Number(activeStimulus.pathLength.toFixed(3))
    : null;

  const straightness =
    Number.isFinite(pathLength) && pathLength > 0 && pointerDownPos
      ? Number(
          (
            Math.sqrt((pt.x - pointerDownPos.x) ** 2 + (pt.y - pointerDownPos.y) ** 2) / pathLength
          ).toFixed(6)
        )
      : null;

  const nearMiss =
    kind === "miss" && Number.isFinite(dCenter) && dCenter <= geom.target_r * 1.75;

  const touchMetrics = getTouchContactMetrics(evt);

  const payload = {
    rt,
    x: pt.x,
    y: pt.y,
    ...touchMetrics,
    click_hold_ms: clickHoldMs,
    dist_to_target_center: dCenter,
    target_cx: geom.target_cx,
    target_cy: geom.target_cy,
    target_r: geom.target_r,
    reaction_to_first_move_ms: firstMoveLatencyMs,
    reaction_to_click_ms: rt,
    hover_time_ms: activeStimulus ? Math.round(activeStimulus.hoverTimeMs) : null,
    hover_samples: activeStimulus?.hoverSamples ?? 0,
    path_length: pathLength,
    move_count: activeStimulus?.moveCount ?? 0,
    mean_speed:
      activeStimulus?.segmentSpeeds?.length
        ? Number(
            (
              activeStimulus.segmentSpeeds.reduce((a, b) => a + b, 0) /
              activeStimulus.segmentSpeeds.length
            ).toFixed(6)
          )
        : null,
    speed_var:
      activeStimulus?.segmentSpeeds?.length >= 2
        ? Number(variance(activeStimulus.segmentSpeeds).toFixed(8))
        : null,
    mean_accel:
      activeStimulus?.segmentAccels?.length
        ? Number(
            (
              activeStimulus.segmentAccels.reduce((a, b) => a + b, 0) /
              activeStimulus.segmentAccels.length
            ).toFixed(8)
          )
        : null,
    mean_abs_jerk:
      activeStimulus?.segmentJerks?.length
        ? Number(
            (
              activeStimulus.segmentJerks.map(Math.abs).reduce((a, b) => a + b, 0) /
              activeStimulus.segmentJerks.length
            ).toFixed(10)
          )
        : null,
    straightness_ratio: straightness,
    micro_correction_count: activeStimulus?.microCorrections ?? 0,
    overshoot_count: activeStimulus?.overshootCount ?? 0,
    idle_to_action_latency_ms: firstMoveLatencyMs,
    near_miss: nearMiss,
    entered_target_before_hit: activeStimulus?.enteredTargetBeforeHit ?? false,
    nearest_distance_to_target: activeStimulus?.nearestDistance ?? null
  };

  if (kind === "hit") {
    rtSum += rt;
    session.rounds.tapping.hits += 1;
    session.rounds.tapping.rtCount += 1;
    session.rounds.tapping.score = computeTapScore(session.rounds.tapping);

    UI.tapHits().textContent = String(session.rounds.tapping.hits);
    updateTapAccuracy();
    logEvent("tap_hit", payload);
  } else {
    session.rounds.tapping.misses += 1;
    session.rounds.tapping.score = computeTapScore(session.rounds.tapping);

    UI.tapMisses().textContent = String(session.rounds.tapping.misses);
    updateTapAccuracy();
    logEvent("tap_miss", payload);
  }

  pointerDownMs = null;
  pointerDownPos = null;
  pointerIsDown = false;
  activeStimulus = null;
  lastMove = null;

  if (kind === "hit") {
    moveTarget();
  }
}

function handlePointerMove(evt) {
  if (!session || tapStimulusMs == null) return;

  const ms = Math.round(nowMs());
  const pt = getArenaPoint(evt);
  const geom = getTargetGeometry();

  if (!activeStimulus) {
    resetStimulusTracking(tapStimulusMs);
  }

  if (activeStimulus.firstMoveMs == null) {
    activeStimulus.firstMoveMs = ms;
    activeStimulus.firstMoveLatencyMs = ms - Math.round(tapStimulusMs);
  }

  const dCenter = distToTargetCenter(pt, geom);

  if (activeStimulus.nearestDistance == null || dCenter < activeStimulus.nearestDistance) {
    activeStimulus.nearestDistance = dCenter;
  }

  if (dCenter <= geom.target_r) {
    activeStimulus.enteredTargetBeforeHit = true;
  }

  if (lastMove) {
    const dt = ms - lastMove.ms;
    const dx = pt.x - lastMove.x;
    const dy = pt.y - lastMove.y;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    const speed = dt > 0 ? segLen / dt : null;
    const ang = Number((Math.atan2(dy, dx) * 180 / Math.PI).toFixed(3));

    activeStimulus.pathLength += segLen;
    activeStimulus.moveCount += 1;

    if (Number.isFinite(speed)) {
      activeStimulus.segmentSpeeds.push(speed);
    }

    if (Number.isFinite(speed) && activeStimulus.segmentSpeeds.length >= 2) {
      const prevSpeed = activeStimulus.segmentSpeeds[activeStimulus.segmentSpeeds.length - 2];
      const accel = dt > 0 ? (speed - prevSpeed) / dt : null;

      if (Number.isFinite(accel)) {
        activeStimulus.segmentAccels.push(accel);

        if (activeStimulus.segmentAccels.length >= 2) {
          const prevAccel = activeStimulus.segmentAccels[activeStimulus.segmentAccels.length - 2];
          const jerk = dt > 0 ? (accel - prevAccel) / dt : null;
          if (Number.isFinite(jerk)) activeStimulus.segmentJerks.push(jerk);
        }
      }
    }

    if (Number.isFinite(ang)) {
      activeStimulus.angles.push(ang);

      if (activeStimulus.lastAngle != null) {
        let delta = Math.abs(ang - activeStimulus.lastAngle);
        if (delta > 180) delta = 360 - delta;

        if (delta >= 25) activeStimulus.microCorrections += 1;
        if (delta >= 75) activeStimulus.overshootCount += 1;
      }

      activeStimulus.lastAngle = ang;
    }

    logEvent("pointer_move", {
      x: pt.x,
      y: pt.y,
      dx: Number(dx.toFixed(3)),
      dy: Number(dy.toFixed(3)),
      dt_move_ms: dt,
      seg_len: Number(segLen.toFixed(3)),
      speed: Number.isFinite(speed) ? Number(speed.toFixed(6)) : null,
      angle_deg: ang,
      dist_to_target_center: dCenter,
      target_cx: geom.target_cx,
      target_cy: geom.target_cy,
      ...getTouchContactMetrics(evt)
    });
  } else {
    logEvent("pointer_move", {
      x: pt.x,
      y: pt.y,
      dx: null,
      dy: null,
      dt_move_ms: null,
      seg_len: null,
      speed: null,
      angle_deg: null,
      dist_to_target_center: dCenter,
      target_cx: geom.target_cx,
      target_cy: geom.target_cy,
      ...getTouchContactMetrics(evt)
    });
  }

  startHoverIfNeeded(pt, geom, ms);
  lastMove = { ...pt, ms };
}

function normaliseTapEvent(evt) {
  if (evt.touches && evt.touches.length > 0) return evt.touches[0];
  if (evt.changedTouches && evt.changedTouches.length > 0) return evt.changedTouches[0];
  return evt;
}

function getTouchContactMetrics(evt, src = null) {
  const primary = src || normaliseTapEvent(evt);

  const radiusX =
    typeof primary?.radiusX === "number" && Number.isFinite(primary.radiusX)
      ? Number(primary.radiusX.toFixed(4))
      : null;

  const radiusY =
    typeof primary?.radiusY === "number" && Number.isFinite(primary.radiusY)
      ? Number(primary.radiusY.toFixed(4))
      : null;

  const rotationAngle =
    typeof primary?.rotationAngle === "number" && Number.isFinite(primary.rotationAngle)
      ? Number(primary.rotationAngle.toFixed(4))
      : null;

  const force =
    typeof primary?.force === "number" && Number.isFinite(primary.force)
      ? Number(primary.force.toFixed(4))
      : null;

  const width =
    typeof evt?.width === "number" && Number.isFinite(evt.width)
      ? Number(evt.width.toFixed(4))
      : null;

  const height =
    typeof evt?.height === "number" && Number.isFinite(evt.height)
      ? Number(evt.height.toFixed(4))
      : null;

  const touchArea =
    Number.isFinite(radiusX) && Number.isFinite(radiusY)
      ? Number((Math.PI * radiusX * radiusY).toFixed(4))
      : null;

  const touchAspectRatio =
    Number.isFinite(radiusX) &&
    Number.isFinite(radiusY) &&
    radiusY !== 0
      ? Number((radiusX / radiusY).toFixed(4))
      : null;

  return {
    touch_radius_x: radiusX,
    touch_radius_y: radiusY,
    touch_rotation_angle: rotationAngle,
    touch_force: force,
    touch_width: width,
    touch_height: height,
    touch_area_est: touchArea,
    touch_aspect_ratio: touchAspectRatio
  };
}

function onArenaPressStart(evt) {
  if (!session || tapStimulusMs == null) return;

  const src = normaliseTapEvent(evt);

  pointerIsDown = true;
  pointerDownMs = Math.round(nowMs());
  pointerDownPos = getArenaPoint(src);

  const geom = getTargetGeometry();
  const dCenter = distToTargetCenter(pointerDownPos, geom);

  if (activeStimulus) {
    activeStimulus.downInsideTarget = dCenter != null && dCenter <= geom.target_r;
  }

  logEvent("pointer_down", {
    x: pointerDownPos.x,
    y: pointerDownPos.y,
    button: typeof evt.button === "number" ? evt.button : 0,
    buttons: typeof evt.buttons === "number" ? evt.buttons : 1,
    pointer_type: evt.pointerType || (evt.type?.startsWith("touch") ? "touch" : "mouse"),
    pressure: typeof evt.pressure === "number" ? Number(evt.pressure.toFixed(4)) : null,
    dist_to_target_center: dCenter,
    target_cx: geom.target_cx,
    target_cy: geom.target_cy,
    target_r: geom.target_r,
    ...getTouchContactMetrics(evt, src)
  });

  if (evt.target === UI.tapTarget()) return;
  finishTapAttempt("miss", src);
}

function onArenaPressEnd(evt) {
  if (!session || tapStimulusMs == null) return;

  const src = normaliseTapEvent(evt);
  const ms = Math.round(nowMs());
  const pt = getArenaPoint(src);
  const geom = getTargetGeometry();
  const clickHoldMs =
    Number.isFinite(pointerDownMs) ? Math.max(0, ms - pointerDownMs) : null;

  logEvent("pointer_up", {
    x: pt.x,
    y: pt.y,
    button: typeof evt.button === "number" ? evt.button : 0,
    buttons: typeof evt.buttons === "number" ? evt.buttons : 0,
    pointer_type: evt.pointerType || (evt.type?.startsWith("touch") ? "touch" : "mouse"),
    pressure: typeof evt.pressure === "number" ? Number(evt.pressure.toFixed(4)) : null,
    click_hold_ms: clickHoldMs,
    dist_to_target_center: distToTargetCenter(pt, geom),
    target_cx: geom.target_cx,
    target_cy: geom.target_cy,
    target_r: geom.target_r,
    ...getTouchContactMetrics(evt, src)
  });

  if (pendingHitPointerUp) {
    pendingHitPointerUp = false;
    finishTapAttempt("hit", src);
    return;
  }

  pointerIsDown = false;
}

function onHit(e) {
  e.preventDefault();
  e.stopPropagation();

  if (!session || tapStimulusMs == null) return;

  const src = normaliseTapEvent(e);
  const ms = Math.round(nowMs());

  pointerIsDown = true;
  pointerDownMs = ms;
  pointerDownPos = getArenaPoint(src);
  pendingHitPointerUp = true;

  const geom = getTargetGeometry();
  const dCenter = distToTargetCenter(pointerDownPos, geom);

  if (!activeStimulus) {
    resetStimulusTracking(tapStimulusMs);
  }

  if (activeStimulus) {
    activeStimulus.downInsideTarget = dCenter != null && dCenter <= geom.target_r;
    activeStimulus.enteredTargetBeforeHit = true;

    if (
      activeStimulus.nearestDistance == null ||
      (dCenter != null && dCenter < activeStimulus.nearestDistance)
    ) {
      activeStimulus.nearestDistance = dCenter;
    }
  }

  logEvent("pointer_down", {
    x: pointerDownPos.x,
    y: pointerDownPos.y,
    button: typeof e.button === "number" ? e.button : 0,
    buttons: typeof e.buttons === "number" ? e.buttons : 1,
    pointer_type: e.pointerType || (e.type?.startsWith("touch") ? "touch" : "mouse"),
    pressure: typeof e.pressure === "number" ? Number(e.pressure.toFixed(4)) : null,
    dist_to_target_center: dCenter,
    target_cx: geom.target_cx,
    target_cy: geom.target_cy,
    target_r: geom.target_r,
    ...getTouchContactMetrics(e, src)
  });
}

function startTappingRound() {
  tappingRoundStartMs = nowMs();
  rtSum = 0;

  clearInterval(tappingTickInterval);
  clearTimeout(tappingEndTimeout);

  UI.tappingTime().textContent = "60.0";
  UI.tapHits().textContent = "0";
  UI.tapMisses().textContent = "0";
  UI.tapAccuracy().textContent = "0%";

  tapArenaEl = getTapArenaEl();
  if (!tapArenaEl) throw new Error("Tap arena element not found");

  const targetEl = UI.tapTarget();
  if (!targetEl) throw new Error("Tap target element not found");

  pointerInsideArena = false;
  pointerIsDown = false;
  pointerDownMs = null;
  pointerDownPos = null;
  lastMove = null;
  activeStimulus = null;

  moveTarget();

  if (!tappingListenersAttached) {
    tapArenaEl.addEventListener("pointermove", handlePointerMove);
    tapArenaEl.addEventListener("pointerdown", onArenaPressStart);
    tapArenaEl.addEventListener("pointerup", onArenaPressEnd);
    tapArenaEl.addEventListener("pointercancel", onArenaPressEnd);
    targetEl.addEventListener("pointerdown", onHit);
    tappingListenersAttached = true;
  }

  tappingTickInterval = setInterval(() => {
    const left = Math.max(0, 60000 - (nowMs() - tappingRoundStartMs));
    UI.tappingTime().textContent = (left / 1000).toFixed(1);
  }, 100);

  tappingEndTimeout = setTimeout(() => {
    endTappingRound();
  }, 60000);
}

function endTappingRound() {
  clearInterval(tappingTickInterval);
  clearTimeout(tappingEndTimeout);

  if (tappingListenersAttached) {
    if (tapArenaEl) {
      tapArenaEl.removeEventListener("pointermove", handlePointerMove);
      tapArenaEl.removeEventListener("pointerdown", onArenaPressStart);
      tapArenaEl.removeEventListener("pointerup", onArenaPressEnd);
      tapArenaEl.removeEventListener("pointercancel", onArenaPressEnd);
    }

    UI.tapTarget().removeEventListener("pointerdown", onHit);

    tappingListenersAttached = false;
    tapArenaEl = null;
  }

  pointerInsideArena = false;
  pointerIsDown = false;
  pointerDownMs = null;
  pointerDownPos = null;
  lastMove = null;
  activeStimulus = null;

  session.rounds.tapping.score = computeTapScore(session.rounds.tapping);
  updateTapAccuracy();
  logEvent("tapping_end");

  setScreen("screen-complete");
}

// ==========================
// Results + navigation
// ==========================
function bindCompleteUI() {
  UI.btnSessionCompleteContinue().addEventListener("click", () => {
    showResults();
  });
}

function bindResultsUI() {
  UI.btnRestart().addEventListener("click", () => {
    setScreen("screen-context");
  });

  UI.btnViewData().addEventListener("click", () => {
    if (!session) return;
    setScreen("screen-data");
    renderSessionReport(UI.dataSummary(), session);
  });

  const failBtn = UI.btnGoToDataOnFail();
  if (failBtn) {
    failBtn.addEventListener("click", () => {
      if (!session) return;
      setScreen("screen-data");
      renderSessionReport(UI.dataSummary(), session);
    });
  }

  UI.btnCopyPid().addEventListener("click", async () => {
    const pid = localStorage.getItem("participantId") || "";
    if (!pid) return;

    try {
      await navigator.clipboard.writeText(pid);
      UI.btnCopyPid().textContent = "Copied ✅";
      setTimeout(() => {
        UI.btnCopyPid().textContent = "Copy ID";
      }, 1200);
    } catch {
      UI.pidDisplay().focus();
      UI.pidDisplay().select();
      alert("Copy not permitted in this browser. Please copy manually.");
    }
  });
}

function bindDataUI() {
  UI.btnBackToResultsFromData().addEventListener("click", () => {
    setScreen("screen-results");
  });

  UI.btnDownloadCSV().addEventListener("click", () => {
    if (!session) return;

    const summary = computeSummary(session);
    const authExport = buildAuthWindowsCSV(session);

    if (!authExport?.csv) {
      alert("No window rows to export yet.");
      return;
    }

    const [header, ...rowLines] = authExport.csv.trimEnd().split("\n");
    downloadCSV(
      `auth_windows_${summary.sessionId}.csv`,
      header,
      rowLines.join("\n")
    );
  });

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

function validateSessionQualityDetailed(s) {
  if (!s) {
    return {
      valid: false,
      isMobile: null,
      counts: {},
      checks: {},
      failedChecks: ["no_session"]
    };
  }

  const events = Array.isArray(s.events) ? s.events : [];
  const inputDevice = String(s?.context?.inputDevice || "").toLowerCase();
  const deviceFamily = inferDeviceFamily(s);

  const isMobile =
    inputDevice === "touch" ||
    inputDevice === "mobile" ||
    deviceFamily === "mobile" ||
    deviceFamily === "tablet";

  const keyDowns = events.filter((e) => e?.t === "key_down").length;
  const keyUps = events.filter((e) => e?.t === "key_up").length;
  const beforeInputs = events.filter((e) => e?.t === "before_input").length;
  const typingSubmits = events.filter((e) => e?.t === "typing_submit").length;

  const tapHits = events.filter((e) => e?.t === "tap_hit").length;
  const tapMisses = events.filter((e) => e?.t === "tap_miss").length;
  const pointerMoves = events.filter((e) => e?.t === "pointer_move").length;
  const pointerDowns = events.filter((e) => e?.t === "pointer_down").length;
  const pointerUps = events.filter((e) => e?.t === "pointer_up").length;

  const typingEnd = events.some((e) => e?.t === "typing_end");
  const tappingEnd = events.some((e) => e?.t === "tapping_end");

  const typingStartMs = events.find((e) => e?.t === "word_shown")?.ms ?? null;
  const typingEndMs =
    [...events].reverse().find((e) => e?.t === "typing_end")?.ms ?? null;

  const tappingStartMs = events.find((e) => e?.t === "target_move")?.ms ?? null;
  const tappingEndMs =
    [...events].reverse().find((e) => e?.t === "tapping_end")?.ms ?? null;

  function maxGapMsInRange(startMs, endMs, relevantTypes) {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;

    const xs = events
      .filter(
        (e) =>
          Number.isFinite(e?.ms) &&
          e.ms >= startMs &&
          e.ms <= endMs &&
          relevantTypes.has(e?.t)
      )
      .map((e) => e.ms)
      .sort((a, b) => a - b);

    if (!xs.length) return endMs - startMs;

    let maxGap = xs[0] - startMs;
    for (let i = 1; i < xs.length; i++) {
      maxGap = Math.max(maxGap, xs[i] - xs[i - 1]);
    }
    maxGap = Math.max(maxGap, endMs - xs[xs.length - 1]);
    return Math.round(maxGap);
  }

  const typingRelevantTypes = new Set([
    "word_shown",
    "typing_submit",
    "typing_reaction",
    "before_input",
    "key_down",
    "key_up",
    "key"
  ]);

  const tappingRelevantTypes = new Set([
    "target_move",
    "tap_hit",
    "tap_miss",
    "pointer_move",
    "pointer_down",
    "pointer_up"
  ]);

  const typingMaxGapMs = maxGapMsInRange(
    typingStartMs,
    typingEndMs,
    typingRelevantTypes
  );

  const tappingMaxGapMs = maxGapMsInRange(
    tappingStartMs,
    tappingEndMs,
    tappingRelevantTypes
  );

  const counts = {
    keyDowns,
    keyUps,
    beforeInputs,
    typingSubmits,
    tapHits,
    tapMisses,
    pointerMoves,
    pointerDowns,
    pointerUps,
    typingEnd,
    tappingEnd,
    typingMaxGapMs,
    tappingMaxGapMs
  };

  // Typing signal:
  // Require meaningful activity + end marker.
  // Allow either key events or beforeinput as the main mobile evidence.
  const checks = {
    typing_has_enough_key_activity: keyDowns >= 20 && keyUps >= 20,
    typing_has_enough_mobile_input_activity: beforeInputs >= 20,
    typing_submit_present: typingSubmits >= 5,
    typing_end_present: typingEnd === true,
    typing_not_afk_gap_ok:
      typingMaxGapMs === null ? false : typingMaxGapMs <= 20000,

    tapping_hits_gte_10: tapHits >= 10,
    tapping_pointerdowns_gte_1: pointerDowns >= 1,
    tapping_pointerups_gte_1: pointerUps >= 1,
    tapping_end_present: tappingEnd === true,
    tapping_not_afk_gap_ok:
      tappingMaxGapMs === null ? false : tappingMaxGapMs <= 20000
  };

  const hasTypingSignal =
    (
      checks.typing_has_enough_key_activity ||
      checks.typing_has_enough_mobile_input_activity
    ) &&
    checks.typing_submit_present &&
    checks.typing_end_present &&
    checks.typing_not_afk_gap_ok;

  // IMPORTANT:
  // Do NOT require pointerMoves for mobile upload gating.
  // Direct taps on iPhone can generate very few pointer_move events.
  const hasTappingSignal =
    checks.tapping_hits_gte_10 &&
    checks.tapping_pointerdowns_gte_1 &&
    checks.tapping_pointerups_gte_1 &&
    checks.tapping_end_present &&
    checks.tapping_not_afk_gap_ok;

  const failedChecks = [];

  if (!hasTypingSignal) {
    if (
      !checks.typing_has_enough_key_activity &&
      !checks.typing_has_enough_mobile_input_activity
    ) {
      failedChecks.push("typing_activity_too_low");
    }
    if (!checks.typing_submit_present) failedChecks.push("typing_submit_lt_5");
    if (!checks.typing_end_present) failedChecks.push("typing_end_missing");
    if (!checks.typing_not_afk_gap_ok) failedChecks.push("typing_gap_gt_20s");
  }

  if (!hasTappingSignal) {
    if (!checks.tapping_hits_gte_10) failedChecks.push("tap_hits_lt_10");
    if (!checks.tapping_pointerdowns_gte_1) failedChecks.push("pointer_downs_missing");
    if (!checks.tapping_pointerups_gte_1) failedChecks.push("pointer_ups_missing");
    if (!checks.tapping_end_present) failedChecks.push("tapping_end_missing");
    if (!checks.tapping_not_afk_gap_ok) failedChecks.push("tapping_gap_gt_20s");
  }

  return {
    valid: hasTypingSignal && hasTappingSignal,
    isMobile,
    inputDevice,
    deviceFamily,
    counts,
    checks,
    failedChecks
  };
}

function showResults() {
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

  UI.pidDisplay().value = localStorage.getItem("participantId") || "";
  UI.sessionCountDisplay().textContent = String(
    Number(localStorage.getItem("sessionCount") || 0)
  );

  UI.uploadStatus().textContent = "Checking session quality…";

const failBtn = UI.btnGoToDataOnFail?.();
if (failBtn) failBtn.style.display = "none";

const qc = validateSessionQualityDetailed(session);

if (!qc.valid) {
  session.debug = session.debug || {};
  session.debug.validation = qc;

  UI.uploadStatus().textContent =
    `Session failed validation: ${qc.failedChecks.join(", ") || "unknown_reason"}`;

  if (failBtn) {
    failBtn.style.display = "inline-block";
    failBtn.textContent = "Download CSVs (Session failed checks)";
  }

  setScreen("screen-data");
  renderSessionReport(UI.dataSummary(), session);

  const box = document.createElement("pre");
  box.textContent =
`SESSION VALIDATION FAILED

isMobile: ${qc.isMobile}
inputDevice: ${qc.inputDevice}
deviceFamily: ${qc.deviceFamily}

Counts:
${JSON.stringify(qc.counts, null, 2)}

Failed checks:
${JSON.stringify(qc.failedChecks, null, 2)}

All checks:
${JSON.stringify(qc.checks, null, 2)}
`;
  box.style.whiteSpace = "pre-wrap";
  box.style.wordBreak = "break-word";
  box.style.padding = "12px";
  box.style.marginTop = "12px";
  box.style.background = "#fff8e8";
  box.style.border = "1px solid #e7c97a";
  box.style.borderRadius = "8px";
  box.style.fontSize = "12px";
  box.style.lineHeight = "1.4";

  UI.dataSummary().prepend(box);

  return;
}

UI.uploadStatus().textContent = "Uploading…";

uploadSessionToFirebase(session)
  .then(() => {
    UI.uploadStatus().textContent =
      "Uploaded - Play the game again tomorrow - your behaviour changes each day";

    if (failBtn) failBtn.style.display = "none";
  })
  .catch((e) => {
    console.error("UPLOAD_ERROR", e);

    const msg =
      e?.message ||
      e?.code ||
      (typeof e === "string" ? e : JSON.stringify(e, null, 2));

    UI.uploadStatus().textContent =
      `Upload failed: ${msg}`;

    if (failBtn) {
      failBtn.style.display = "inline-block";
      failBtn.textContent = "Download CSVs (Upload failed)";
    }

    session.debug = session.debug || {};
    session.debug.uploadError = {
      message: e?.message || null,
      code: e?.code || null,
      name: e?.name || null,
      at: new Date().toISOString()
    };

    setScreen("screen-data");
    renderSessionReport(UI.dataSummary(), session);

    const box = document.createElement("pre");
    box.textContent = `UPLOAD ERROR\n\n${msg}`;
    box.style.whiteSpace = "pre-wrap";
    box.style.wordBreak = "break-word";
    box.style.padding = "12px";
    box.style.marginTop = "12px";
    box.style.background = "#fff4f4";
    box.style.border = "1px solid #f1b5b5";
    box.style.borderRadius = "8px";
    box.style.fontSize = "12px";
    box.style.lineHeight = "1.4";

    UI.dataSummary().prepend(box);
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
  const windows = generateWindows(s.events, 30000, 15000);
  const sessionDate = String(summary?.createdAtClientISO || "").split("T")[0] || null;
  const deviceFamily = inferDeviceFamily(s);

  let header = null;
  const rows = [];

  windows.forEach((w) => {
    const features = computeSessionFeatures(s, w);
    const counts = windowEventCounts(s.events || [], w);

    const tapOutcomeTotal = (counts.n_tap_hits || 0) + (counts.n_tap_misses || 0);
    const pointerTotal =
      (counts.n_pointer_move_events || 0) +
      (counts.n_pointer_down_events || 0) +
      (counts.n_pointer_up_events || 0);

    const typingActive =
      (counts.n_key_events || 0) > 0 ||
      (counts.n_key_down_events || 0) > 0 ||
      (counts.n_key_up_events || 0) > 0;

    const tappingActive = tapOutcomeTotal > 0 || pointerTotal > 0;

    const flatAuth = flattenFeaturesForAuth(summary, features, {
      session_order: summary?.sessionIndex ?? null,
      session_date: sessionDate,
      device_family: deviceFamily,
      has_typing: typingActive,
      has_tapping: tappingActive,
      n_key_events: counts.n_key_events ?? 0,
      n_key_events_legacy: counts.n_key_events_legacy ?? 0,
      n_key_down_events: counts.n_key_down_events ?? 0,
      n_key_up_events: counts.n_key_up_events ?? 0,
      n_tap_hits: counts.n_tap_hits ?? 0,
      n_tap_misses: counts.n_tap_misses ?? 0,
      n_pointer_move_events: counts.n_pointer_move_events ?? 0,
      n_pointer_down_events: counts.n_pointer_down_events ?? 0,
      n_pointer_up_events: counts.n_pointer_up_events ?? 0,
      window_duration_ms: w.endMs - w.startMs,
      is_low_activity_window:
        (counts.n_key_events ?? 0) < 10 &&
        (counts.n_key_down_events ?? 0) < 10 &&
        tapOutcomeTotal < 10 &&
        pointerTotal < 25
    });

    if (!flatAuth) return;

    flatAuth.windowIndex = w.windowIndex;
    flatAuth.windowStartMs = w.startMs;
    flatAuth.windowEndMs = w.endMs;
    flatAuth.schemaVersion = summary?.schemaVersion ?? 3;
    flatAuth.featureSchema = summary?.featureSchema ?? "rich_keyboard_pointer_v1";
    flatAuth.sessionId = summary?.sessionId ?? s.sessionId ?? "";
    flatAuth.participantId = summary?.participantId ?? s.participantId ?? "";

    const { header: h, row } = authFeaturesToCSVRow(flatAuth);
    if (!header) header = h;
    rows.push(row);
  });

  if (!header || !rows.length) return null;

  return {
    header,
    rows,
    csv: `${header}\n${rows.join("\n")}\n`
  };
}

function buildEventsCSV(s) {
  const events = Array.isArray(s?.events) ? s.events : [];
  if (!events.length) return null;

  const keys = new Set();
  for (const ev of events) {
    Object.keys(ev || {}).forEach((k) => keys.add(k));
  }

  const core = ["t", "ms", "dt", "tISO"];
  core.forEach((k) => keys.delete(k));
  keys.delete("sessionId");
  keys.delete("participantId");

  const header = [
    "schemaVersion",
    "sessionId",
    "participantId",
    ...core,
    ...Array.from(keys).sort()
  ];

  const rows = events.map((ev) => {
    const rowObj = {
      schemaVersion: s.schemaVersion ?? null,
      sessionId: s.sessionId ?? "",
      participantId: s.participantId ?? "",
      ...(ev || {})
    };
    return header.map((k) => csvCell(rowObj[k])).join(",");
  });

  return header.join(",") + "\n" + rows.join("\n") + "\n";
}

async function uploadSessionToFirebase(s) {
  if (!auth.currentUser) throw new Error("Not signed in");

  const authExport = buildAuthWindowsCSV(s);
  const eventsCsv = buildEventsCSV(s);

  if (!authExport?.csv) {
    throw new Error("No auth_windows rows to upload yet.");
  }

  const base = `sessions/${s.sessionId}`;

  await uploadBytes(ref(storage, `${base}/auth_windows.csv`), csvBlob(authExport.csv));
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
    authWindowCount: authExport.rows.length,
    hasEventsCsv: Boolean(eventsCsv)
  });
}

// ==========================
// Debug hooks
// ==========================
window._UI = UI;
window._session = () => session;