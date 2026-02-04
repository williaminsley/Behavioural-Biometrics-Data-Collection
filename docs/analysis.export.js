// analysis.export.js
// CSV + download helpers

export function summaryToCSVRow(summary) {
  const cols = Object.keys(summary);
  const vals = cols.map((k) => csvEscape(summary[k]));
  return { header: cols.join(","), row: vals.join(",") };
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

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[,"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Continuous-auth feature flattener

export function flattenFeaturesForAuth(summary, features) {
  if (!summary || !features) return null;

  const row = {
    // ---- identifiers (keep for linking, drop before training if needed)
    sessionId: summary.sessionId,
    participantId: summary.participantId,
    sessionIndex: summary.sessionIndex,
    timeBucket: summary.timeBucket,
    fatigue: summary.fatigue,
    inputDevice: summary.inputDevice,

    // ---- typing: global IKT
    typing_ikt_global_mean: features.typing.iktGlobal.mean ?? null,
    typing_ikt_global_std: features.typing.iktGlobal.std ?? null,
    typing_ikt_global_iqr: features.typing.iktGlobal.iqr ?? null,
    typing_ikt_global_p95: features.typing.iktGlobal.p95 ?? null,
    typing_ikt_global_clipped_pct: features.typing.iktGlobal.clippedPct ?? null,

    // ---- typing: within-word IKT
    typing_ikt_within_mean: features.typing.iktWithin.mean ?? null,
    typing_ikt_within_std: features.typing.iktWithin.std ?? null,
    typing_ikt_within_iqr: features.typing.iktWithin.iqr ?? null,
    typing_ikt_within_p95: features.typing.iktWithin.p95 ?? null,
    typing_ikt_within_clipped_pct: features.typing.iktWithin.clippedPct ?? null,

    // ---- typing: accuracy & control
    typing_accuracy_pct: features.typing.accuracyPct ?? null,
    typing_drift_ikt: features.typing.driftIkt ?? null,
    typing_error_recovery_wrong_median:
      features.typing.errorRecoveryWrong.median ?? null,

    // ---- tapping: RT
    tap_rt_mean: features.tapping.rt.mean ?? null,
    tap_rt_std: features.tapping.rt.std ?? null,
    tap_rt_iqr: features.tapping.rt.iqr ?? null,
    tap_rt_p95: features.tapping.rt.p95 ?? null,

    // ---- tapping: accuracy & drift
    tap_miss_rate_pct: features.tapping.missRatePct ?? null,
    tap_drift_rt: features.tapping.driftRt ?? null,
    tap_error_recovery_miss_median:
      features.tapping.errorRecoveryMiss.median ?? null,

    // ---- cross-task coupling
    coupling_var_ikt: features.coupling.varIkt ?? null,
    coupling_var_rt: features.coupling.varRt ?? null,
    coupling_var_ratio: features.coupling.varRatio ?? null
  };

  return row;
}

export function authFeaturesToCSVRow(flatRow) {
  const cols = Object.keys(flatRow);
  const vals = cols.map(k => csvEscape(flatRow[k]));
  return {
    header: cols.join(","),
    row: vals.join(",")
  };
}