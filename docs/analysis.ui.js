// analysis.ui.js
// Human-readable session report

import {
  computeSummary,
  computeSessionFeatures,
  computeSessionFlags
} from "./analysis.features.js";

export function renderSessionReport(containerEl, session) {
  containerEl.innerHTML = "";

  const summary = computeSummary(session);
  const features = computeSessionFeatures(session);
  const { valid, flags } = computeSessionFlags(session, features);

  containerEl.appendChild(sectionTitle("Session Summary"));
  containerEl.appendChild(kvTable([
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
  ]));

  if (features?.typing) {
    containerEl.appendChild(sectionTitle("Typing Features"));
    containerEl.appendChild(kvTable([
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
    ]));
  }

  if (features?.tapping) {
    containerEl.appendChild(sectionTitle("Tapping Features"));
    containerEl.appendChild(kvTable([
      ["RT mean", features.tapping?.rt?.mean],
      ["RT std", features.tapping?.rt?.std],
      ["RT iqr", features.tapping?.rt?.iqr],
      ["RT p95", features.tapping?.rt?.p95],
      ["Miss rate %", features.tapping?.missRatePct],
      ["Drift RT", features.tapping?.driftRt],
      ["Error recovery median", features.tapping?.errorRecoveryMiss?.median]
    ]));
  }

  if (features?.coupling) {
    containerEl.appendChild(sectionTitle("Cross-Task Coupling"));
    containerEl.appendChild(kvTable([
      ["Variance IKT", features.coupling?.varIkt],
      ["Variance RT", features.coupling?.varRt],
      ["Variance ratio", features.coupling?.varRatio]
    ]));
  }

  containerEl.appendChild(sectionTitle("Validity"));
  containerEl.appendChild(kvTable([
    ["Valid", valid ? "yes" : "no"],
    ["Flags", (flags || []).length ? flags.join(", ") : "none"]
  ]));
}

function sectionTitle(text) {
  const h = document.createElement("h3");
  h.className = "data-section-title";
  h.textContent = text;
  return h;
}

function fmtValue(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

function kvTable(rows) {
  const table = document.createElement("table");
  const tbody = document.createElement("tbody");

  rows.forEach(([k, v]) => {
    const tr = document.createElement("tr");
    const tdK = document.createElement("td");
    const tdV = document.createElement("td");
    tdK.textContent = String(k);
    tdV.textContent = fmtValue(v);
    tr.appendChild(tdK);
    tr.appendChild(tdV);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  return table;
}
